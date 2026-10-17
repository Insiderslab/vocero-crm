import {
  getOrCreateConversation as coreGetOrCreateConversation,
  mediaInputOf,
  type MediaInput,
} from "@/server/channels/core/ingest";
import { serializeMessage } from "@/server/channels/core/serialize";
import { inboundMediaFrom } from "@/server/channels/whatsapp/parse";
import type { WebhookMessage } from "@/server/inbox/webhook";

/**
 * Ingesta del webhook de WhatsApp. 005 (M1.3, T031): módulo DELGADO con las
 * mismas firmas exportadas; la lógica vive en el núcleo
 * (`src/server/channels/core/ingest.ts`) y en el `parse` puro del adaptador
 * (`src/server/channels/whatsapp/parse.ts`). Se elimina cuando no tenga
 * llamadores (refactor dedicado, Leyes §3.5).
 *
 * Revisión PR #14: fuera los exports SIN llamadores (`processMessagesValue`,
 * `processEchoesValue`, `ingestInboundMessage`, `getOrCreateContact`: el
 * webhook ya entra por el núcleo). Quedan, con la misma firma, los que se
 * importan: `getOrCreateConversation`, `mediaInputFrom`, `serializeMessage`.
 */

export { serializeMessage };

/**
 * 008 — Extrae el adjunto de un mensaje del webhook (entrante o echo).
 * Tolerante: payload incompleto → null (el mensaje se conserva sin adjunto).
 */
export function mediaInputFrom(msg: WebhookMessage): MediaInput | null {
  return mediaInputOf(inboundMediaFrom(msg));
}

export async function getOrCreateConversation(
  organizationId: string,
  contactId: string
) {
  return coreGetOrCreateConversation(organizationId, contactId);
}
