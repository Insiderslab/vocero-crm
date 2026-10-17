import { z } from "zod";
import { apiError, parseBody, withAdminAuth } from "@/lib/api";
import { getEnv } from "@/lib/env";
import {
  getActiveSiteKey,
  getAllowedOrigins,
  setAllowedOrigins,
} from "@/server/site-requests/config";
import { MAX_ORIGINS, parseOrigins } from "@/server/site-requests/validation";

export const dynamic = "force-dynamic";

/** URL pública del formulario (la que pega el sitio en su `fetch`). */
function endpointUrl(): string {
  return `${getEnv().APP_BASE_URL.replace(/\/$/, "")}/api/public/site-requests`;
}

/**
 * 008 — Estado del formulario del sitio de la organización de la sesión: la
 * clave activa (prefijo y fechas; nunca hash ni texto plano), los orígenes
 * autorizados y la URL del formulario. Solo owner/admin.
 */
export const GET = withAdminAuth(async (session) => {
  const [key, allowedOrigins] = await Promise.all([
    getActiveSiteKey(session.organizationId),
    getAllowedOrigins(session.organizationId),
  ]);
  return Response.json({ key, allowedOrigins, endpoint: endpointUrl() });
});

const putSchema = z.object({
  /** Texto con un origen por línea, o lista. */
  allowedOrigins: z.union([z.string().max(10_000), z.array(z.string().max(300)).max(200)]),
});

/** Guarda los orígenes autorizados (CORS). Una línea inválida → 422 con las líneas. */
export const PUT = withAdminAuth(async (session, req: Request) => {
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;
  const parsed = parseOrigins(body.data.allowedOrigins);
  if (!parsed.ok) {
    if ("tooMany" in parsed) {
      return apiError(422, "too_many_origins", `Máximo ${MAX_ORIGINS} orígenes`);
    }
    return Response.json(
      {
        error: {
          code: "invalid_origins",
          message: `Orígenes no válidos: ${parsed.invalid.join(", ")}`,
          invalid: parsed.invalid,
        },
      },
      { status: 422 }
    );
  }
  await setAllowedOrigins(session.organizationId, parsed.origins);
  return Response.json({ allowedOrigins: parsed.origins });
});
