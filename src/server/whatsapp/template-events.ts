import type { WebhookValue } from "@/server/inbox/webhook";
import { applyTemplateStatusEvent } from "@/server/whatsapp/templates";

/**
 * Evento `message_template_status_update` (llega a nivel WABA: se enruta por
 * entry.id). Idempotente: re-aplicar el mismo estado no tiene efectos.
 * 005 (M1.3): el webhook ya no pasa por aquí (lo procesa el núcleo como
 * evento `template_status`); se conserva la firma para sus llamadores.
 */
export async function processTemplateStatusValue(
  wabaId: string | null,
  value: WebhookValue
): Promise<void> {
  await applyTemplateStatusEvent(wabaId, value);
}
