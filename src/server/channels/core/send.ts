import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { publish } from "@/server/events/bus";
import { SendError } from "@/server/channels/errors";
import {
  accountContext,
  findAccountForOrg,
  type AccountRow,
} from "@/server/channels/core/accounts";
import { messageIds } from "@/server/channels/core/ingest";
import { serializeMessage } from "@/server/channels/core/serialize";
import { replyWindowOpen } from "@/server/channels/core/window";
import { channelRegistry, type ChannelLookup } from "@/server/channels/registry";
import type {
  ChannelAdapter,
  ChannelKind,
  OutboundMessage,
  SendContext,
} from "@/server/channels/types";
import { isListeningMode, listeningModeError } from "@/server/listening/mode";
import { saveMediaFile, validateOutgoing } from "@/server/whatsapp/media";

/**
 * 005-livello-canali (M1.3, T028) — Envío en el núcleo.
 *
 * Orden de los controles = el de hoy (`src/server/inbox/send.ts:52-112`, ADR
 * §3.1 «Confini»), igual para todos los canales:
 *   existencia + tenant → SANDBOX del Laboratorio → ventana (desde las
 *   capacidades del canal) → cuenta conectada → destinatario.
 * El sandbox vive AQUÍ y solo aquí: una conversación `is_test` jamás llega a
 * `adapter.send` (FR-031). El adaptador solo habla con el proveedor.
 */

type SendResult = { messageId: string };

type SendTarget = {
  conversation: typeof schema.conversation.$inferSelect;
  adapter: ChannelAdapter;
  account: AccountRow;
  ctx: SendContext;
};

/**
 * Pre-flight común de todo envío por la conversación (008).
 * `lookup` es inyectable para los tests (adaptador falso); en la app es el
 * registro de canales.
 */
export async function prepareSend(
  conversationId: string,
  organizationId: string,
  lookup: ChannelLookup = channelRegistry
): Promise<SendTarget> {
  const db = getDb();
  const rows = await db
    .select({
      conversation: schema.conversation,
      contact: schema.contact,
      // El canal de la conversación es el de su cuenta (ADR §3.2).
      accountChannel: schema.channelAccount.channel,
    })
    .from(schema.conversation)
    .innerJoin(
      schema.contact,
      eq(schema.conversation.contactId, schema.contact.id)
    )
    .leftJoin(
      schema.channelAccount,
      and(
        eq(schema.channelAccount.id, schema.conversation.channelAccountId),
        eq(schema.channelAccount.organizationId, schema.conversation.organizationId)
      )
    )
    .where(eq(schema.conversation.id, conversationId))
    .limit(1);
  const row = rows[0];
  if (!row || row.conversation.organizationId !== organizationId) {
    throw new SendError("meta_error", "Conversación no encontrada");
  }

  if (row.conversation.isTest) {
    throw new SendError(
      "sandbox_violation",
      "Conversación de prueba del Laboratorio: el envío real está prohibido"
    );
  }

  // Sin cuenta (Laboratorio, conversación anterior a la conexión): WhatsApp.
  const channel: ChannelKind = row.accountChannel ?? "whatsapp";
  const registration = lookup.byChannel(channel);
  if (!registration) {
    throw new SendError("not_connected", "El canal de esta conversación no está disponible");
  }
  const { adapter } = registration;

  if (!replyWindowOpen(adapter.capabilities.replyWindow, row.conversation.lastInboundAt)) {
    throw new SendError(
      "window_closed",
      "La ventana de 24 horas está cerrada; usa una plantilla aprobada"
    );
  }

  const account = await findAccountForOrg(organizationId, channel);
  if (!account) {
    throw new SendError("not_connected", "No hay número de WhatsApp conectado");
  }
  if (account.status === "reconnect_required") {
    throw new SendError(
      "reconnect_required",
      "El token de WhatsApp expiró: reconecta el número en Configuración"
    );
  }

  // WhatsApp hasta R3: la identidad = wa_identity (una por contacto, V3).
  const identity =
    channel === "whatsapp"
      ? row.contact.waIdentity
      : await channelIdentity(organizationId, row.contact.id, channel);
  const providerIdentity = {
    externalId: identity,
    phone: row.contact.phone,
    providerUserId: row.contact.waUserId,
  };
  // 003 (WhatsApp): teléfono normalizado o, sin teléfono, el BSUID.
  const recipient = adapter.recipientFor
    ? adapter.recipientFor(providerIdentity)
    : identity || null;
  if (!recipient) {
    throw new SendError(
      "meta_error",
      "El contacto no tiene teléfono ni identidad de WhatsApp utilizable"
    );
  }

  return {
    conversation: row.conversation,
    adapter,
    account,
    ctx: {
      ...accountContext(account),
      recipient: { ...providerIdentity, externalId: recipient },
    },
  };
}

