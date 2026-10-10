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
 * Escritura en las estructuras NUEVAS, aislada en un SAVEPOINT: en R1 la
 * fuente de verdad son las columnas viejas, así que un fallo aquí (una fila
 * desalineada, un índice a medio crear) JAMÁS debe cancelar la escritura vieja
 * — en la ingesta eso perdería el mensaje (el webhook ya respondió 200 a
 * Meta). Se registra y la reconciliación del arranque lo repara (V1–V7).
 */
async function bestEffort(
  tx: DbExecutor,
  what: string,
  fn: (sp: DbExecutor) => Promise<void>
): Promise<void> {
  try {
    await tx.transaction(async (sp) => fn(sp));
  } catch (err) {
    console.error(
      `[canali] doppia scrittura di ${what} fallita (la ripara la riconciliazione all'avvio):`,
      err instanceof Error ? err.message : err
    );
  }
}

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
  await bestEffort(tx, "channel_account", async (sp) => {
    await sp.execute(sql`select channels_legacy_sync_accounts(array[${ids}]::text[])`);
  });
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

/**
 * 008 — Campos de canal de una solicitud del formulario del sitio: canal
 * `web`, sin ID de proveedor (ni `wa_message_id` ni `external_message_id`).
 * No hay identidad ni cuenta `web`: al sitio no se le responde.
 */
export function webMessageIds() {
  return {
    waMessageId: null,
    channel: "web" as const,
    externalMessageId: null,
  };
}

type ContactInsert = typeof schema.contact.$inferInsert;
type ContactRow = typeof schema.contact.$inferSelect;

/** Identidad WhatsApp de un contacto: una por contacto, = wa_identity (D5). */
export async function insertWhatsappIdentity(
  tx: DbExecutor,
  contact: Pick<ContactRow, "id" | "organizationId" | "waIdentity" | "createdAt">
): Promise<void> {
  await bestEffort(tx, "contact_identity", async (sp) => {
    await sp
      .insert(schema.contactIdentity)
      .values({
        id: newId("contactIdentity"),
        organizationId: contact.organizationId,
        contactId: contact.id,
        channel: "whatsapp",
        externalId: contact.waIdentity,
        createdAt: contact.createdAt,
      })
      // Una identidad huérfana (contacto borrado sin la FK en cascada, fase B
      // incompleta) no bloquea el alta: V3 la reporta y el arranque la repara.
      .onConflictDoNothing();
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
