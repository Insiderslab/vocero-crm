import { sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";

/**
 * 005-livello-canali, R1 — Doble escritura (ADR 0001 §3.3, plan §5.9).
 *
 * Mientras dure la migración (R1 y R2) las columnas viejas siguen siendo la
 * fuente de verdad (`meta_credentials`, `contact.wa_identity`,
 * `message.wa_message_id`) y R1 NO lee las estructuras nuevas. Cada escritura
 * vieja escribe también la nueva, en la MISMA transacción. Lo que una imagen
 * anterior (R0) escriba durante un rollback lo realinea la reconciliación del
 * arranque (`scripts/migrate-channels.mjs`). Todo esto se quita en R3.
 */

/** La conexión o la transacción en curso (`db.transaction`). */
export type DbExecutor =
  | ReturnType<typeof getDb>
  | Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/**
 * Copia filas de `meta_credentials` a `channel_account` (y asigna la cuenta a
 * las conversaciones reales de su organización que no la tienen). Usa la
 * MISMA función SQL que la reconciliación del arranque: un único lugar decide
 * qué campos se copian y cómo (incluido `config` con los campos 009). Copia el
 * cifrado tal cual: nunca descifra.
 */
export async function mirrorWhatsappAccounts(
  tx: DbExecutor,
  metaCredentialsIds: readonly string[]
): Promise<void> {
  if (metaCredentialsIds.length === 0) return;
  const ids = sql.join(
    metaCredentialsIds.map((id) => sql`${id}`),
    sql`, `
  );
  await tx.execute(sql`select channels_legacy_sync_accounts(array[${ids}]::text[])`);
}

/**
 * Subconsulta: la cuenta WhatsApp de la organización (NULL si no tiene, como
 * hoy `not_connected`). Para el INSERT de una conversación real.
 */
export function whatsappAccountIdOf(organizationId: string) {
  return sql`(select ${schema.channelAccount.id} from ${schema.channelAccount}
    where ${schema.channelAccount.organizationId} = ${organizationId}
      and ${schema.channelAccount.channel} = 'whatsapp')`;
}

/**
 * Campos nuevos de un mensaje de WhatsApp: `external_message_id` = wamid
 * (NULL si NULL: Laboratorio, fallidos antes del envío).
 */
export function whatsappMessageIds(waMessageId: string | null) {
  return {
    waMessageId,
    channel: "whatsapp" as const,
    externalMessageId: waMessageId,
  };
}

type ContactInsert = typeof schema.contact.$inferInsert;
type ContactRow = typeof schema.contact.$inferSelect;

/** Identidad WhatsApp de un contacto: una por contacto, = wa_identity (D5). */
export async function insertWhatsappIdentity(
  tx: DbExecutor,
  contact: Pick<ContactRow, "id" | "organizationId" | "waIdentity" | "createdAt">
): Promise<void> {
  await tx.insert(schema.contactIdentity).values({
    id: newId("contactIdentity"),
    organizationId: contact.organizationId,
    contactId: contact.id,
    channel: "whatsapp",
    externalId: contact.waIdentity,
    createdAt: contact.createdAt,
  });
}

/**
 * INSERT del contacto con `ON CONFLICT (organization_id, wa_identity) DO
 * NOTHING` (lo que hacían la ingesta, el alta manual y el Laboratorio) + su
 * identidad WhatsApp en la misma transacción. Devuelve la fila insertada, o
 * `undefined` si ya existía (sin tocar nada).
 */
export async function insertContactIfAbsent(
  values: ContactInsert
): Promise<ContactRow | undefined> {
  return getDb().transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.contact)
      .values(values)
      .onConflictDoNothing({
        target: [schema.contact.organizationId, schema.contact.waIdentity],
      })
      .returning();
    const contact = inserted[0];
    if (contact) await insertWhatsappIdentity(tx, contact);
    return contact;
  });
}