/** El ID externo del contacto en un canal que no es WhatsApp ("" si no tiene). */
async function channelIdentity(
  organizationId: string,
  contactId: string,
  channel: ChannelKind
): Promise<string> {
  const ci = schema.contactIdentity;
  const rows = await getDb()
    .select({ externalId: ci.externalId })
    .from(ci)
    .where(and(eq(ci.organizationId, organizationId), eq(ci.contactId, contactId), eq(ci.channel, channel)))
    .limit(1);
  return rows[0]?.externalId ?? "";
}

export async function persistOutbound(input: {
  organizationId: string;
  conversationId: string;
  channel: ChannelKind;
  externalMessageId: string | null;
  type: string;
  text: string | null;
  status: "pending" | "failed";
  error?: string | null;
  aiGenerated?: boolean;
  origin: "ai" | "operator" | "template";
  mediaAssetId?: string | null;
  media?: typeof schema.mediaAsset.$inferSelect | null;
}): Promise<string> {
  const db = getDb();
  const inserted = await db
    .insert(schema.message)
    .values({
      id: newId("message"),
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      ...messageIds(input.channel, input.externalMessageId),
      direction: "out",
      type: input.type,
      text: input.text,
      status: input.status,
      error: input.error ?? null,
      aiGenerated: input.aiGenerated ?? false,
      origin: input.origin,
      mediaAssetId: input.mediaAssetId ?? null,
    })
    .returning();
  const message = inserted[0]!;

  await db
    .update(schema.conversation)
    .set({ lastMessageAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.conversation.id, input.conversationId));

  publish(input.organizationId, {
    type: "message.new",
    data: {
      conversationId: input.conversationId,
      message: serializeMessage(message, input.media ?? null),
    },
  });

  return message.id;
}

/** Envía un mensaje de texto libre por el canal de la conversación. */
export async function sendText(
  input: {
    conversationId: string;
    organizationId: string;
    text: string;
    aiGenerated?: boolean;
  },
  lookup: ChannelLookup = channelRegistry
): Promise<SendResult> {
  // 016 — modalità ascolto: un invio dell'IA (anche di un turno già pianificato
  // prima dell'accensione) non arriva mai al provider né lascia un messaggio.
  if (input.aiGenerated && (await isListeningMode(input.organizationId))) {
    throw listeningModeError();
  }
  const target = await prepareSend(input.conversationId, input.organizationId, lookup);

  const { externalMessageId } = await target.adapter.send(target.ctx, {
    kind: "text",
    text: input.text,
  });

  const messageId = await persistOutbound({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    channel: target.adapter.channel,
    externalMessageId,
    type: "text",
    text: input.text,
    status: "pending",
    aiGenerated: input.aiGenerated,
    origin: input.aiGenerated ? "ai" : "operator",
  });

  return { messageId };
}

/**
 * 008 — Envía un adjunto de archivo (imagen/video/audio/documento).
 * El archivo queda ANTES en el volumen local (fuente durable de la preview);
 * si el proveedor falla tras eso, el mensaje se persiste `failed` (visible en
 * el hilo, nunca se pierde en silencio) y el SendError lleva `messageId`.
 */
