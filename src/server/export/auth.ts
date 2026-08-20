import { timingSafeEqual } from "node:crypto";
import { eq, or } from "drizzle-orm";
import { apiError } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Autenticación de la API de extracción `/api/export/*` (custom heili.cloud).
 *
 * La consume el OPERADOR de la instancia (scripts de análisis con IA, n8n,
 * notebooks): header `X-API-Key` contra `EXPORT_API_KEY` (env), comparación en
 * tiempo constante. Sin `EXPORT_API_KEY` configurada, toda la superficie
 * responde 401. Es solo lectura.
 */
export function requireExportKey(req: Request): Response | null {
  const rl = checkRateLimit("export-api", { windowMs: 60_000, max: 300 });
  if (!rl.allowed) return apiError(429, "rate_limited", "Demasiadas solicitudes");

  const expected = process.env.EXPORT_API_KEY;
  const provided = req.headers.get("x-api-key");
  if (!expected || expected.length < 16 || !provided) {
    return apiError(401, "unauthorized", "No autorizado");
  }
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return apiError(401, "unauthorized", "No autorizado");
  }
  return null;
}

/**
 * Resuelve `?org=` (id o slug) a una organización. Obligatorio en multi-org:
 * sin él la extracción no sabe de qué empresa leer.
 */
export async function resolveExportOrg(param: string | null) {
  if (!param) return null;
  const db = getDb();
  const rows = await db
    .select({ id: schema.organization.id, name: schema.organization.name })
    .from(schema.organization)
    .where(
      or(
        eq(schema.organization.id, param),
        eq(schema.organization.slug, param)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export type ExportFormat = "json" | "csv";

export function parseFormat(url: URL): ExportFormat {
  return url.searchParams.get("format") === "csv" ? "csv" : "json";
}
