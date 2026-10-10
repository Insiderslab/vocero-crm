import { eq } from "drizzle-orm";
import { apiError } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import {
  authenticateApiKey,
  dbApiKeyAuthDeps,
  type ApiKeyAuthDeps,
} from "@/server/api-keys";

/**
 * Autenticación de la API de extracción `/api/export/*` (custom heili.cloud).
 *
 * La consume el OPERADOR de una organización (scripts de análisis con IA, n8n,
 * notebooks): header `X-API-Key`. Es solo lectura. La organización sale
 * SIEMPRE de la clave (C2, audit 2026-10-01), nunca de `?org=`:
 * - clave por organización `vex_…` (ámbito "export", `@/server/api-keys`);
 * - clave de instancia heredada `EXPORT_API_KEY`: solo con UNA organización.
 * Si llega `?org=<id|slug>`, debe coincidir con la organización de la clave.
 */

export type ExportOrg = { id: string; name: string; slug: string | null };

export type ExportAuthDeps = ApiKeyAuthDeps & {
  loadOrganization(id: string): Promise<ExportOrg | null>;
};

export const dbExportAuthDeps: ExportAuthDeps = {
  ...dbApiKeyAuthDeps,
  async loadOrganization(id) {
    const rows = await getDb()
      .select({
        id: schema.organization.id,
        name: schema.organization.name,
        slug: schema.organization.slug,
      })
      .from(schema.organization)
      .where(eq(schema.organization.id, id))
      .limit(1);
    return rows[0] ?? null;
  },
};

/**
 * Autentica una petición de `/api/export/*` y devuelve la organización de la
 * clave, o un Response (401/403/409/429) cuando no se puede continuar.
 */
export async function authenticateExport(
  req: Request,
  deps: ExportAuthDeps = dbExportAuthDeps
): Promise<ExportOrg | Response> {
  const auth = await authenticateApiKey(req, "export", deps);
  if (auth instanceof Response) return auth;

  const org = await deps.loadOrganization(auth.organizationId);
  if (!org) return apiError(401, "unauthorized", "No autorizado");

  // `?org=` ya no elige organización: solo se acepta si es la de la clave.
  const requested = new URL(req.url).searchParams.get("org");
  if (requested && requested !== org.id && requested !== org.slug) {
    return apiError(403, "org_mismatch", "La clave no pertenece a esa organización");
  }
  return org;
}

export type ExportFormat = "json" | "csv";

export function parseFormat(url: URL): ExportFormat {
  return url.searchParams.get("format") === "csv" ? "csv" : "json";
}
