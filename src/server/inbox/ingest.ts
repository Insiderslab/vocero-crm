import { normalizeMx } from "@/lib/meta/client";
import {
  getOrCreateConversation as coreGetOrCreateConversation,
  ingestInboundMessage as coreIngestInboundMessage,
  mediaInputOf,
  processInboundEvents,
  type MediaInput,
} from "@/server/channels/core/ingest";
import { serializeMessage } from "@/server/channels/core/serialize";
import { channelRegistry } from "@/server/channels/registry";
import { whatsappAdapter } from "@/server/channels/whatsapp/adapter";
import {
  contactRefOf,
  inboundMediaFrom,
} from "@/server/channels/whatsapp/parse";
import type { WebhookMessage, WebhookValue } from "@/server/inbox/webhook";
import {
  getOrCreateContactByIdentity,
  type ResolvedIdentity,
} from "@/server/inbox/identity";

/**
 * Ingesta del webhook de WhatsApp. 005 (M1.3, T031): módulo DELGADO con las
 * mismas firmas exportadas; la lógica vive en el núcleo
 * (`src/server/channels/core/ingest.ts`) y en el `parse` puro del adaptador
 * (`src/server/channels/whatsapp/parse.ts`). Se elimina cuando no tenga
 * llamadores (refactor dedicado, Leyes §3.5).
 */

export { serializeMessage };

/**
 * 008 — Extrae el adjunto de un mensaje del webhook (entrante o echo).
 * Tolerante: payload incompleto → null (el mensaje se conserva sin adjunto).
 */
export function mediaInputFrom(msg: WebhookMessage): MediaInput | null {
  return mediaInputOf(inboundMediaFrom(msg));
}

/**
 * Alta/resolución de contacto por teléfono (alta manual / seeds). La ingesta
 * del webhook usa `getOrCreateContactByIdentity` (003) — este helper deriva la
 * identidad del teléfono normalizado y delega ahí.
 */
export async function getOrCreateContact(
  organizationId: string,
  phone: string,
  name?: string | null
) {
  const normalized = normalizeMx(phone);
  return getOrCreateContactByIdentity(organizationId, {
    identity: normalized,
    phone: normalized,
    waUserId: null,
    profileName: name ?? null,
  });
}

export async function getOrCreateConversation(
  organizationId: string,
  contactId: string
) {
  return coreGetOrCreateConversation(organizationId, contactId);
}

/** Un `value` de un solo `field` → los eventos del adaptador, por el núcleo. */
async function processField(field: string, value: WebhookValue): Promise<void> {
  const registration = channelRegistry.byChannel("whatsapp")!;
  const events = whatsappAdapter.webhook.parse({ entry: [{ changes: [{ field, value }] }] });
  await processInboundEvents(registration, events);
}

/**
 * Procesa el `value` de un cambio `messages` del webhook: mensajes entrantes
 * (idempotentes por wa_message_id) y actualizaciones de estado.
 */
export async function processMessagesValue(value: WebhookValue): Promise<void> {
  await processField("messages", value);
}

/**
 * 008 — Echoes de coexistence (`smb_message_echoes`): mensajes que el dueño
 * envió A MANO desde la app de WhatsApp Business del teléfono.
 */
export async function processEchoesValue(value: WebhookValue): Promise<void> {
  await processField("smb_message_echoes", value);
}

export async function ingestInboundMessage(input: {
  organizationId: string;
  identity: ResolvedIdentity;
  waMessageId: string;
  type: string;
  text: string | null;
  timestamp: string;
  media?: MediaInput | null;
}): Promise<void> {
  const n = Number(input.timestamp);
  await coreIngestInboundMessage({
    organizationId: input.organizationId,
    channel: "whatsapp",
    from: contactRefOf(input.identity),
    externalMessageId: input.waMessageId,
    occurredAt: Number.isFinite(n) && n > 0 ? new Date(n * 1000) : null,
    content: { type: input.type, text: input.text },
    media: input.media ?? null,
  });
}
