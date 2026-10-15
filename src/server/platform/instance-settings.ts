import { eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { INSTANCE_SETTING_KEYS, type InstanceSettingKey } from "@/lib/db/schema";

/**
 * 013 — Archivio delle impostazioni dell'ISTANZA (`instance_setting`).
 *
 * Solo chiavi della lista bianca e solo valori non segreti (il CHECK della
 * tabella lo ripete). Non è una tabella di dominio: niente `scoped()`, perché
 * non appartiene a nessuna organizzazione; la scrive solo il super-admin.
 */

export type StoredInstanceSettings = Partial<Record<InstanceSettingKey, string>>;

export async function readInstanceSettings(
  keys: readonly InstanceSettingKey[] = INSTANCE_SETTING_KEYS
): Promise<StoredInstanceSettings> {
  const rows = await getDb()
    .select({ key: schema.instanceSetting.key, value: schema.instanceSetting.value })
    .from(schema.instanceSetting)
    .where(inArray(schema.instanceSetting.key, [...keys]));
  const out: StoredInstanceSettings = {};
  for (const row of rows) out[row.key as InstanceSettingKey] = row.value;
  return out;
}

/**
 * Scrive le chiavi indicate in una transazione: un valore cancella la riga
 * se è `null`, altrimenti la inserisce o la aggiorna. Le chiavi assenti
 * dall'oggetto non si toccano.
 */
export async function writeInstanceSettings(
  values: Partial<Record<InstanceSettingKey, string | null>>,
  updatedBy: string
): Promise<void> {
  await getDb().transaction(async (tx) => {
    for (const [key, value] of Object.entries(values) as [InstanceSettingKey, string | null][]) {
      if (value === null) {
        await tx.delete(schema.instanceSetting).where(eq(schema.instanceSetting.key, key));
        continue;
      }
      await tx
        .insert(schema.instanceSetting)
        .values({ key, value, updatedBy })
        .onConflictDoUpdate({
          target: schema.instanceSetting.key,
          set: { value, updatedBy, updatedAt: sql`now()` },
        });
    }
  });
}
