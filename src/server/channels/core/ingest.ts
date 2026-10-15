import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { whatsappAccountIdOf } from "@/server/channels/dual-write";
import { publish } from "@/server/events/bus";
import { ensureAssetAvailable } from "@/server/whatsapp/media";
import { onLeadActivity } from "@/server/inbox/lead-activity";
import { maybeRunAgentTurn } from "@/server/ai/trigger";
import {
  findAccountByRef,
  findAccountsByParent,
  type AccountRow,
} from "@/server/channels/core/accounts";
import {
  getOrCreateChannelContact,
  getOrCreateWhatsappContact,
} from "@/server/channels/core/identity";
import { applyStatusUpdate } from "@/server/channels/core/status";
import { applyTemplateStatus } from "@/server/channels/core/templates";
import { serializeMessage } from "@/server/channels/core/serialize";
import type { ChannelRegistration } from "@/server/channels/registry";
import type {
  ChannelKind,
  ContactRef,
  ExternalAccountRef,
  InboundContent,
  InboundEvent,
  InboundMedia,
} from "@/server/channels/types";

/**
 * 005-livello-canali (M1.3, T028) — Ingesta del núcleo: eventos normalizados
 * (salida pura de `adapter.webhook.parse`) → contactos, conversaciones,
 * mensajes, estados, SSE, lead y agente. Es la lógica de
 * `src/server/inbox/ingest.ts:195-356` sin nada propio de WhatsApp:
 *
 * - la ORGANIZACIÓN la decide el núcleo desde `channel_account`
 *   (`UNIQUE (channel, external_account_id)`); cuenta desconocida → aviso y
 *   descarte, como hoy con un `phone_number_id` desconocido;
 * - los eventos se procesan EN ORDEN (WhatsApp: estados antes que mensajes);
 * - idempotencia dura por el ID externo (hasta R3 el árbitro de WhatsApp
 *   sigue siendo `wa_message_id`, ADR §3.3);
 * - un eco jamás abre la ventana ni despierta al agente, y pausa la IA.
 */

export type MediaInput = {
  kind: (typeof schema.mediaAsset.$inferSelect)["kind"];
  waMediaId: string | null;
  mimeType: string | null;
  fileName: string | null;
  caption: string | null;
  payload: unknown;
  fetchStatus: "available" | "pending";
};

/** Adjunto normalizado → fila de `media_asset` a crear. */
export function mediaInputOf(media: InboundMedia | null): MediaInput | null {
  if (!media) return null;
  if ("payload" in media) {
    return {
      kind: media.kind,
      waMediaId: null,
      mimeType: null,
      fileName: null,
      caption: null,
      payload: media.payload,
      fetchStatus: "available",
    };
  }
  if (!("externalMediaId" in media.ref)) {
    // Adjuntos por URL (Instagram/Messenger): `media_asset` no tiene aún dónde
    // guardar la URL (columna aditiva de M1.6/M3, ADR §3.2). El mensaje se
    // conserva sin adjunto, como un adjunto incompleto de hoy.
    return null;
  }
  return {
    kind: media.kind,
    waMediaId: media.ref.externalMediaId,
    mimeType: media.mimeType,
    fileName: media.fileName,
    caption: media.caption,
    payload: null,
    fetchStatus: "pending",
  };
}

/**
 * Columnas del ID externo de un mensaje. WhatsApp hasta R3: doble escritura
 * (`wa_message_id` = `external_message_id` = wamid). Otros canales: solo
 * `external_message_id`.
 */
export function messageIds(channel: ChannelKind, externalMessageId: string | null) {
  return {
    waMessageId: channel === "whatsapp" ? externalMessageId : null,
    channel,
    externalMessageId,
  };
}

/** Árbitro de la idempotencia del INSERT de un mensaje con ID externo. */
function messageConflictTarget(channel: ChannelKind) {
  // WhatsApp hasta R3: `wa_message_id` (UNIQUE de instancia, ADR §3.2 nota).
  // Otros canales: el índice por organización de R1.
  return channel === "whatsapp"
    ? { target: [schema.message.waMessageId] }
    : {
        target: [
          schema.message.organizationId,
          schema.message.channel,
          schema.message.externalMessageId,
        ],
      };
}

