import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { normalizeMx } from "@/lib/meta/client";
import { publish } from "@/server/events/bus";
import {
  getCredentialsByPhoneNumberId,
  setAppDisconnected,
} from "@/server/whatsapp/credentials";
import type { HistoryMessage, WebhookValue } from "@/server/inbox/webhook";
import { getOrCreateContactByIdentity } from "@/server/inbox/identity";
import { getOrCreateConversation } from "@/server/inbox/ingest";

/**
 * 009 — Coexistence: el número sigue en la app WhatsApp Business del teléfono
 * y además entra al CRM. Este módulo procesa los tres webhooks propios de la
 * coexistence (los echoes `smb_message_echoes` ya viven en ingest.ts, 008):
 *
 * - `history`: hasta 180 días de chats de la app, una sola vez tras conectar.
 *   Se importa como hilo, SIN efectos de mensaje nuevo: no abre la ventana de
 *   24 h, no suma no-leídos, no crea leads en el pipeline, no despierta a la IA.
 * - `smb_app_state_sync`: la agenda del teléfono → solo nombres (ver
 *   `waAddressBookEntry` en el schema).
 * - `account_update`: avisos de corte/reconexión de la coexistence.
 */

type MessageStatus = (typeof schema.message.$inferInsert)["status"];

const HISTORY_TYPES = new Set([
  "text",
  "image",
  "audio",
  "video",
  "document",
  "sticker",
  "location",
  "contacts",
]);

const MEDIA_TYPES = new Set(["image", "video", "audio", "document", "sticker"]);

const HISTORY_INSERT_BATCH = 500;
const STATE_SYNC_BATCH = 500;

/** Código de Meta: el negocio no compartió el historial en el popup. */
export const HISTORY_DECLINED_CODE = 2593109;

export type ParsedHistoryMessage = {
  /** Identidad del CLIENTE del hilo (teléfono normalizado). */
  identity: string;
  direction: "in" | "out";
  waMessageId: string;
  type: string;
  text: string | null;
  timestamp: Date;
  status: NonNullable<MessageStatus>;
};

export type ParsedHistory = {
  declined: boolean;
  messages: ParsedHistoryMessage[];
  /** Avance reportado por Meta (0–100) del último bloque, si viene. */
  progress: number | null;
};

const digits = (v: string) => v.replace(/\D/g, "");

function toDate(timestamp: string | undefined): Date | null {
  const n = Number(timestamp);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : null;
}

function historyStatus(
  direction: "in" | "out",
  raw: string | undefined
): NonNullable<MessageStatus> {
  const s = (raw ?? "").toUpperCase();
  if (direction === "in")
    return s === "READ" || s === "PLAYED" ? "read" : "delivered";
  if (s === "READ" || s === "PLAYED") return "read";
  if (s === "DELIVERED") return "delivered";
  if (s === "ERROR" || s === "FAILED") return "failed";
  return "sent";
}

/** Texto visible del mensaje: cuerpo, o pie del adjunto (el binario no se importa). */
function historyText(msg: HistoryMessage): string | null {
  if (msg.type === "text") return msg.text?.body ?? null;
  if (MEDIA_TYPES.has(msg.type)) {
    const media =
      msg[msg.type as "image" | "video" | "audio" | "document" | "sticker"];
    return media?.caption ?? media?.filename ?? null;
  }
  if (msg.type === "location")
    return msg.location?.name ?? msg.location?.address ?? null;
  return null;
}

/**
 * Parser puro y tolerante del webhook `history`. Un mensaje sin id, sin fecha
 * o de tipo no soportado (reacciones, ediciones, sistema) se omite.
 * Dirección: el hilo es del cliente; lo que manda el cliente (`from` = hilo)
 * es entrante, el resto lo escribió el negocio desde la app.
 */
export function parseHistoryValue(value: WebhookValue): ParsedHistory {
  const out: ParsedHistory = { declined: false, messages: [], progress: null };
  for (const chunk of value.history ?? []) {
    if (chunk.errors?.some((e) => e.code === HISTORY_DECLINED_CODE)) {
      out.declined = true;
    }
    if (typeof chunk.metadata?.progress === "number") {
      out.progress = chunk.metadata.progress;
    }
    for (const thread of chunk.threads ?? []) {
      if (!thread.id || !digits(thread.id)) continue;
      const customer = normalizeMx(digits(thread.id));
      for (const msg of thread.messages ?? []) {
        if (!msg?.id || !HISTORY_TYPES.has(msg.type)) continue;
        const timestamp = toDate(msg.timestamp);
        if (!timestamp) continue;
        const from = msg.from ? normalizeMx(digits(msg.from)) : null;
        const direction = from === customer ? "in" : "out";
        out.messages.push({
          identity: customer,
          direction,
          waMessageId: msg.id,
          type: msg.type,
          text: historyText(msg),
          timestamp,
          status: historyStatus(direction, msg.history_context?.status),
        });
      }
    }
  }
  return out;
}

