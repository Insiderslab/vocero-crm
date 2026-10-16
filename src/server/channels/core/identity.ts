import { and, eq, inArray, or, sql, TransactionRollbackError } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { insertContactIfAbsent } from "@/server/channels/dual-write";
import type { ChannelKind } from "@/server/channels/types";
import { BSUID_PREFIX, type ResolvedIdentity } from "@/server/channels/whatsapp/parse";

/**
 * 005-livello-canali (M1.3, T028/T030) — Identidad del contacto en el núcleo.
 *
 * R2: la resolución lee `contact_identity` (plan §5.1). Hasta R3 cada contacto
 * WhatsApp tiene EXACTAMENTE una identidad `whatsapp` con `external_id =
 * wa_identity` (D5; lo verifica V3 en cada arranque, en modo `blocca`, y lo
 * exige la doble escritura estricta). Una identidad que NO coincide con el
 * `wa_identity` de su contacto no captura nada: la ingesta se rechaza
 * (`IdentityConflictError`) y las relecturas usan la columna vieja.
 *
 * Reconciliación automática SOLO la que atestigua el proveedor en el mismo
 * evento y canal (WhatsApp: teléfono + BSUID, 003). Entre canales, jamás
 * (ADR §3.2): eso es la fusión con confirmación de M1.4.
 */

export { BSUID_PREFIX, type ResolvedIdentity };

type ContactRow = typeof schema.contact.$inferSelect;

/**
 * Identidad WhatsApp incoherente con la columna vieja (`external_id ≠
 * wa_identity` de su contacto: una fila residual o escrita a mano). Revisión
 * de la PR #14: una fila así JAMÁS captura en silencio los mensajes de otra
 * persona. La ingesta se RECHAZA (error en el log, el webhook ya respondió
 * 200), V3 la cuenta y el arranque en `blocca` no sirve tráfico hasta que se
 * resuelva. Sin valores en el mensaje.
 */
export class IdentityConflictError extends Error {
  readonly code = "identity_conflict" as const;
  constructor() {
    super(
      "[canali] identidad WhatsApp incoherente con wa_identity (V3): mensaje rechazado para no asignarlo a otro contacto"
    );
    this.name = "IdentityConflictError";
  }
}

/** Identidades del canal que coinciden, con la columna vieja de su contacto. */
async function identityMatches(
  organizationId: string,
  channel: ChannelKind,
  externalIds: string[]
) {
  const ci = schema.contactIdentity;
  return getDb()
    .select({
      contactId: ci.contactId,
      externalId: ci.externalId,
      waIdentity: schema.contact.waIdentity,
    })
    .from(ci)
    .innerJoin(
      schema.contact,
      and(eq(schema.contact.organizationId, ci.organizationId), eq(schema.contact.id, ci.contactId))
    )
    .where(
      and(
        eq(ci.organizationId, organizationId),
        eq(ci.channel, channel),
        inArray(ci.externalId, externalIds)
      )
    );
}

/** El contacto de UNA identidad de un canal que no es WhatsApp (o undefined). */
async function contactByIdentity(
  organizationId: string,
  channel: ChannelKind,
  externalId: string
): Promise<ContactRow | undefined> {
  const ci = schema.contactIdentity;
  const rows = await getDb()
    .select({ contact: schema.contact })
    .from(ci)
    .innerJoin(
      schema.contact,
      and(eq(schema.contact.organizationId, ci.organizationId), eq(schema.contact.id, ci.contactId))
    )
    .where(and(eq(ci.organizationId, organizationId), eq(ci.channel, channel), eq(ci.externalId, externalId)))
    .limit(1);
  return rows[0]?.contact;
}

/**
 * El contacto de una identidad WhatsApp, SEGURO hasta R3: vale la identidad
 * solo si coincide con el `wa_identity` de su contacto (una fila residual no
 * captura a nadie); si no hay identidad coherente, la columna vieja
 * (`contact.wa_identity`), que sigue siendo la fuente de verdad.
 */
async function whatsappContactByIdentity(
  organizationId: string,
  waIdentity: string
): Promise<ContactRow | undefined> {
  const ci = schema.contactIdentity;
  const viaIdentity = await getDb()
    .select({ contact: schema.contact })
    .from(ci)
    .innerJoin(
      schema.contact,
      and(
        eq(schema.contact.organizationId, ci.organizationId),
        eq(schema.contact.id, ci.contactId),
        eq(schema.contact.waIdentity, ci.externalId)
      )
    )
    .where(and(eq(ci.organizationId, organizationId), eq(ci.channel, "whatsapp"), eq(ci.externalId, waIdentity)))
    .limit(1);
  if (viaIdentity[0]) return viaIdentity[0].contact;
  // Respaldo hasta R3: la columna vieja.
  const legacy = await getDb()
    .select()
    .from(schema.contact)
    .where(and(eq(schema.contact.organizationId, organizationId), eq(schema.contact.waIdentity, waIdentity)))
    .limit(1);
  return legacy[0];
}