/**
 * Crea el media_asset de un mensaje recién insertado y dispara la descarga en
 * segundo plano si hay binario. Jamás lanza hacia el webhook (FR-013).
 */
async function attachMediaAsset(
  organizationId: string,
  messageId: string,
  media: MediaInput
): Promise<typeof schema.mediaAsset.$inferSelect | null> {
  try {
    const db = getDb();
    const inserted = await db
      .insert(schema.mediaAsset)
      .values({
        id: newId("mediaAsset"),
        organizationId,
        kind: media.kind,
        waMediaId: media.waMediaId,
        mimeType: media.mimeType,
        fileName: media.fileName,
        caption: media.caption,
        payload: media.payload ?? null,
        fetchStatus: media.fetchStatus,
      })
      .returning();
    const asset = inserted[0];
    if (!asset) return null;
    await db
      .update(schema.message)
      .set({ mediaAssetId: asset.id })
      .where(eq(schema.message.id, messageId));
    if (asset.fetchStatus === "pending") {
      // Descarga in-process, sin bloquear la ingesta; on-demand reintenta.
      void ensureAssetAvailable(organizationId, asset.id).catch(() => {});
    }
    return asset;
  } catch (err) {
    console.warn(`[media] no se pudo registrar el adjunto de ${messageId}:`, err);
    return null;
  }
}

/**
 * La conversación real del contacto (una por contacto hasta R3, D6). Si se
 * crea, lleva la cuenta del canal (`channel_account_id`); sin cuenta dada, la
 * cuenta WhatsApp de la organización (NULL si no tiene, como R1).
 */
export async function getOrCreateConversation(
  organizationId: string,
  contactId: string,
  channelAccountId?: string | null
) {
  const db = getDb();
  const inserted = await db
    .insert(schema.conversation)
    .values({
      id: newId("conversation"),
      organizationId,
      contactId,
      channelAccountId:
        channelAccountId === undefined ? whatsappAccountIdOf(organizationId) : channelAccountId,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return inserted[0];

  const rows = await db
    .select()
    .from(schema.conversation)
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.contactId, contactId),
        eq(schema.conversation.isTest, false)
      )
    )
    .limit(1);
  const existing = rows[0];
  if (!existing) throw new Error("conversación no encontrada tras upsert");
  return existing;
}

/** Contacto de una identidad del canal (WhatsApp: reconciliación 003). */
export async function resolveContact(
  organizationId: string,
  channel: ChannelKind,
  ref: ContactRef,
  opts: { reactivate?: boolean; accountScope?: { id: string } | null } = {}
) {
  if (channel === "whatsapp") {
    return getOrCreateWhatsappContact(
      organizationId,
      {
        identity: ref.externalId,
        phone: ref.phone ?? null,
        waUserId: ref.providerUserId ?? null,
        profileName: ref.displayName ?? null,
      },
      { reactivate: opts.reactivate }
    );
  }
  return getOrCreateChannelContact(
    organizationId,
    channel,
    { externalId: ref.externalId, displayName: ref.displayName ?? null },
    { reactivate: opts.reactivate, channelAccountId: opts.accountScope?.id ?? null }
  );
}

export type InboundMessageInput = {
  organizationId: string;
  channel: ChannelKind;
  /** Cuenta que recibió el mensaje (null = la cuenta WhatsApp de la org). */
  accountId?: string | null;
  identityScopeAccount?: { id: string } | null;
  from: ContactRef;
  externalMessageId: string;
  occurredAt: Date | null;
  content: { type: string; text: string | null };
  media?: MediaInput | null;
};