export async function processHistoryValue(value: WebhookValue): Promise<void> {
  const phoneNumberId = value.metadata?.phone_number_id;
  if (!phoneNumberId) return;
  const credentials = await getCredentialsByPhoneNumberId(phoneNumberId);
  if (!credentials) {
    console.warn(
      `[webhook] history para phone_number_id desconocido (${phoneNumberId}): descartado`
    );
    return;
  }
  if (credentials.onboardingMode !== "coexistence") {
    // Solo una conexión hecha con el Embedded Signup en coexistence pide el
    // historial: en una conexión manual (o una WABA compartida) se ignora.
    console.warn(
      `[webhook] history para una conexión que no es coexistence (${credentials.organizationId}): ignorado`
    );
    return;
  }
  const { organizationId } = credentials;
  const parsed = parseHistoryValue(value);
  if (parsed.declined) {
    console.log(
      `[webhook] ${organizationId}: el negocio no compartió el historial de la app (2593109)`
    );
  }
  if (parsed.messages.length === 0) return;

  const byCustomer = new Map<string, ParsedHistoryMessage[]>();
  for (const m of parsed.messages) {
    const list = byCustomer.get(m.identity) ?? [];
    list.push(m);
    byCustomer.set(m.identity, list);
  }

  const db = getDb();
  let imported = 0;
  for (const [identity, messages] of byCustomer) {
    try {
      // El historial NO reactiva contactos archivados: archivar es una
      // decisión del operador y un chat viejo no la revierte.
      const { contact } = await getOrCreateContactByIdentity(
        organizationId,
        { identity, phone: identity, waUserId: null, profileName: null },
        { reactivate: false }
      );
      const conversation = await getOrCreateConversation(
        organizationId,
        contact.id
      );
      // Lotes: un hilo largo (meses de chat) no debe superar el límite de
      // parámetros de Postgres en un solo INSERT.
      for (let i = 0; i < messages.length; i += HISTORY_INSERT_BATCH) {
        const batch = messages.slice(i, i + HISTORY_INSERT_BATCH);
        const inserted = await db
          .insert(schema.message)
          .values(
            batch.map((m) => ({
              id: newId("message"),
              organizationId,
              conversationId: conversation.id,
              waMessageId: m.waMessageId,
              direction: m.direction,
              type: m.type,
              text: m.text,
              status: m.status,
              // Lo saliente del historial lo escribió el dueño desde la app.
              origin:
                m.direction === "out"
                  ? ("manual" as const)
                  : ("operator" as const),
              waTimestamp: m.timestamp,
              // El hilo, la vista previa y el contexto de la IA ordenan por
              // created_at: un mensaje del historial debe ocupar SU lugar en
              // el tiempo, no el momento de la importación.
              createdAt: m.timestamp,
            }))
          )
          // Idempotencia: Meta reenvía bloques; un wamid ya visto no duplica.
          .onConflictDoNothing({ target: [schema.message.waMessageId] })
          .returning({ id: schema.message.id });
        imported += inserted.length;
      }

      const latest = messages.reduce(
        (max, m) => (m.timestamp > max ? m.timestamp : max),
        messages[0]!.timestamp
      );
      // Solo ordena el hilo: jamás lastInboundAt (ventana 24 h) ni no-leídos.
      // Un mensaje nuevo ya registrado (más reciente) no retrocede la fecha.
      const current = conversation.lastMessageAt;
      if (!current || latest > current) {
        await db
          .update(schema.conversation)
          .set({ lastMessageAt: latest, updatedAt: new Date() })
          .where(
            and(
              eq(schema.conversation.id, conversation.id),
              or(
                isNull(schema.conversation.lastMessageAt),
                lt(schema.conversation.lastMessageAt, latest)
              )
            )
          );
      }

      publish(organizationId, {
        type: "conversation.updated",
        // historyImported: si el hilo está abierto, la UI recarga los mensajes
        // (el refetch incremental por created_at no vería filas "del pasado").
        data: { conversation: { id: conversation.id, historyImported: true } },
      });
    } catch (err) {
      // Un hilo malformado jamás tumba el resto del bloque.
      console.error(`[webhook] error importando historial de un hilo:`, err);
    }
  }
  console.log(
    `[webhook] ${organizationId}: historial de la app importado — ${imported} mensajes nuevos` +
      (parsed.progress !== null ? ` (avance ${parsed.progress}%)` : "")
  );
}

export type ParsedAddressBookEntry =
  | { action: "upsert"; identity: string; name: string }
  | { action: "remove"; identity: string };

/** Parser puro del webhook `smb_app_state_sync` (solo entradas de contacto). */
export function parseStateSyncValue(
  value: WebhookValue
): ParsedAddressBookEntry[] {
  const out: ParsedAddressBookEntry[] = [];
  for (const item of value.state_sync ?? []) {
    if (item.type !== "contact" || !item.contact?.phone_number) continue;
    const raw = digits(item.contact.phone_number);
    if (!raw) continue;
    const identity = normalizeMx(raw);
    if ((item.action ?? "").toLowerCase() === "remove") {
      out.push({ action: "remove", identity });
      continue;
    }
    const name =
      item.contact.full_name?.trim() || item.contact.first_name?.trim() || "";
    if (!name) continue;
    out.push({ action: "upsert", identity, name: name.slice(0, 200) });
  }
  return out;
}