/**
 * Resuelve o crea el contacto de una identidad WhatsApp, reconciliando:
 * - si llegan teléfono Y BSUID, encuentra al contacto por cualquiera de los
 *   dos y adquiere la señal que le faltaba (la identidad NO cambia: es
 *   estable de por vida);
 * - reactiva contactos archivados (el nombre editado por el operador se
 *   respeta), salvo `reactivate: false` (historial de la coexistence).
 * Una identidad incoherente con `wa_identity` → `IdentityConflictError`.
 */
export async function getOrCreateWhatsappContact(
  organizationId: string,
  resolved: ResolvedIdentity,
  opts: {
    /** 009 — el historial de coexistence no reactiva archivados. */
    reactivate?: boolean;
    /**
     * 008 — El mensaje es un entrante de WhatsApp EN VIVO (Meta verificó el
     * número). Un contacto nacido del formulario del sitio (`source = sito`)
     * recibe aquí su nombre verificado la primera vez.
     */
    verifiedInbound?: boolean;
  } = {}
): Promise<{ contact: ContactRow; isNew: boolean }> {
  const reactivate = opts.reactivate ?? true;
  const db = getDb();

  const identities = [resolved.identity];
  if (resolved.waUserId) identities.push(`${BSUID_PREFIX}${resolved.waUserId}`);
  const matches = await identityMatches(organizationId, "whatsapp", identities);
  if (matches.some((m) => m.waIdentity !== m.externalId)) {
    const error = new IdentityConflictError();
    console.error(error.message);
    throw error;
  }
  const matchers = [];
  if (matches.length > 0) {
    matchers.push(inArray(schema.contact.id, matches.map((m) => m.contactId)));
  }
  if (resolved.waUserId) {
    matchers.push(eq(schema.contact.waUserId, resolved.waUserId));
  }
  if (resolved.phone) {
    matchers.push(eq(schema.contact.phone, resolved.phone));
  }

  const rows =
    matchers.length === 0
      ? []
      : await db
          .select()
          .from(schema.contact)
          .where(and(eq(schema.contact.organizationId, organizationId), or(...matchers)))
          .orderBy(schema.contact.createdAt)
          .limit(1);

  const existing = rows[0];
  if (existing) {
    const patch: Partial<typeof schema.contact.$inferInsert> = {};
    if (resolved.waUserId && !existing.waUserId)
      patch.waUserId = resolved.waUserId;
    if (resolved.phone && !existing.phone) patch.phone = resolved.phone;
    if (existing.archivedAt && reactivate) patch.archivedAt = null;
    // 008 — Un formulario público pudo crear este contacto con el teléfono de
    // otra persona y un nombre inventado. Con el PRIMER entrante de WhatsApp
    // (número verificado por Meta), el nombre pasa a ser el verificado: el de
    // la agenda si existe, si no el de perfil, si no el teléfono. Una sola vez:
    // después manda el que ponga el operador.
    if (
      opts.verifiedInbound &&
      existing.source === "sito" &&
      !(await hasWhatsappInbound(organizationId, existing.id))
    ) {
      const addressBookName = existing.phone
        ? await lookupAddressBookName(organizationId, existing.phone)
        : null;
      const verified =
        addressBookName || resolved.profileName?.trim() || displayFallback(resolved);
      if (verified !== existing.name) patch.name = verified;
    }
    if (Object.keys(patch).length > 0) {
      patch.updatedAt = new Date();
      await db
        .update(schema.contact)
        .set(patch)
        .where(eq(schema.contact.id, existing.id));
      Object.assign(existing, patch);
    }
    return { contact: existing, isNew: false };
  }

  // 009 — Coexistence: si la agenda de la app WhatsApp Business conoce el
  // número, ese nombre (el que puso el dueño) gana al nombre de perfil.
  const addressBookName = resolved.phone
    ? await lookupAddressBookName(organizationId, resolved.phone)
    : null;

  // 005 (R1): el contacto y su identidad WhatsApp, en una transacción.
  const inserted = await insertContactIfAbsent({
    id: newId("contact"),
    organizationId,
    waIdentity: resolved.identity,
    phone: resolved.phone,
    waUserId: resolved.waUserId,
    name:
      addressBookName ||
      resolved.profileName?.trim() ||
      displayFallback(resolved),
  });
  if (inserted) return { contact: inserted, isNew: true };

  // Carrera: otro request lo creó entre el SELECT y el INSERT. Se relee por
  // la identidad coherente o, hasta R3, por la columna vieja (`wa_identity`:
  // es el índice que acaba de rechazar el INSERT).
  const contact = await whatsappContactByIdentity(organizationId, resolved.identity);
  if (!contact) throw new Error("contacto no encontrado tras upsert");
  return { contact, isNew: false };
}

