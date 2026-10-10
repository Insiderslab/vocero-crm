/**
 * Copia CONGELADA de las funciones de escritura de `src/server/whatsapp/credentials.ts`
 * en R0 (`origin/main` @ e23332e, antes de la doble escritura de 005), SOLO para
 * los golden de la migración: simulan lo que la imagen anterior escribe y
 * ACTUALIZA durante un rollback (R1 → R0), sin tocar `channel_account`.
 * No se importa desde `src/`. Origen: `git show e23332e:src/server/whatsapp/credentials.ts`,
 * líneas 83–181, sin cambios salvo los imports.
 */
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { encryptSecret } from "@/lib/crypto";
import { scoped } from "@/lib/db/tenant";

type OnboardingMode = "manual" | "embedded" | "coexistence";

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
