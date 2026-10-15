import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { scoped } from "@/lib/db/tenant";
import { mirrorWhatsappAccounts } from "@/server/channels/dual-write";
import type {
  AccountContext,
  ChannelAccountView,
  ChannelKind,
  ExternalAccountRef,
} from "@/server/channels/types";

/**
 * 005-livello-canali (M1.3, T028/T030) — Cuentas de canal en el núcleo.
 *
 * R2: las LECTURAS van a `channel_account` (plan §5.3). Fuente de verdad hasta
 * R3 siguen siendo las columnas viejas: el arranque reconcilia y verifica
 * V1–V7 en modo `blocca` antes de servir tráfico, y cada escritura vieja copia
 * a `channel_account` en la misma transacción (doble escritura de R1).
 *
 * La organización la decide SIEMPRE el núcleo a partir de la cuenta externa
 * (`UNIQUE (channel, external_account_id)`): un adaptador nunca la elige.
 */

export type AccountRow = typeof schema.channelAccount.$inferSelect;

/** Cuenta que recibe un evento (por cuenta o por cuenta padre, p. ej. WABA). */
export async function findAccountByRef(
  channel: ChannelKind,
  ref: ExternalAccountRef
): Promise<AccountRow | null> {
  const t = schema.channelAccount;
  const where =
    ref.by === "account"
      ? and(eq(t.channel, channel), eq(t.externalAccountId, ref.externalAccountId))
      : and(eq(t.channel, channel), eq(t.externalParentId, ref.externalParentId));
  const rows = await getDb().select().from(t).where(where).limit(1);
  return rows[0] ?? null;
}

/** La cuenta de un canal de la organización (en M1: una por canal, D4). */
export async function findAccountForOrg(
  organizationId: string,
  channel: ChannelKind
): Promise<AccountRow | null> {
  const t = schema.channelAccount;
  const rows = await getDb()
    .select()
    .from(t)
    .where(scoped(t.organizationId, organizationId, eq(t.channel, channel)))
    .limit(1);
  return rows[0] ?? null;
}

/** La cuenta por id, SOLO dentro de la organización. */
export async function findAccountById(
  organizationId: string,
  id: string
): Promise<AccountRow | null> {
  const t = schema.channelAccount;
  const rows = await getDb()
    .select()
    .from(t)
    .where(scoped(t.organizationId, organizationId, eq(t.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export function accountView(row: AccountRow): ChannelAccountView {
  return {
    id: row.id,
    organizationId: row.organizationId,
    channel: row.channel,
    externalAccountId: row.externalAccountId,
    externalParentId: row.externalParentId,
    status: row.status,
  };
}

/** Secreto descifrado (lib/crypto). null si la cuenta no guarda secreto. */
export function accountSecret(row: AccountRow): string | null {
  if (!row.secretCipher || !row.secretIv || !row.secretTag) return null;
  return decryptSecret({ cipher: row.secretCipher, iv: row.secretIv, tag: row.secretTag });
}

/** Contexto que el núcleo pasa al adaptador (segreto descifrado, jamás al cliente). */
export function accountContext(row: AccountRow): AccountContext {
  return {
    organizationId: row.organizationId,
    account: accountView(row),
    secret: accountSecret(row),
    markReconnectRequired: () => markAccountReconnectRequired(row),
  };
}

/**
 * Marca la conexión como vencida (token inválido detectado en runtime).
 * WhatsApp hasta R3: se escribe `meta_credentials` (fuente de verdad) y se
 * copia a `channel_account` en la misma transacción. Una cuenta sin fila
 * vieja (canales nuevos) se marca directamente.
 */
export async function markAccountReconnectRequired(row: AccountRow): Promise<void> {
  if (row.legacyMetaCredentialsId) {
    await markWhatsappReconnectRequired(row.organizationId);
    return;
  }
  await getDb()
    .update(schema.channelAccount)
    .set({ status: "reconnect_required", updatedAt: new Date() })
    .where(
      scoped(schema.channelAccount.organizationId, row.organizationId, eq(schema.channelAccount.id, row.id))
    );
}

/**
 * La escritura de hoy (`markReconnectRequired` de
 * `src/server/whatsapp/credentials.ts`, que la re-exporta): `meta_credentials`
 * de la organización + doble escritura del estado en `channel_account`.
 */
export async function markWhatsappReconnectRequired(organizationId: string): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(schema.metaCredentials)
      .set({ status: "reconnect_required", updatedAt: new Date() })
      .where(scoped(schema.metaCredentials.organizationId, organizationId))
      .returning({ id: schema.metaCredentials.id });
    await mirrorWhatsappAccounts(
      tx,
      updated.map((r) => r.id)
    );
  });
}