/** Nombres que el CRM puso por falta de dato: se pueden reemplazar por la agenda. */
export const PLACEHOLDER_CONTACT_NAME = "Contacto de WhatsApp";

export async function processStateSyncValue(
  value: WebhookValue
): Promise<void> {
  const phoneNumberId = value.metadata?.phone_number_id;
  if (!phoneNumberId) return;
  const credentials = await getCredentialsByPhoneNumberId(phoneNumberId);
  if (!credentials) {
    console.warn(
      `[webhook] smb_app_state_sync para phone_number_id desconocido (${phoneNumberId}): descartado`
    );
    return;
  }
  if (credentials.onboardingMode !== "coexistence") {
    console.warn(
      `[webhook] smb_app_state_sync para una conexión que no es coexistence (${credentials.organizationId}): ignorado`
    );
    return;
  }
  const { organizationId } = credentials;

  // Última acción por número (Meta puede mandar alta y baja del mismo en un
  // bloque); así cada lote toca cada fila una sola vez.
  const latest = new Map<string, ParsedAddressBookEntry>();
  for (const entry of parseStateSyncValue(value)) latest.set(entry.identity, entry);
  const entries = [...latest.values()];
  if (entries.length === 0) return;

  const db = getDb();
  let applied = 0;
  for (let i = 0; i < entries.length; i += STATE_SYNC_BATCH) {
    const batch = entries.slice(i, i + STATE_SYNC_BATCH);
    const removals = batch.filter((e) => e.action === "remove").map((e) => e.identity);
    const upserts = batch.filter(
      (e): e is Extract<ParsedAddressBookEntry, { action: "upsert" }> =>
        e.action === "upsert"
    );
    try {
      if (removals.length > 0) {
        await db
          .delete(schema.waAddressBookEntry)
          .where(
            and(
              eq(schema.waAddressBookEntry.organizationId, organizationId),
              inArray(schema.waAddressBookEntry.waIdentity, removals)
            )
          );
      }
      if (upserts.length > 0) {
        await db
          .insert(schema.waAddressBookEntry)
          .values(
            upserts.map((e) => ({
              id: newId("addressBookEntry"),
              organizationId,
              waIdentity: e.identity,
              name: e.name,
            }))
          )
          .onConflictDoUpdate({
            target: [
              schema.waAddressBookEntry.organizationId,
              schema.waAddressBookEntry.waIdentity,
            ],
            set: { name: sql`excluded.name`, updatedAt: new Date() },
          });
        // Un contacto que ya existe toma el nombre de la agenda SOLO si el que
        // tiene es de relleno (su teléfono o el genérico): el que puso el
        // operador se respeta. Una sola sentencia por lote.
        const identities = upserts.map((e) => e.identity);
        await db.execute(sql`
          update ${schema.contact} as c
          set name = ab.name, updated_at = now()
          from ${schema.waAddressBookEntry} as ab
          where ab.organization_id = ${organizationId}
            and c.organization_id = ${organizationId}
            and ab.wa_identity in (${sql.join(identities.map((x) => sql`${x}`), sql`, `)})
            and (c.wa_identity = ab.wa_identity or c.phone = ab.wa_identity)
            and (c.name = ab.wa_identity or c.name = ${PLACEHOLDER_CONTACT_NAME})
        `);
      }
      applied += batch.length;
    } catch (err) {
      console.error("[webhook] error aplicando agenda de la app:", err);
    }
  }
  if (applied > 0) {
    console.log(
      `[webhook] ${organizationId}: agenda de la app — ${applied} cambios`
    );
  }
}

/** Eventos `account_update` que cortan o restablecen la coexistence. */
const DISCONNECT_EVENTS = new Set(["PARTNER_REMOVED", "ACCOUNT_OFFBOARDED"]);
const RECONNECT_EVENTS = new Set(["ACCOUNT_RECONNECTED"]);

export function accountUpdateEffect(
  event: string | undefined
): "disconnected" | "reconnected" | null {
  const e = (event ?? "").toUpperCase();
  if (DISCONNECT_EVENTS.has(e)) return "disconnected";
  if (RECONNECT_EVENTS.has(e)) return "reconnected";
  return null;
}

/**
 * `account_update` llega a nivel WABA (entry.id). Otros eventos de ese campo
 * (verificación, límites, etc.) se ignoran sin error.
 */
export async function processAccountUpdateValue(
  wabaId: string | null,
  value: WebhookValue
): Promise<void> {
  const effect = accountUpdateEffect(value.event);
  if (!effect) return;
  const organizationIds = await setAppDisconnected({
    wabaId,
    phoneNumber: value.phone_number ?? null,
    disconnected: effect === "disconnected",
  });
  // La UI lo lee al abrir Configuración → WhatsApp (sin evento SSE propio).
  for (const organizationId of organizationIds) {
    console.warn(
      `[webhook] ${organizationId}: coexistence ${effect === "disconnected" ? "cortada" : "restablecida"} (${value.event})`
    );
  }
}
