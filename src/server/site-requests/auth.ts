import {
  authenticateApiKey,
  dbApiKeyAuthDeps,
  type ApiKeyAuthDeps,
  type ApiKeyAuthResult,
} from "@/server/api-keys";

/**
 * 008 — Puerta única de `/api/public/site-requests`: la clave del sitio
 * (`vsk_…`, cabecera `X-Site-Key`, ámbito "site" de `@/server/api-keys`). La
 * organización sale SIEMPRE de la clave. No hay clave de instancia: sin una
 * clave de organización activa → 401 (los fallos cuentan por IP).
 */
export function authenticateSiteKey(
  req: Request,
  deps: ApiKeyAuthDeps = dbApiKeyAuthDeps
): Promise<ApiKeyAuthResult | Response> {
  return authenticateApiKey(req, "site", deps);
}
