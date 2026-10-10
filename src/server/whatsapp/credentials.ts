import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { scoped } from "@/lib/db/tenant";

export type Credentials = {
  id: string;
  organizationId: string;
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  status: "connected" | "reconnect_required";
  /** 009 — cómo se conectó (manual / Embedded Signup / coexistence). */
  onboardingMode: "manual" | "embedded" | "coexistence";
  /** 009 — la coexistence se cortó (Meta account_update); null = activa. */
  appDisconnectedAt: Date | null;
  token: string;
};

export type OnboardingMode = Credentials["onboardingMode"];

type Row = typeof schema.metaCredentials.$inferSelect;

function toCredentials(row: Row): Credentials {
  return {
    id: row.id,
    organizationId: row.organizationId,
    wabaId: row.wabaId,
    phoneNumberId: row.phoneNumberId,
    displayPhoneNumber: row.displayPhoneNumber,
    verifiedName: row.verifiedName,
    status: row.status,
    onboardingMode: row.onboardingMode,
    appDisconnectedAt: row.appDisconnectedAt,
    token: decryptSecret({
      cipher: row.tokenCipher,
      iv: row.tokenIv,
      tag: row.tokenTag,
    }),
  };
}

/** Resuelve la conexión por phone_number_id (enrutamiento del webhook). */
export async function getCredentialsByPhoneNumberId(
  phoneNumberId: string
): Promise<Credentials | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.metaCredentials)
    .where(eq(schema.metaCredentials.phoneNumberId, phoneNumberId))
    .limit(1);
  return rows[0] ? toCredentials(rows[0]) : null;
}

/** Resuelve la conexión por WABA ID (eventos a nivel WABA, ej. plantillas). */
export async function getCredentialsByWabaId(
  wabaId: string
): Promise<Credentials | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.metaCredentials)
    .where(eq(schema.metaCredentials.wabaId, wabaId))
    .limit(1);
  return rows[0] ? toCredentials(rows[0]) : null;
}

export async function getCredentialsByOrg(
  organizationId: string
): Promise<Credentials | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.metaCredentials)
    .where(scoped(schema.metaCredentials.organizationId, organizationId))
    .limit(1);
  return rows[0] ? toCredentials(rows[0]) : null;
}

export async function saveCredentials(input: {
  organizationId: string;
  wabaId: string;
  phoneNumberId: string;
  token: string;
  displayPhoneNumber?: string | null;
  verifiedName?: string | null;
  /** 009 — default `manual` (wizard). */
  onboardingMode?: OnboardingMode;
}): Promise<void> {
  const db = getDb();
  const enc = encryptSecret(input.token);
  const onboardingMode = input.onboardingMode ?? "manual";
  // Re-guardar a mano el MISMO número (ej. token nuevo) conserva el modo de
  // conexión; cambiar de número sin modo explícito vuelve a `manual`.
  const modeOnUpdate = input.onboardingMode
    ? input.onboardingMode
    : sql`case when ${schema.metaCredentials.phoneNumberId} = excluded.phone_number_id then ${schema.metaCredentials.onboardingMode} else 'manual' end`;
  await db
    .insert(schema.metaCredentials)
    .values({
      id: newId("credentials"),
      organizationId: input.organizationId,
      wabaId: input.wabaId,
      phoneNumberId: input.phoneNumberId,
      displayPhoneNumber: input.displayPhoneNumber ?? null,
      verifiedName: input.verifiedName ?? null,
      tokenCipher: enc.cipher,
      tokenIv: enc.iv,
      tokenTag: enc.tag,
      status: "connected",
      onboardingMode,
      appDisconnectedAt: null,
    })
    .onConflictDoUpdate({
      target: [schema.metaCredentials.organizationId],
      set: {
        wabaId: input.wabaId,
        phoneNumberId: input.phoneNumberId,
        displayPhoneNumber: input.displayPhoneNumber ?? null,
        verifiedName: input.verifiedName ?? null,
        tokenCipher: enc.cipher,
        tokenIv: enc.iv,
        tokenTag: enc.tag,
        status: "connected",
        onboardingMode: modeOnUpdate,
        appDisconnectedAt: null,
        updatedAt: new Date(),
      },
    });
}

/**
 * 009 — Meta avisó que la coexistence se cortó o se restableció
 * (`account_update`, a nivel WABA: entry.id). Si el evento trae el número
 * (`PARTNER_REMOVED` trae `phone_number`), solo se marca ESE número: una WABA
 * puede tener números de varias organizaciones. Solo afecta conexiones en
 * coexistence. Devuelve las organizaciones afectadas.
 */
export async function setAppDisconnected(input: {
  wabaId: string | null;
  /** Número visible que manda Meta, en cualquier formato. */
  phoneNumber?: string | null;
  disconnected: boolean;
}): Promise<string[]> {
  if (!input.wabaId) return [];
  const digits = (input.phoneNumber ?? "").replace(/\D/g, "");
  const db = getDb();
  const rows = await db
    .update(schema.metaCredentials)
    .set({
      appDisconnectedAt: input.disconnected ? new Date() : null,
      updatedAt: new Date(),
    })
    // Un PARTNER_REMOVED de OTRO partner en una WABA compartida (ej. un CRM
    // externo) no debe pintar un falso corte en una conexión manual.
    .where(
      and(
        eq(schema.metaCredentials.wabaId, input.wabaId),
        eq(schema.metaCredentials.onboardingMode, "coexistence"),
        digits
          ? sql`regexp_replace(coalesce(${schema.metaCredentials.displayPhoneNumber}, ''), '[^0-9]', '', 'g') = ${digits}`
          : undefined
      )
    )
    .returning({ organizationId: schema.metaCredentials.organizationId });
  return rows.map((r) => r.organizationId);
}

/** Marca la conexión como vencida (token inválido detectado en runtime). */
export async function markReconnectRequired(
  organizationId: string
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.metaCredentials)
    .set({ status: "reconnect_required", updatedAt: new Date() })
    .where(scoped(schema.metaCredentials.organizationId, organizationId));
}

/** Últimos 4 caracteres del token para mostrar en UI (jamás el token). */
export function tokenLast4(token: string): string {
  return token.slice(-4);
}
