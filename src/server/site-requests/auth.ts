import {
  authenticateApiKey,
  consumeOrgRateLimit,
  dbApiKeyAuthDeps,
  type ApiKeyAuthDeps,
  type ApiKeyAuthResult,
} from "@/server/api-keys";

/**
 * 008 — Puerta única de `/api/public/site-requests`: la clave del sitio
 * (`vsk_…`, cabecera `X-Site-Key`, ámbito "site" de `@/server/api-keys`). La
 * organización sale SIEMPRE de la clave. No hay clave de instancia: sin una
 * clave de organización activa → 401 (los fallos cuentan por IP).
 *
 * NO consume el límite de la organización: lo consume la ruta con
 * `consumeSiteKeyLimit` DESPUÉS del origen y del límite por IP (spec US3 AC1).
 */
export function authenticateSiteKey(
  req: Request,
  deps: ApiKeyAuthDeps = dbApiKeyAuthDeps
): Promise<ApiKeyAuthResult | Response> {
  return authenticateApiKey(req, "site", deps, { consumeOrgLimit: false });
}

/** Límite por clave/organización del sitio (30/min). 429 si se agotó. */
export function consumeSiteKeyLimit(organizationId: string): Response | null {
  return consumeOrgRateLimit("site", organizationId);
}
