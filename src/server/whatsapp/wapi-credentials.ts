import { isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { scoped } from "@/lib/db/tenant";

/**
 * C3 — Clave del gateway Wapi POR organización (bearer `hlp_live_…`).
 *
 * - Cifrada en reposo con `lib/crypto` (misma ENCRYPTION_KEY que el token Meta).
 * - El texto plano solo sale de aquí hacia `resolveGraphTransport`
 *   (`lib/meta/client.ts`); NUNCA hacia una respuesta de la API ni a logs. Las
 *   funciones de estado devuelven únicamente `last4`.
 * - Toda consulta pasa por `scoped()`: una organización no puede leer la
 *   clave de otra.
 */

/** Forma aceptada: prefijo `hlp_live_` + al menos 16 caracteres sin espacios. */
const WAPI_KEY_RE = /^hlp_live_\S{16,}$/;
const WAPI_KEY_MAX = 200;

export function isValidWapiKeyFormat(key: string): boolean {
  return key.length <= WAPI_KEY_MAX && WAPI_KEY_RE.test(key);
}

/** Últimos 4 caracteres para mostrar en UI (jamás la clave). */
export function wapiKeyLast4(key: string): string {
  return key.slice(-4);
}

/** Clave activa (no revocada) de la organización en texto plano, o null. */
export async function getWapiKeyByOrg(
  organizationId: string
): Promise<string | null> {
  const rows = await getDb()
    .select()
    .from(schema.wapiCredentials)
    .where(
      scoped(
        schema.wapiCredentials.organizationId,
        organizationId,
        isNull(schema.wapiCredentials.revokedAt)
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return decryptSecret({
    cipher: row.keyCipher,
    iv: row.keyIv,
    tag: row.keyTag,
  });
}

export type WapiKeyStatus =
  | { configured: false }
  | { configured: true; last4: string; updatedAt: Date };

/** Estado para la UI: existencia y últimos 4. Nunca descifra la clave. */
export async function getWapiKeyStatus(
  organizationId: string
): Promise<WapiKeyStatus> {
  const rows = await getDb()
    .select({
      last4: schema.wapiCredentials.keyLast4,
      updatedAt: schema.wapiCredentials.updatedAt,
    })
    .from(schema.wapiCredentials)
    .where(
      scoped(
        schema.wapiCredentials.organizationId,
        organizationId,
        isNull(schema.wapiCredentials.revokedAt)
      )
    )
    .limit(1);
  const row = rows[0];
  return row
    ? { configured: true, last4: row.last4, updatedAt: row.updatedAt }
    : { configured: false };
}

/** Guarda (o reemplaza y reactiva) la clave de la organización, cifrada. */
export async function saveWapiKey(input: {
  organizationId: string;
  key: string;
  createdBy: string;
}): Promise<{ last4: string }> {
  if (!input.organizationId) {
    throw new Error("saveWapiKey(): organizationId vacío — sin tenant");
  }
  if (!isValidWapiKeyFormat(input.key)) {
    throw new Error("saveWapiKey(): formato de clave Wapi inválido");
  }
  const enc = encryptSecret(input.key);
  const last4 = wapiKeyLast4(input.key);
  await getDb()
    .insert(schema.wapiCredentials)
    .values({
      id: newId("wapiCredentials"),
      organizationId: input.organizationId,
      keyCipher: enc.cipher,
      keyIv: enc.iv,
      keyTag: enc.tag,
      keyLast4: last4,
      createdBy: input.createdBy,
    })
    .onConflictDoUpdate({
      target: [schema.wapiCredentials.organizationId],
      set: {
        keyCipher: enc.cipher,
        keyIv: enc.iv,
        keyTag: enc.tag,
        keyLast4: last4,
        createdBy: input.createdBy,
        revokedAt: null,
        updatedAt: new Date(),
      },
    });
  return { last4 };
}

/**
 * Revoca la clave de la organización (idempotente). Devuelve true si había una
 * clave activa. Tras revocar, esa organización deja de desviarse a Wapi con
 * clave propia (y jamás cae a la clave de otra).
 */
export async function revokeWapiKey(organizationId: string): Promise<boolean> {
  const rows = await getDb()
    .update(schema.wapiCredentials)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(
      scoped(
        schema.wapiCredentials.organizationId,
        organizationId,
        isNull(schema.wapiCredentials.revokedAt)
      )
    )
    .returning({ id: schema.wapiCredentials.id });
  return rows.length > 0;
}
