import { apiError } from "@/lib/api";
import { requireExportKey, resolveExportOrg } from "@/server/export/auth";

/**
 * Envuelve un handler de /api/export/*: verifica la X-API-Key, resuelve la
 * org de `?org=` (obligatoria en multi-org) y deja pasar solo lecturas.
 */
export function withExport(
  handler: (org: { id: string; name: string }, url: URL) => Promise<Response>
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const denied = requireExportKey(req);
    if (denied) return denied;
    const url = new URL(req.url);
    const org = await resolveExportOrg(url.searchParams.get("org"));
    if (!org) {
      return apiError(
        422,
        "org_required",
        "Falta ?org=<id|slug> o la organización no existe"
      );
    }
    try {
      return await handler(org, url);
    } catch (err) {
      console.error("[export] error no controlado:", err);
      return apiError(500, "internal", "Error interno");
    }
  };
}
