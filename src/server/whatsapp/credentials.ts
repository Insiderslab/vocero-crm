import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { encryptSecret } from "@/lib/crypto";
import {
  accountSecret,
  findAccountByRef,
  findAccountForOrg,
  markWhatsappReconnectRequired,
  type AccountRow,
} from "@/server/channels/core/accounts";
import { mirrorWhatsappAccounts } from "@/server/channels/dual-write";

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

/**
 * 005 (R2, T030): `Credentials` es la VISTA de la cuenta WhatsApp en
 * `channel_account` (mismos campos que antes). Los campos 009 de la
 * coexistence viven en `channel_account.config`, en el formato de la función
 * SQL `channels_legacy_wa_config` (la fecha como `to_jsonb(timestamp)`: ISO sin
 * zona = UTC). Las ESCRITURAS siguen yendo a `meta_credentials` (fuente de
 * verdad hasta R3) con la copia en la misma transacción.
 */
function configDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const iso = /(Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

const ONBOARDING_MODES = new Set<OnboardingMode>(["manual", "embedded", "coexistence"]);

function toCredentials(row: AccountRow): Credentials {
  const config = (row.config ?? {}) as Record<string, unknown>;
  const mode = config.onboardingMode as OnboardingMode;
  return {
    id: row.legacyMetaCredentialsId ?? row.id,
    organizationId: row.organizationId,
    wabaId: row.externalParentId ?? "",
    phoneNumberId: row.externalAccountId,
    displayPhoneNumber: row.displayName,
    verifiedName: row.verifiedName,
    // WhatsApp solo conoce dos estados (los otros dos son de canales nuevos).
    status: row.status === "reconnect_required" ? "reconnect_required" : "connected",
    onboardingMode: ONBOARDING_MODES.has(mode) ? mode : "manual",
    appDisconnectedAt: configDate(config.appDisconnectedAt),
    token: accountSecret(row) ?? "",
  };
}

/** Resuelve la conexión por phone_number_id (enrutamiento del webhook). */
export async function getCredentialsByPhoneNumberId(
  phoneNumberId: string
): Promise<Credentials | null> {
  const row = await findAccountByRef("whatsapp", {
    by: "account",
    externalAccountId: phoneNumberId,
  });
  return row ? toCredentials(row) : null;
}

/** Resuelve la conexión por WABA ID (eventos a nivel WABA, ej. plantillas). */
export async function getCredentialsByWabaId(
  wabaId: string
): Promise<Credentials | null> {
  const row = await findAccountByRef("whatsapp", {
    by: "parent",
    externalParentId: wabaId,
  });
  return row ? toCredentials(row) : null;
}

export async function getCredentialsByOrg(
  organizationId: string
): Promise<Credentials | null> {
  const row = await findAccountForOrg(organizationId, "whatsapp");
  return row ? toCredentials(row) : null;
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
  // 005 (R1): doble escritura en channel_account, misma transacción.
  await db.transaction(async (tx) => {
    const saved = await tx
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
      })
      .returning({ id: schema.metaCredentials.id });
    await mirrorWhatsappAccounts(
      tx,
      saved.map((r) => r.id)
    );
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
  const wabaId = input.wabaId;
  if (!wabaId) return [];
  const digits = (input.phoneNumber ?? "").replace(/\D/g, "");
  const db = getDb();
  // 005 (R1): doble escritura en channel_account.config, misma transacción.
  const rows = await db.transaction(async (tx) => {
    const updated = await tx
      .update(schema.metaCredentials)
      .set({
        appDisconnectedAt: input.disconnected ? new Date() : null,
        updatedAt: new Date(),
      })
      // Un PARTNER_REMOVED de OTRO partner en una WABA compartida (ej. un CRM
      // externo) no debe pintar un falso corte en una conexión manual.
      .where(
        and(
          eq(schema.metaCredentials.wabaId, wabaId),
          eq(schema.metaCredentials.onboardingMode, "coexistence"),
          digits
            ? sql`regexp_replace(coalesce(${schema.metaCredentials.displayPhoneNumber}, ''), '[^0-9]', '', 'g') = ${digits}`
            : undefined
        )
      )
      .returning({
        id: schema.metaCredentials.id,
        organizationId: schema.metaCredentials.organizationId,
      });
    await mirrorWhatsappAccounts(
      tx,
      updated.map((r) => r.id)
    );
    return updated;
  });
  return rows.map((r) => r.organizationId);
}

/**
 * Marca la conexión como vencida (token inválido detectado en runtime).
 * 005 (M1.3): implementada en el núcleo (`markWhatsappReconnectRequired`),
 * misma escritura y misma doble escritura que en R1.
 */
export const markReconnectRequired = markWhatsappReconnectRequired;

/** Últimos 4 caracteres del token para mostrar en UI (jamás el token). */
export function tokenLast4(token: string): string {
  return token.slice(-4);
}
