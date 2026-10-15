import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";

/**
 * 005-livello-canali, R1 → R2 — Doble escritura (ADR 0001 §3.3, plan §5.9).
 *
 * Hasta R3 las columnas viejas siguen siendo la fuente de verdad
 * (`meta_credentials`, `contact.wa_identity`, `message.wa_message_id`) y cada
 * escritura vieja escribe también la nueva, en la MISMA transacción. Desde R2
 * (M1.3) el CRM LEE las estructuras nuevas, así que la copia es ESTRICTA
 * (revisión de la PR #14): si no queda idéntica a la fila vieja, la
 * transacción entera se deshace y el error sube — nunca una lectura nueva
 * desalineada en silencio. Lo que una imagen anterior (R0) escriba durante un
 * rollback lo realinea la reconciliación del arranque
 * (`scripts/migrate-channels.mjs`, modo `blocca`). Todo esto se quita en R3.
 */

/** La conexión o la transacción en curso (`db.transaction`). */
export type DbExecutor =
  | ReturnType<typeof getDb>
  | Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/**
 * La copia a las estructuras nuevas no quedó idéntica a la fila vieja (o
 * falló): la transacción se deshace. Mensaje sin valores (ni números ni
 * tokens): solo qué copia y por qué.
 */
export class ChannelMirrorError extends Error {
  readonly code = "channel_mirror_failed" as const;
  constructor(what: "channel_account" | "contact_identity", reason: string) {
    super(`[canali] copia en ${what} rechazada: ${reason}`);
    this.name = "ChannelMirrorError";
  }
}

function describeDbError(err: unknown): string {
  if (err instanceof ChannelMirrorError) return err.message;
  const e = err as { code?: unknown; message?: unknown; cause?: unknown };
  const inner = (e?.cause ?? e) as { code?: unknown; message?: unknown };
  const code = typeof inner?.code === "string" ? `${inner.code} ` : "";
  return `${code}${typeof inner?.message === "string" ? inner.message : String(err)}`;
}

/**
 * Copia filas de `meta_credentials` a `channel_account` (y asigna la cuenta a
 * las conversaciones reales de su organización que no la tienen). Usa la
 * MISMA función SQL que la reconciliación del arranque: un único lugar decide
 * qué campos se copian y cómo (incluido `config` con los campos 009). Copia el
 * cifrado tal cual: nunca descifra.
 *
 * ESTRICTA (R2): sin SAVEPOINT. Un error de la función hace fallar la
 * transacción del llamador (también la escritura de `meta_credentials`), y
 * después se comprueba la POSTCONDICIÓN: para cada id escrito, su
 * `channel_account` existe y es igual campo por campo (V1/V2 de esas filas).
 * Así el `ON CONFLICT DO NOTHING` del paso (1c) de la función —pensado para no
 * cortar la reconciliación del arranque— no puede esconder nada en tiempo de
 * ejecución: una fila que no se pudo copiar es un error aquí.
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
  try {
    await tx.execute(sql`select channels_legacy_sync_accounts(array[${ids}]::text[])`);
    const rows = await tx.execute<{ diverging: number }>(sql`
      select count(*)::int as diverging
        from meta_credentials mc
        left join channel_account ca on ca.legacy_meta_credentials_id = mc.id
       where mc.id = any (array[${ids}]::text[])
         and (ca.id is null
              or (ca.organization_id, ca.channel, ca.external_account_id, ca.external_parent_id,
                  ca.display_name, ca.verified_name, ca.secret_cipher, ca.secret_iv, ca.secret_tag,
                  ca.status, ca.config)
                 is distinct from
                 (mc.organization_id, 'whatsapp', mc.phone_number_id, mc.waba_id,
                  mc.display_phone_number, mc.verified_name, mc.token_cipher, mc.token_iv,
                  mc.token_tag, mc.status,
                  channels_legacy_wa_config(mc.onboarding_mode, mc.app_disconnected_at)))
    `);
    const diverging = Number((rows as unknown as { diverging: number }[])[0]?.diverging ?? 0);
    if (diverging !== 0) {
      throw new ChannelMirrorError(
        "channel_account",
        `${diverging} cuenta(s) distinta(s) de meta_credentials tras la copia (V1/V2)`
      );
    }
  } catch (err) {
    const error =
      err instanceof ChannelMirrorError
        ? err
        : new ChannelMirrorError("channel_account", describeDbError(err));
    console.error(`${error.message} — la escritura de meta_credentials se deshace`);
    throw error;
  }
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

/**
 * Identidad WhatsApp de un contacto: una por contacto, = wa_identity (D5).
 * ESTRICTA (R2): mismo transacción que el contacto, `ON CONFLICT` solo sobre
 * `contact_identity_org_channel_ext_uq` y postcondición: la identidad existe
 * y es de ESTE contacto. Una identidad residual de otro contacto con el mismo
 * ID externo hace fallar el alta (nada se escribe) en vez de quedar un
 * contacto sin identidad que R2 no sabría encontrar.
 */
export async function insertWhatsappIdentity(
  tx: DbExecutor,
  contact: Pick<ContactRow, "id" | "organizationId" | "waIdentity" | "createdAt">
): Promise<void> {
  const ci = schema.contactIdentity;
  await tx
    .insert(ci)
    .values({
      id: newId("contactIdentity"),
      organizationId: contact.organizationId,
      contactId: contact.id,
      channel: "whatsapp",
      externalId: contact.waIdentity,
      createdAt: contact.createdAt,
    })
    .onConflictDoNothing({ target: [ci.organizationId, ci.channel, ci.externalId] });
  const rows = await tx
    .select({ contactId: ci.contactId })
    .from(ci)
    .where(
      and(
        eq(ci.organizationId, contact.organizationId),
        eq(ci.channel, "whatsapp"),
        eq(ci.externalId, contact.waIdentity)
      )
    )
    .limit(1);
  if (rows[0]?.contactId !== contact.id) {
    const error = new ChannelMirrorError(
      "contact_identity",
      rows[0]
        ? "la identidad WhatsApp ya pertenece a otro contacto (V3)"
        : "la identidad WhatsApp no quedó escrita"
    );
    console.error(`${error.message} — el alta del contacto se deshace`);
    throw error;
  }
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
