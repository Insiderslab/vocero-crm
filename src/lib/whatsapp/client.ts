import { getEnv } from "@/lib/env";

/**
 * Fase 4 — Selección de canal de salida de WhatsApp.
 *
 * Punto ÚNICO donde se decide si el tráfico saliente va por Meta directo
 * (comportamiento histórico) o por el adaptador Wapi. La regla es puramente
 * de entorno y opcional: si AMBAS `WAPI_BASE_URL` y `WAPI_API_KEY` están
 * presentes, el canal es Wapi; en cualquier otro caso, Meta.
 *
 * Este módulo es intencionalmente "puro" (solo lee env) para evitar ciclos de
 * importación: lo consumen tanto `@/lib/meta/client` (graphRequest) como
 * `@/server/whatsapp/media` (upload/download de adjuntos), que son quienes
 * ejecutan el fetch real delegando en el adaptador correspondiente.
 */

export type WaProvider = "meta" | "wapi";

/** true si el adaptador Wapi está configurado (ambas env presentes). */
export function isWapiEnabled(): boolean {
  const env = getEnv();
  return Boolean(env.WAPI_BASE_URL && env.WAPI_API_KEY);
}

/** Canal activo para el tráfico saliente de WhatsApp. */
export function activeWaProvider(): WaProvider {
  return isWapiEnabled() ? "wapi" : "meta";
}

/**
 * Bearer a usar para descargar el binario de un media desde la URL efímera.
 *
 * Con Meta, la URL efímera apunta a lookaside/graph y se autentica con el
 * token de Meta de la org. Con Wapi, `graphRequest` recibe una URL reescrita
 * que apunta al endpoint `_media` de Wapi, el cual exige la api key de Wapi
 * como Bearer (nunca el token de Meta, que no sale de Wapi).
 */
export function mediaBinaryAuthToken(metaToken: string): string {
  if (isWapiEnabled()) return getEnv().WAPI_API_KEY!;
  return metaToken;
}