export async function ingestInboundMessage(input: InboundMessageInput): Promise<void> {
  const db = getDb();
  const { organizationId } = input;

  const { contact } = await resolveContact(organizationId, input.channel, input.from, {
    accountScope: input.identityScopeAccount ?? null,
  });
  const conversation = await getOrCreateConversation(
    organizationId,
    contact.id,
    input.accountId
  );

  const waTimestamp = input.occurredAt ?? new Date();

  // Idempotencia dura: mismo ID externo → sin efectos adicionales.
  const inserted = await db
    .insert(schema.message)
    .values({
      id: newId("message"),
      organizationId,
      conversationId: conversation.id,
      ...messageIds(input.channel, input.externalMessageId),
      direction: "in",
      type: input.content.type,
      text: input.content.text,
      status: "delivered",
      waTimestamp,
    })
    .onConflictDoNothing(messageConflictTarget(input.channel))
    .returning();
  const message = inserted[0];
  if (!message) return; // duplicado

  const asset = input.media
    ? await attachMediaAsset(organizationId, message.id, input.media)
    : null;

  await db
    .update(schema.conversation)
    .set({
      lastInboundAt: waTimestamp,
      lastMessageAt: waTimestamp,
      unreadCount: sql`${schema.conversation.unreadCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(schema.conversation.id, conversation.id));

  await onLeadActivity(organizationId, contact.id, waTimestamp);

  publish(organizationId, {
    type: "message.new",
    data: {
      conversationId: conversation.id,
      message: serializeMessage(message, asset),
    },
  });
  publish(organizationId, {
    type: "conversation.updated",
    data: { conversation: { id: conversation.id } },
  });

  await maybeRunAgentTurn(conversation.id);
}

/**
 * Eco: mensaje que el titular envió FUERA del CRM (WhatsApp: app del teléfono,
 * coexistence 008). Saliente `origin='manual'`; pausa la IA (decisión del
 * dueño 2026-08-04). JAMÁS toca la ventana ni dispara al agente.
 */
export async function ingestEcho(input: {
  organizationId: string;
  channel: ChannelKind;
  accountId?: string | null;
  identityScopeAccount?: { id: string } | null;
  to: ContactRef;
  externalMessageId: string;
  occurredAt: Date | null;
  content: InboundContent;
}): Promise<void> {
  const db = getDb();
  const { organizationId } = input;

  const { contact } = await resolveContact(
    organizationId,
    input.channel,
    // El destinatario del eco solo aporta su identidad (sin nombre de perfil).
    { ...input.to, providerUserId: input.to.providerUserId ?? null, displayName: null },
    { accountScope: input.identityScopeAccount ?? null }
  );
  const conversation = await getOrCreateConversation(organizationId, contact.id, input.accountId);

  const waTimestamp = input.occurredAt ?? new Date();

  // Idempotencia dura: los mensajes ya registrados (o ecos repetidos) no
  // duplican efectos — mismo ID externo → sin inserción ni handoff extra.
  const inserted = await db
    .insert(schema.message)
    .values({
      id: newId("message"),
      organizationId,
      conversationId: conversation.id,
      ...messageIds(input.channel, input.externalMessageId),
      direction: "out",
      type: input.content.type,
      text: input.content.text,
      status: "sent",
      origin: "manual",
      waTimestamp,
    })
    .onConflictDoNothing(messageConflictTarget(input.channel))
    .returning();
  const message = inserted[0];
  if (!message) return; // duplicado

  const mediaInput = mediaInputOf(input.content.media);
  const asset = mediaInput
    ? await attachMediaAsset(organizationId, message.id, mediaInput)
    : null;

  // Solo lastMessageAt: un mensaje del negocio NUNCA abre la ventana.
  await db
    .update(schema.conversation)
    .set({ lastMessageAt: waTimestamp, updatedAt: new Date() })
    .where(eq(schema.conversation.id, conversation.id));

  // Pausa automática de la IA, idempotente y atómica (solo si no hay handoff).
  const paused = await db
    .update(schema.conversation)
    .set({
      aiEnabled: false,
      handoffAt: new Date(),
      handoffReason: "manual_reply",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.conversation.id, conversation.id),
        sql`${schema.conversation.handoffAt} is null`
      )
    )
    .returning();
  if (paused[0]) {
    console.log(
      `[webhook] respuesta manual del dueño en ${conversation.id} — IA pausada (manual_reply)`
    );
  }

  publish(organizationId, {
    type: "message.new",
    data: {
      conversationId: conversation.id,
      message: serializeMessage(message, asset),
    },
  });
  publish(organizationId, {
    type: "conversation.updated",
    data: { conversation: { id: conversation.id } },
  });
}

function refKey(channel: ChannelKind, ref: ExternalAccountRef): string {
  return ref.by === "account"
    ? `${channel}|a|${ref.externalAccountId}`
    : `${channel}|p|${ref.externalParentId}`;
}

function refLabel(ref: ExternalAccountRef): string {
  return ref.by === "account" ? ref.externalAccountId : `padre ${ref.externalParentId}`;
}

/**
 * Procesa, EN ORDEN, los eventos de un webhook ya autenticado. Un error de
 * ingesta corta el resto del lote (como hoy: el webhook ya respondió 200 y el
 * error queda en el log); un eco malformado no (edge case del spec 008).
 */
export async function processInboundEvents(
  registration: ChannelRegistration,
  events: readonly InboundEvent[]
): Promise<void> {
  const { adapter } = registration;
  const accounts = new Map<string, AccountRow | null>();
  const resolve = async (channel: ChannelKind, ref: ExternalAccountRef) => {
    const key = refKey(channel, ref);
    if (!accounts.has(key)) {
      const row = await findAccountByRef(channel, ref);
      accounts.set(key, row);
      if (!row) {
        // Caso típico: webhook configurado ANTES de guardar la conexión — el
        // evento llega pero no hay a qué organización enrutarlo.
        console.warn(
          `[webhook] evento ${channel} para una cuenta desconocida (${refLabel(ref)}): ` +
            "guarda la conexión en Configuración para recibir mensajes"
        );
      }
    }
    return accounts.get(key) ?? null;
  };

  for (const event of events) {
    if (event.kind === "template_status" && event.account.by === "parent") {
      // Evento de la cuenta padre (WABA): las plantillas son de la WABA, así
      // que el estado vale para CADA organización con un número en ella
      // (revisión PR #14: antes, una sola y sin orden).
      const accountsOfParent = await findAccountsByParent(event.channel, event.account.externalParentId);
      const orgs = [...new Set(accountsOfParent.map((a) => a.organizationId))];
      for (const organizationId of orgs) {
        await applyTemplateStatus(organizationId, {
          event: event.event,
          name: event.name,
          language: event.language,
          reason: event.reason,
        });
      }
      continue;
    }
    if (event.kind === "ignored") {
      if (event.reason === "no_identity") {
        console.warn(
          `[webhook] mensaje ${event.externalMessageId ?? "?"} sin identidad utilizable (sin from ni from_user_id): descartado`
        );
      } else if (event.reason === "no_recipient") {
        console.warn(`[webhook] echo ${event.externalMessageId ?? "?"} sin destinatario: descartado`);
      }
      continue;
    }
    if (event.kind === "provider") {
      const handler = registration.providerEvents?.[event.name];
      if (handler) await handler({ parentId: event.parentId, payload: event.payload });
      continue;
    }

    const account = await resolve(event.channel, event.account);
    if (!account) continue;
    const organizationId = account.organizationId;
    const scopeAccount = adapter.capabilities.identityScope === "account" ? { id: account.id } : null;

    if (event.kind === "status") {
      await applyStatusUpdate(organizationId, {
        channel: event.channel,
        externalMessageId: event.externalMessageId,
        status: event.status,
        error: event.error,
      });
    } else if (event.kind === "message") {
      await ingestInboundMessage({
        organizationId,
        channel: event.channel,
        accountId: account.id,
        identityScopeAccount: scopeAccount,
        from: event.from,
        externalMessageId: event.externalMessageId,
        occurredAt: event.occurredAt,
        content: event.content,
        media: mediaInputOf(event.content.media),
      });
    } else if (event.kind === "echo") {
      try {
        await ingestEcho({
          organizationId,
          channel: event.channel,
          accountId: account.id,
          identityScopeAccount: scopeAccount,
          to: event.to,
          externalMessageId: event.externalMessageId,
          occurredAt: event.occurredAt,
          content: event.content,
        });
      } catch (err) {
        // Un eco malformado jamás tumba el webhook (edge case del spec).
        console.error(`[webhook] error procesando echo ${event.externalMessageId}:`, err);
      }
    } else if (event.kind === "template_status") {
      await applyTemplateStatus(organizationId, {
        event: event.event,
        name: event.name,
        language: event.language,
        reason: event.reason,
      });
    }
  }
}