/**
 * Identidad de un canal que NO es WhatsApp (ADR §3.2, §3.9): se resuelve solo
 * por `contact_identity` del mismo canal; nada se fusiona automáticamente.
 *
 * LÍMITE de R2 (registro M1.3, Q3): hasta T049 (M1.6) `contact.wa_identity` es
 * NOT NULL, así que un contacto NUEVO sin identidad WhatsApp falla en la BD;
 * aquí se escribe NULL a propósito (el valor falso `ig:<id>` en `wa_identity`
 * está descartado por el ADR §3.9).
 */
export async function getOrCreateChannelContact(
  organizationId: string,
  channel: Exclude<ChannelKind, "whatsapp">,
  ref: { externalId: string; displayName: string | null },
  opts: { reactivate?: boolean; channelAccountId?: string | null } = {}
): Promise<{ contact: ContactRow; isNew: boolean }> {
  const reactivate = opts.reactivate ?? true;
  const db = getDb();
  const existing = await contactByIdentity(organizationId, channel, ref.externalId);
  if (existing) {
    if (existing.archivedAt && reactivate) {
      const updatedAt = new Date();
      await db
        .update(schema.contact)
        .set({ archivedAt: null, updatedAt })
        .where(eq(schema.contact.id, existing.id));
      Object.assign(existing, { archivedAt: null, updatedAt });
    }
    return { contact: existing, isNew: false };
  }

  const created = await db.transaction(async (tx) => {
    const [contact] = await tx
      .insert(schema.contact)
      .values({
        id: newId("contact"),
        organizationId,
        waIdentity: null as unknown as string,
        name: ref.displayName?.trim() || "Contacto",
      })
      .returning();
    if (!contact) return undefined;
    const identity = await tx
      .insert(schema.contactIdentity)
      .values({
        id: newId("contactIdentity"),
        organizationId,
        contactId: contact.id,
        channel,
        externalId: ref.externalId,
        channelAccountId: opts.channelAccountId ?? null,
        createdAt: contact.createdAt,
      })
      .onConflictDoNothing()
      .returning({ id: schema.contactIdentity.id });
    // Carrera: la identidad ya existe → se deshace el contacto recién creado.
    if (!identity[0]) tx.rollback();
    return contact;
  }).catch((err: unknown) => {
    if (err instanceof TransactionRollbackError) return undefined;
    throw err;
  });
  if (created) return { contact: created, isNew: true };

  const raced = await contactByIdentity(organizationId, channel, ref.externalId);
  if (!raced) throw new Error("contacto no encontrado tras upsert");
  return { contact: raced, isNew: false };
}

/** ¿El contacto ya recibió algún entrante de WhatsApp (de cualquier conversación)? */
async function hasWhatsappInbound(organizationId: string, contactId: string): Promise<boolean> {
  const rows = await getDb()
    .select({ one: sql<number>`1` })
    .from(schema.message)
    .innerJoin(schema.conversation, eq(schema.conversation.id, schema.message.conversationId))
    .where(
      and(
        eq(schema.message.organizationId, organizationId),
        eq(schema.conversation.contactId, contactId),
        eq(schema.message.direction, "in"),
        eq(schema.message.channel, "whatsapp")
      )
    )
    .limit(1);
  return rows.length > 0;
}

async function lookupAddressBookName(
  organizationId: string,
  phone: string
): Promise<string | null> {
  const rows = await getDb()
    .select({ name: schema.waAddressBookEntry.name })
    .from(schema.waAddressBookEntry)
    .where(
      and(
        eq(schema.waAddressBookEntry.organizationId, organizationId),
        eq(schema.waAddressBookEntry.waIdentity, phone)
      )
    )
    .limit(1);
  return rows[0]?.name?.trim() || null;
}

/** Nombre de respaldo cuando no hay nombre de perfil: nunca el BSUID crudo. */
function displayFallback(resolved: ResolvedIdentity): string {
  if (resolved.phone) return resolved.phone;
  return "Contacto de WhatsApp";
}

/** ¿El contacto tiene identidad WhatsApp? (R2: por `contact_identity`). */
export async function hasWhatsappIdentity(
  organizationId: string,
  contactId: string
): Promise<boolean> {
  const ci = schema.contactIdentity;
  const rows = await getDb()
    .select({ id: ci.id })
    .from(ci)
    .where(
      and(
        eq(ci.organizationId, organizationId),
        eq(ci.contactId, contactId),
        eq(ci.channel, "whatsapp")
      )
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * El contacto de una identidad WhatsApp (`?waIdentity=` del bot, R2): la
 * identidad coherente con `wa_identity` o, hasta R3, la columna vieja. Una
 * identidad residual no devuelve a otro contacto.
 */
export async function findContactByWhatsappIdentity(
  organizationId: string,
  waIdentity: string
): Promise<ContactRow | undefined> {
  return whatsappContactByIdentity(organizationId, waIdentity);
}
