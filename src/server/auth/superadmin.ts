import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { UnauthorizedError } from "@/lib/auth/session";

// La regla pura vive en superadmin-email.ts (la usa también @/lib/auth).
export { isSuperadminEmail } from "@/server/auth/superadmin-email";
import { isSuperadminEmail } from "@/server/auth/superadmin-email";

export class ForbiddenError extends Error {
  constructor(message = "No eres super-admin de esta instancia") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export type SuperadminContext = { userId: string; email: string };

/**
 * Sesión + verificación de super-admin para los route handlers /api/admin/*.
 * Lanza UnauthorizedError (401) si no hay sesión y ForbiddenError (403) si el
 * correo no está en SUPERADMIN_EMAILS.
 */
export async function requireSuperadmin(): Promise<SuperadminContext> {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new UnauthorizedError();
  if (!isSuperadminEmail(session.user.email)) throw new ForbiddenError();
  return { userId: session.user.id, email: session.user.email };
}

/**
 * Envuelve un route handler de /api/admin/*: 401 sin sesión, 403 si el correo
 * no está en SUPERADMIN_EMAILS, 500 sin stack en errores no controlados.
 */
export function withSuperadmin<Args extends unknown[]>(
  handler: (ctx: SuperadminContext, ...args: Args) => Promise<Response>
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    let ctx: SuperadminContext;
    try {
      ctx = await requireSuperadmin();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        return apiError(401, "unauthorized", "No autenticado");
      }
      if (err instanceof ForbiddenError) {
        return apiError(403, "not_superadmin", err.message);
      }
      throw err;
    }
    try {
      return await handler(ctx, ...args);
    } catch (err) {
      console.error("[admin] error no controlado:", err);
      return apiError(500, "internal", "Error interno");
    }
  };
}
