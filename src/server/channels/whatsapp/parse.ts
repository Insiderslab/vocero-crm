import { normalizeMx } from "@/lib/meta/client";
import type {
  ContactRef,
  InboundEvent,
  InboundMedia,
} from "@/server/channels/types";
import type {
  WebhookMediaPayload,
  WebhookMessage,
  WebhookPayload,
  WebhookValue,
} from "@/server/inbox/webhook";

/**
 * 005-livello-canali (M1.3, T027) — `parse` PURO del webhook de WhatsApp.
 *
 * Es la lógica que antes vivía repartida en la ruta `wa` (`processPayload`,
 * el reparto de los seis `field`), `src/server/inbox/ingest.ts`
 * (`processMessagesValue`, `processEchoesValue`, `mediaInputFrom`) y
 * `src/server/inbox/identity.ts` (`resolveIdentity`), sin BD, sin red y sin
 * reloj: payload → `InboundEvent[]`. El ORDEN de los eventos es el orden de
 * procesamiento de hoy: por cada `entry`, por cada `change`; dentro de un
 * `messages`, primero los estados y luego los mensajes.
 */

const CHANNEL = "whatsapp" as const;

/** Tipos de contenido soportados; el resto se ignora sin error. */
export const SUPPORTED_TYPES: ReadonlySet<string> = new Set([
  "text",
  "image",
  "audio",
  "video",
  "document",
  "sticker",
  "location",
  "contacts",
]);

/** Tipos con archivo binario en Graph (008). */
const BINARY_MEDIA_TYPES = new Set([
  "image",
  "video",
  "audio",
  "document",
  "sticker",
] as const);

type BinaryKind = "image" | "video" | "audio" | "document" | "sticker";


export const BSUID_PREFIX = "bsuid:";

export type ResolvedIdentity = {
  /** Llave estable de resolución: teléfono normalizado o `bsuid:<id>`. */
  identity: string;
  phone: string | null;
  waUserId: string | null;
  profileName: string | null;
};

/**
 * Identidad utilizable de un mensaje del webhook (003). null si el mensaje no
 * trae NINGUNA identidad (se descarta con log, jamás se revienta el webhook).
 */
export function resolveIdentity(
  msg: WebhookMessage,
  contacts: WebhookValue["contacts"]
): ResolvedIdentity | null {
  const waUserId =
    msg.from_user_id ??
    contacts?.find((c) => c.wa_id != null && c.wa_id === msg.from)?.user_id ??
    contacts?.find((c) => c.user_id != null)?.user_id ??
    null;

  const profileName =
    contacts?.find((c) => c.wa_id != null && c.wa_id === msg.from)?.profile
      ?.name ??
    (waUserId
      ? contacts?.find((c) => c.user_id === waUserId)?.profile?.name
      : undefined) ??
    null;

  if (msg.from) {
    const phone = normalizeMx(msg.from);
    return { identity: phone, phone, waUserId, profileName };
  }
  if (waUserId) {
    return {
      identity: `${BSUID_PREFIX}${waUserId}`,
      phone: null,
      waUserId,
      profileName,
    };
  }
  return null;
}

/** La identidad de WhatsApp como `ContactRef` del contrato. */
export function contactRefOf(resolved: ResolvedIdentity): ContactRef {
  return {
    externalId: resolved.identity,
    phone: resolved.phone,
    providerUserId: resolved.waUserId,
    displayName: resolved.profileName,
  };
}

/**
 * 008 — Adjunto de un mensaje del webhook (entrante o echo). Tolerante:
 * payload incompleto → null (el mensaje se conserva sin adjunto).
 */
export function inboundMediaFrom(msg: WebhookMessage): InboundMedia | null {
  if (msg.type === "location" && msg.location) {
    const { latitude, longitude } = msg.location;
    if (typeof latitude !== "number" || typeof longitude !== "number") {
      return null;
    }
    return { kind: "location", payload: msg.location };
  }
  if (msg.type === "contacts" && Array.isArray(msg.contacts) && msg.contacts.length) {
    return { kind: "contacts", payload: msg.contacts };
  }
  if ((BINARY_MEDIA_TYPES as Set<string>).has(msg.type)) {
    const media = msg[msg.type as BinaryKind] as WebhookMediaPayload | undefined;
    if (!media?.id) return null;
    return {
      kind: msg.type as BinaryKind,
      ref: { externalMediaId: media.id },
      mimeType: media.mime_type ?? null,
      fileName: media.filename ?? null,
      caption: media.caption ?? null,
    };
  }
  return null;
}

/** Segundos epoch de Meta → Date; ilegible → null (el núcleo usa la hora de recepción). */
function toDate(timestamp: unknown): Date | null {
  const n = Number(timestamp);
  if (Number.isFinite(n) && n > 0) return new Date(n * 1000);
  return null;
}

