import { isMockEnabled } from "@/lib/env";

/**
 * Gate del entorno de pruebas interno (FR-080).
 * Los mocks solo existen con WA_MOCK_ENABLED=true Y fuera de producción;
 * en cualquier otro caso responden 404 incondicional, indistinguible de una
 * ruta inexistente.
 */
export function mockGuard(): Response | null {
  if (!isMockEnabled()) {
    return new Response(null, { status: 404 });
  }
  return null;
}

/**
 * ¿Puede el webhook de WhatsApp aceptar eventos SIN firma cuando falta
 * META_APP_SECRET? Solo dentro del mismo gate de los mocks: WA_MOCK_ENABLED=true
 * Y fuera de producción (el self-test local y los mocks no tienen App Secret).
 * En cualquier otro caso la firma es obligatoria y, sin secreto, el webhook
 * rechaza todo (fail-closed): conocer la URL ya no basta para inyectar eventos.
 */
export function unsignedWebhookAllowed(): boolean {
  return isMockEnabled();
}

/**
 * Aviso operativo (sin valores secretos) cuando la firma es obligatoria y falta
 * META_APP_SECRET. null si la configuración está bien o estamos en el gate de
 * pruebas. Lo usan el arranque y el webhook.
 */
export function webhookSecretMissingWarning(
  appSecret: string | undefined
): string | null {
  if (appSecret?.trim() || unsignedWebhookAllowed()) return null;
  return (
    "[webhook] META_APP_SECRET no está configurado: la firma x-hub-signature-256 " +
    "es obligatoria fuera del entorno de pruebas, así que el webhook de WhatsApp " +
    "RECHAZA todos los eventos (503) y no se ingiere ningún mensaje. Configura " +
    "META_APP_SECRET con el App Secret de la app de Meta que envía los webhooks " +
    "(developers.facebook.com → tu app → Configuración → Básica) o, detrás de " +
    "Wapi, con el mismo secreto del endpoint en Wapi, y reinicia."
  );
}