export async function sendMediaMessage(
  input: {
    conversationId: string;
    organizationId: string;
    file: { data: Buffer; mimeType: string; fileName?: string };
    caption?: string;
  },
  lookup: ChannelLookup = channelRegistry
): Promise<SendResult> {
  // Validación previa (FR-007): tipo y tamaño antes de tocar disco o red.
  const kind = validateOutgoing(input.file.mimeType, input.file.data.byteLength);

  const target = await prepareSend(input.conversationId, input.organizationId, lookup);

  const db = getDb();
  const assetId = newId("mediaAsset");
  const storagePath = await saveMediaFile(
    input.organizationId,
    assetId,
    input.file.data
  );
  const assetRows = await db
    .insert(schema.mediaAsset)
    .values({
      id: assetId,
      organizationId: input.organizationId,
      kind,
      mimeType: input.file.mimeType,
      fileName: input.file.fileName ?? null,
      fileSize: input.file.data.byteLength,
      caption: input.caption ?? null,
      storagePath,
      fetchStatus: "available",
    })
    .returning();
  const asset = assetRows[0]!;

  const message: OutboundMessage = {
    kind: "media",
    mediaKind: kind,
    file: input.file,
    ...(input.caption !== undefined ? { caption: input.caption } : {}),
  };
  try {
    const { externalMessageId } = await target.adapter.send(
      {
        ...target.ctx,
        // Upload antes del envío (orden de hoy): el asset guarda el media id.
        onMediaUploaded: async (waMediaId) => {
          await db
            .update(schema.mediaAsset)
            .set({ waMediaId, updatedAt: new Date() })
            .where(eq(schema.mediaAsset.id, assetId));
        },
      },
      message
    );

    const messageId = await persistOutbound({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      channel: target.adapter.channel,
      externalMessageId,
      type: kind,
      text: null,
      status: "pending",
      origin: "operator",
      mediaAssetId: assetId,
      media: asset,
    });
    return { messageId };
  } catch (err) {
    const sendErr =
      err instanceof SendError
        ? err
        : new SendError("upload_failed", "No se pudo subir el adjunto a WhatsApp");
    // El contenido NO se pierde: mensaje failed con el asset ya en disco.
    sendErr.messageId = await persistOutbound({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      channel: target.adapter.channel,
      externalMessageId: null,
      type: kind,
      text: null,
      status: "failed",
      error: sendErr.message,
      origin: "operator",
      mediaAssetId: assetId,
      media: asset,
    });
    throw sendErr;
  }
}

export type LocationInput = {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
};

export type ContactInput = { name: string; phone: string };

/** 008 — Envía una ubicación o contactos (payload estructurado, sin archivo). */
export async function sendStructured(
  input: {
    conversationId: string;
    organizationId: string;
  } & (
    | { kind: "location"; location: LocationInput }
    | { kind: "contacts"; contacts: ContactInput[] }
  ),
  lookup: ChannelLookup = channelRegistry
): Promise<SendResult> {
  const target = await prepareSend(input.conversationId, input.organizationId, lookup);

  const { externalMessageId } = await target.adapter.send(
    target.ctx,
    input.kind === "location"
      ? { kind: "location", location: input.location }
      : { kind: "contacts", contacts: input.contacts }
  );

  const db = getDb();
  const assetRows = await db
    .insert(schema.mediaAsset)
    .values({
      id: newId("mediaAsset"),
      organizationId: input.organizationId,
      kind: input.kind,
      payload: input.kind === "location" ? input.location : input.contacts,
      fetchStatus: "available",
    })
    .returning();
  const asset = assetRows[0]!;

  const messageId = await persistOutbound({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    channel: target.adapter.channel,
    externalMessageId,
    type: input.kind,
    text: null,
    status: "pending",
    origin: "operator",
    mediaAssetId: asset.id,
    media: asset,
  });
  return { messageId };
}
