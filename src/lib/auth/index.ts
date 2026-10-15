import { AsyncLocalStorage } from "node:async_hooks";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { getDb, schema } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { localeFromHeaders } from "@/lib/i18n";
import { authRateLimitAllowed } from "@/lib/rate-limit";
import {
  onUserCreated,
  resolveActiveOrganizationId,
} from "@/server/auth/on-signup";
import { isPublicSignupAllowed, isInstanceEmpty } from "@/server/auth/registration";
import {
  EMAIL_UNAVAILABLE,
  EMAIL_UNAVAILABLE_MESSAGE,
  isSuperadminEmail,
  superadminEmailCreationAllowed,
} from "@/server/auth/superadmin-email";

/**
 * Contexto interno del proceso: permite que el alta de cuentas de equipo
 * (owner → API) atraviese el gate de registro cerrado. No es alcanzable
 * desde fuera: solo envuelve llamadas server-side.
 */
type InternalSignup = { bySuperadmin: boolean };

const globalForSignup = globalThis as unknown as {
  __voceroInternalSignup?: AsyncLocalStorage<InternalSignup>;
};

// En globalThis: los módulos pueden evaluarse más de una vez (una por ruta en
// dev) y todas las copias deben compartir el mismo contexto.
function internalSignupContext(): AsyncLocalStorage<InternalSignup> {
  if (!globalForSignup.__voceroInternalSignup) {
    globalForSignup.__voceroInternalSignup = new AsyncLocalStorage<InternalSignup>();
  }
  return globalForSignup.__voceroInternalSignup;
}

/**
 * `bySuperadmin`: SOLO le rotte /api/admin/* (dietro `withSuperadmin`) lo
 * passano a true; è l'unico modo, fuori dal bootstrap, di creare un account
 * con un'email di SUPERADMIN_EMAILS (013, revisione PR #15).
 */
export function runInternalSignup<T>(
  fn: () => Promise<T>,
  opts: { bySuperadmin?: boolean } = {}
): Promise<T> {
  return internalSignupContext().run({ bySuperadmin: opts.bySuperadmin === true }, fn);
}

function isInternalSignup(): boolean {
  return internalSignupContext().getStore() !== undefined;
}

function internalSignupBySuperadmin(): boolean {
  return internalSignupContext().getStore()?.bySuperadmin === true;
}

function emailUnavailable(): APIError {
  return new APIError("FORBIDDEN", { message: EMAIL_UNAVAILABLE_MESSAGE, code: EMAIL_UNAVAILABLE });
}

function createAuth() {
  const env = getEnv();
  return betterAuth({
    baseURL: env.APP_BASE_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        organization: schema.organization,
        member: schema.member,
        invitation: schema.invitation,
      },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      minPasswordLength: 8,
    },
    plugins: [organization({ creatorRole: "owner" })],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // Rate limit por IP en login/registro (FR-062): 10 / 10 min → 429.
        if (!authRateLimitAllowed(ctx.path, ctx.headers)) {
          throw new APIError("TOO_MANY_REQUESTS", {
            message: "Demasiados intentos; espera unos minutos",
          });
        }
        // 013: nessun invito a un'email di super-admin (diventerebbe
        // super-admin accettandolo). Messaggio generico.
        if (ctx.path === "/organization/invite-member") {
          const email = (ctx.body as { email?: unknown } | undefined)?.email;
          if (typeof email === "string" && isSuperadminEmail(email)) throw emailUnavailable();
        }
        // Registro público cerrado tras la primera organización (FR-060).
        if (ctx.path === "/sign-up/email") {
          if (!isInternalSignup() && !(await isPublicSignupAllowed())) {
            throw new APIError("FORBIDDEN", {
              message:
                "El registro está cerrado: esta instancia ya tiene su organización",
            });
          }
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          // 013 (revisione PR #15): QUALUNQUE creazione di utente (registro
          // pubblico, ALLOW_SIGNUP, alta di equipo, /admin) passa da qui. Un
          // account con un'email di super-admin solo nel bootstrap o da /admin.
          before: async (user) => {
            if (!isSuperadminEmail(user.email)) return;
            const allowed = superadminEmailCreationAllowed({
              email: user.email,
              bySuperadmin: internalSignupBySuperadmin(),
              instanceEmpty: await isInstanceEmpty(),
            });
            if (!allowed) throw emailUnavailable();
          },
          after: async (user, context) => {
            // 009 (E2): la organización del primer registro nace en el idioma
            // de quien se registra (cookie de idioma, luego Accept-Language).
            const headers =
              context?.headers ?? context?.request?.headers ?? null;
            await onUserCreated(user.id, user.name, localeFromHeaders(headers));
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const organizationId = await resolveActiveOrganizationId(
              session.userId
            );
            return {
              data: { ...session, activeOrganizationId: organizationId },
            };
          },
        },
      },
    },
  });
}

type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as unknown as { __voceroAuth?: Auth };

export function getAuth(): Auth {
  if (!globalForAuth.__voceroAuth) globalForAuth.__voceroAuth = createAuth();
  return globalForAuth.__voceroAuth;
}
