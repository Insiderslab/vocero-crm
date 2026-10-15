import { and, eq, inArray, or, TransactionRollbackError } from "drizzle-orm";
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
 * wa_identity` (D5; lo verifica V3 en cada arranque, en modo `blocca`), así
 * que buscar por la identidad es lo mismo que buscar por `wa_identity`.
 *
 * Reconciliación automática SOLO la que atestigua el proveedor en el mismo
 * evento y canal (WhatsApp: teléfono + BSUID, 003). Entre canales, jamás
 * (ADR §3.2): eso es la fusión con confirmación de M1.4.
 */

export { BSUID_PREFIX, type ResolvedIdentity };

type ContactRow = typeof schema.contact.$inferSelect;

/** Contactos de la organización con alguna de estas identidades del canal. */
function contactIdsWithIdentity(
  organizationId: string,
  channel: ChannelKind,
  externalIds: string[]
) {
  const ci = schema.contactIdentity;
  return getDb()
    .select({ id: ci.contactId })
    .from(ci)
    .where(
      and(
        eq(ci.organizationId, organizationId),
        eq(ci.channel, channel),
        inArray(ci.externalId, externalIds)
      )
    );
}

/** El contacto de UNA identidad del canal (o undefined). */
async function contactByIdentity(
  organizationId: string,
  channel: ChannelKind,
  externalId: string
): Promise<ContactRow | undefined> {
  const rows = await getDb()
    .select()
    .from(schema.contact)
    .where(
      and(
        eq(schema.contact.organizationId, organizationId),
        inArray(schema.contact.id, contactIdsWithIdentity(organizationId, channel, [externalId]))
      )
    )
    .limit(1);
  return rows[0];
}

/**
 * Resuelve o crea el contacto de una identidad WhatsApp, reconciliando:
 * - si llegan teléfono Y BSUID, encuentra al contacto por cualquiera de los
 *   dos y adquiere la señal que le faltaba (la identidad NO cambia: es
 *   estable de por vida);
 * - reactiva contactos archivados (el nombre editado por el operador se
 *   respeta), salvo `reactivate: false` (historial de la coexistence).
 */
export async function getOrCreateWhatsappContact(
  organizationId: string,
  resolved: ResolvedIdentity,
  opts: { reactivate?: boolean } = {}
): Promise<{ contact: ContactRow; isNew: boolean }> {
  const reactivate = opts.reactivate ?? true;
  const db = getDb();

  const identities = [resolved.identity];
  if (resolved.waUserId) identities.push(`${BSUID_PREFIX}${resolved.waUserId}`);
  const matchers = [
    inArray(
      schema.contact.id,
      contactIdsWithIdentity(organizationId, "whatsapp", identities)
    ),
  ];
  if (resolved.waUserId) {
    matchers.push(eq(schema.contact.waUserId, resolved.waUserId));
  }
  if (resolved.phone) {
    matchers.push(eq(schema.contact.phone, resolved.phone));
  }

  const rows = await db
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

  // Carrera: otro request lo creó entre el SELECT y el INSERT (R2: se relee
  // por la identidad).
  const contact = await contactByIdentity(organizationId, "whatsapp", resolved.identity);
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

/** El contacto de una identidad WhatsApp (`?waIdentity=` del bot, R2). */
export async function findContactByWhatsappIdentity(
  organizationId: string,
  waIdentity: string
): Promise<ContactRow | undefined> {
  return contactByIdentity(organizationId, "whatsapp", waIdentity);
}
