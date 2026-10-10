/**
 * Mensaje de error de una respuesta de la API interna. El contrato
 * (`apiError` en lib/api.ts) anida el mensaje en `error.message`: leer
 * `message` en la raíz lo perdía y mostraba solo "Error 409".
 */
export function apiErrorMessage(body: unknown, fallback: string): string {
  const message = (body as { error?: { message?: unknown } } | null)?.error?.message;
  return typeof message === "string" && message.trim() ? message : fallback;
}
