import { apiError } from "@/lib/api";
import {
  authenticateExport,
  dbExportAuthDeps,
  type ExportAuthDeps,
} from "@/server/export/auth";

/**
 * Envuelve un handler de /api/export/*: autentica la X-API-Key, toma la
 * organización de la clave (nunca de `?org=`) y deja pasar solo lecturas.
 */
export function withExport(
  handler: (org: { id: string; name: string }, url: URL) => Promise<Response>,
  deps: ExportAuthDeps = dbExportAuthDeps
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const org = await authenticateExport(req, deps);
    if (org instanceof Response) return org;
    try {
      return await handler(org, new URL(req.url));
    } catch (err) {
      console.error("[export] error no controlado:", err);
      return apiError(500, "internal", "Error interno");
    }
  };
}