function content(msg: WebhookMessage) {
  return {
    type: msg.type,
    text: msg.text?.body ?? null,
    media: inboundMediaFrom(msg),
  };
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const STATUSES = new Set(["sent", "delivered", "read", "failed"]);

/** `messages`: estados (antes) y mensajes entrantes del número. */
function parseMessages(value: WebhookValue, out: InboundEvent[]): void {
  const phoneNumberId = value.metadata?.phone_number_id;
  if (!phoneNumberId || typeof phoneNumberId !== "string") return;
  const account = { by: "account" as const, externalAccountId: phoneNumberId };

  for (const status of Array.isArray(value.statuses) ? value.statuses : []) {
    if (!isObject(status) || typeof status.id !== "string") continue;
    // Estados desconocidos: se ignoran (como `applyStatusUpdate`).
    if (!STATUSES.has(status.status)) continue;
    const failure = Array.isArray(status.errors) ? status.errors[0] : undefined;
    out.push({
      kind: "status",
      channel: CHANNEL,
      account,
      externalMessageId: status.id,
      status: status.status as "sent" | "delivered" | "read" | "failed",
      ...(failure
        ? {
            error: {
              ...(failure.code !== undefined ? { code: failure.code } : {}),
              ...((failure.message ?? failure.title) !== undefined
                ? { message: failure.message ?? failure.title }
                : {}),
            },
          }
        : {}),
    });
  }

  for (const msg of Array.isArray(value.messages) ? value.messages : []) {
    if (!isObject(msg) || typeof msg.id !== "string") continue;
    if (!SUPPORTED_TYPES.has(msg.type)) {
      // reacciones, etc.: ignorar
      out.push({ kind: "ignored", channel: CHANNEL, reason: "unsupported_type", externalMessageId: msg.id });
      continue;
    }
    const resolved = resolveIdentity(msg, value.contacts);
    if (!resolved) {
      // Sin NINGUNA identidad utilizable (ni teléfono ni BSUID) (003).
      out.push({ kind: "ignored", channel: CHANNEL, reason: "no_identity", externalMessageId: msg.id });
      continue;
    }
    out.push({
      kind: "message",
      channel: CHANNEL,
      account,
      externalMessageId: msg.id,
      occurredAt: toDate(msg.timestamp),
      from: contactRefOf(resolved),
      content: content(msg),
    });
  }
}

/**
 * 008 — `smb_message_echoes`: mensajes que el dueño envió A MANO desde la app
 * del teléfono (coexistence). Meta documenta `message_echoes`; parser
 * tolerante a `messages`.
 */
function parseEchoes(value: WebhookValue, out: InboundEvent[]): void {
  const phoneNumberId = value.metadata?.phone_number_id;
  if (!phoneNumberId || typeof phoneNumberId !== "string") return;
  const account = { by: "account" as const, externalAccountId: phoneNumberId };
  const echoes = value.message_echoes ?? value.messages ?? [];
  for (const echo of Array.isArray(echoes) ? echoes : []) {
    if (!isObject(echo) || typeof echo.id !== "string") continue;
    if (!SUPPORTED_TYPES.has(echo.type)) {
      out.push({ kind: "ignored", channel: CHANNEL, reason: "unsupported_type", externalMessageId: echo.id });
      continue;
    }
    if (!echo.to) {
      out.push({ kind: "ignored", channel: CHANNEL, reason: "no_recipient", externalMessageId: echo.id });
      continue;
    }
    const identity = normalizeMx(String(echo.to));
    out.push({
      kind: "echo",
      channel: CHANNEL,
      account,
      externalMessageId: echo.id,
      occurredAt: toDate(echo.timestamp),
      to: { externalId: identity, phone: identity, providerUserId: null, displayName: null },
      content: content(echo),
    });
  }
}

/** Campos de la coexistence (009) que el núcleo no modela: evento `provider`. */
const PROVIDER_FIELDS = new Set(["history", "smb_app_state_sync", "account_update"]);

/** Payload del webhook de WhatsApp → eventos normalizados, en orden. */
export function parseWhatsappPayload(payload: unknown): InboundEvent[] {
  if (!isObject(payload) || !Array.isArray(payload.entry)) return [];
  const out: InboundEvent[] = [];
  for (const entry of (payload as WebhookPayload).entry ?? []) {
    if (!isObject(entry) || !Array.isArray(entry.changes)) continue;
    const entryId = typeof entry.id === "string" && entry.id ? entry.id : null;
    for (const change of entry.changes) {
      if (!isObject(change) || !isObject(change.value)) continue;
      const value = change.value as WebhookValue;
      if (change.field === "messages") {
        parseMessages(value, out);
      } else if (change.field === "smb_message_echoes") {
        parseEchoes(value, out);
      } else if (change.field === "message_template_status_update") {
        // Llega a nivel WABA: se enruta por entry.id (sin él no hay a quién).
        if (!entryId) continue;
        out.push({
          kind: "template_status",
          channel: CHANNEL,
          account: { by: "parent", externalParentId: entryId },
          event: typeof value.event === "string" ? value.event : "",
          ...(value.message_template_id !== undefined && value.message_template_id !== null
            ? { templateExternalId: String(value.message_template_id) }
            : {}),
          ...(value.message_template_name !== undefined ? { name: value.message_template_name } : {}),
          ...(value.message_template_language !== undefined
            ? { language: value.message_template_language }
            : {}),
          reason: value.reason ?? null,
        });
      } else if (typeof change.field === "string" && PROVIDER_FIELDS.has(change.field)) {
        out.push({
          kind: "provider",
          channel: CHANNEL,
          name: change.field,
          parentId: entryId,
          payload: value,
        });
      }
      // otros fields: ignorar sin error
    }
  }
  return out;
}
