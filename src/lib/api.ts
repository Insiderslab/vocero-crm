import { z } from "zod";
import { requireSession, UnauthorizedError, type SessionContext } from "@/lib/auth/session";
import { isOrgAdmin, isOrgOwner } from "@/lib/roles";

/** Respuesta de error estándar de la API interna (contrato api.md). */
export function apiError(
  status: number,
  code: string,
  message: string
): Response {
  return Response.json({ error: { code, message } }, { status });
}

/**
 * Envuelve un route handler autenticado: resuelve la sesión (401 si no hay),
 * captura errores no controlados (500 sin stack) y deja pasar Response.
 */
export function withAuth<Args extends unknown[]>(
  handler: (session: SessionContext, ...args: Args) => Promise<Response>
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    let session: SessionContext;
    try {
      session = await requireSession();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        return apiError(401, "unauthorized", "No autenticado");
      }
      throw err;
    }
    try {
      return await handler(session, ...args);
    } catch (err) {
      console.error("[api] error no controlado:", err);
      return apiError(500, "internal", "Error interno");
    }
  };
}

/**
 * Única fuente del 403 por rol: lo emite `withRoleAuth` y nadie más. Se
 * responde ANTES de leer el body, consultar la base de datos o llamar a Meta.
 */
function forbidden(message: string): Response {
  return apiError(403, "forbidden", message);
}

/**
 * Como `withAuth`, pero solo deja pasar a los roles que acepta `allows`
 * (403 al resto). Las dos variantes con nombre de abajo son las que usan las
 * rutas; el guardarraíl de `tests/unit/settings-routes-guard.test.ts` exige
 * que cada ruta sensible use una de ellas.
 */
function withRoleAuth<Args extends unknown[]>(
  allows: (role: string) => boolean,
  message: string,
  handler: (session: SessionContext, ...args: Args) => Promise<Response>
): (...args: Args) => Promise<Response> {
  return withAuth(async (session, ...args: Args) => {
    if (!allows(session.role)) return forbidden(message);
    return handler(session, ...args);
  });
}

/**
 * Solo owner/admin de la organización de la sesión. Para rutas que leen o
 * cambian configuración de la organización o hablan con Meta con sus
 * credenciales: conexión de WhatsApp, plantillas, agente, claves de servicio.
 */
export function withAdminAuth<Args extends unknown[]>(
  handler: (session: SessionContext, ...args: Args) => Promise<Response>
): (...args: Args) => Promise<Response> {
  return withRoleAuth(
    isOrgAdmin,
    "Solo owner o admin pueden gestionar esta configuración",
    handler
  );
}

/** Solo el propietario (owner): marca de la organización y alta de cuentas. */
export function withOwnerAuth<Args extends unknown[]>(
  handler: (session: SessionContext, ...args: Args) => Promise<Response>
): (...args: Args) => Promise<Response> {
  return withRoleAuth(
    isOrgOwner,
    "Solo el propietario puede gestionar esta configuración",
    handler
  );
}

/** Parsea el body JSON con un esquema Zod; inválido → Response 422. */
export async function parseBody<T>(
  req: Request,
  schema: z.ZodType<T>
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      ok: false,
      response: apiError(422, "invalid_body", "El body debe ser JSON válido"),
    };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
      .join("; ");
    return {
      ok: false,
      response: apiError(422, "invalid_body", detail),
    };
  }
  return { ok: true, data: parsed.data };
}
