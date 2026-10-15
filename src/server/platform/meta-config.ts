import { z } from "zod";
import { getEnv } from "@/lib/env";
import { webhookSignatureStats } from "@/server/inbox/webhook-signature-stats";
import {
  readInstanceSettings,
  writeInstanceSettings,
  type StoredInstanceSettings,
} from "@/server/platform/instance-settings";

/**
 * 013 — Configurazione Meta della PIATTAFORMA (una per istanza): App ID e
 * Configuration ID dell'Embedded Signup. Non sono segreti (finiscono nel
 * browser per aprire la finestra di Meta).
 *
 * Fonte: variabile d'ambiente se impostata (override, come prima), altrimenti
 * quello che il super-admin ha salvato in /admin → Piattaforma → Meta.
 * L'App Secret (`META_APP_SECRET`) resta SOLO nell'ambiente: qui si dice al
 * massimo se c'è e se le firme arrivano verificate, mai il suo valore.
 */

/** ID di Meta: solo cifre, da 6 a 25. */
export const META_ID_PATTERN = /^\d{6,25}$/;

/**
 * Campo del modulo: stringa (spazi tolti) o null. Vuoto o null = cancella il
 * valore salvato; altrimenti deve rispettare `META_ID_PATTERN`.
 */
export const metaIdInput = z
  .union([z.string().max(64), z.null()])
  .transform((v) => (v ?? "").trim())
  .refine((v) => v === "" || META_ID_PATTERN.test(v), {
    message: "Solo cifre, da 6 a 25",
  })
  .transform((v) => (v === "" ? null : v));

/** Corpo del PUT: SOLO questi due campi (`strict`: un `appSecret` → 422). */
export const metaPlatformInput = z
  .object({ appId: metaIdInput, configId: metaIdInput })
  .strict();

export type MetaIdSource = "env" | "db" | "none";
export type ResolvedMetaId = { value: string | null; source: MetaIdSource };
export type MetaPlatformIds = { appId: ResolvedMetaId; configId: ResolvedMetaId };

function pick(envValue: string | undefined, stored: string | undefined): ResolvedMetaId {
  const fromEnv = envValue?.trim();
  if (fromEnv) return { value: fromEnv, source: "env" };
  if (stored) return { value: stored, source: "db" };
  return { value: null, source: "none" };
}

/** Pura: l'ambiente vince se è impostato; poi il database; poi niente. */
export function resolveMetaIds(
  env: { META_APP_ID?: string; META_ES_CONFIG_ID?: string },
  stored: StoredInstanceSettings
): MetaPlatformIds {
  return {
    appId: pick(env.META_APP_ID, stored.meta_app_id),
    configId: pick(env.META_ES_CONFIG_ID, stored.meta_es_config_id),
  };
}

/** App ID e Configuration ID effettivi. Con entrambi nell'ambiente non legge il DB. */
export async function getMetaPlatformIds(): Promise<MetaPlatformIds> {
  const env = getEnv();
  const envComplete = Boolean(env.META_APP_ID?.trim() && env.META_ES_CONFIG_ID?.trim());
  const stored = envComplete ? {} : await readInstanceSettings();
  return resolveMetaIds(env, stored);
}

/** I 6 campi del webhook da sottoscrivere nell'app Meta (spec 006 e 013). */
export const META_WEBHOOK_FIELDS = [
  "messages",
  "message_template_status_update",
  "smb_message_echoes",
  "history",
  "smb_app_state_sync",
  "account_update",
] as const;

export const ES_FEATURE_TYPE = "whatsapp_business_app_onboarding";

export type MetaPlatformStatus = {
  appId: ResolvedMetaId & { stored: string | null };
  configId: ResolvedMetaId & { stored: string | null };
  /** Presenza e stato REALE dell'App Secret (contatori della firma), mai il valore. */
  appSecret: {
    present: boolean;
    lastVerifiedAt: string | null;
    lastInvalidAt: string | null;
    invalidSinceBoot: number;
  };
  /** Con il gateway Wapi il pulsante «Collega con Meta» non compare (spec 006). */
  wapiGateway: boolean;
  /** Il pulsante compare nelle organizzazioni: ID + App Secret, senza Wapi. */
  embeddedSignupReady: boolean;
  /** Per la checklist dei passi su Meta. */
  checklist: { domain: string; featureType: string; webhookFields: readonly string[] };
};

/** Stato per la scheda del super-admin. Costruito campo per campo: niente segreti. */
export async function getMetaPlatformStatus(): Promise<MetaPlatformStatus> {
  const env = getEnv();
  const stored = await readInstanceSettings();
  const ids = resolveMetaIds(env, stored);
  const stats = webhookSignatureStats();
  const present = Boolean(env.META_APP_SECRET);
  const wapiGateway = Boolean(env.WAPI_BASE_URL);
  let domain: string;
  try {
    domain = new URL(env.APP_BASE_URL).hostname;
  } catch {
    domain = env.APP_BASE_URL;
  }
  return {
    appId: { ...ids.appId, stored: stored.meta_app_id ?? null },
    configId: { ...ids.configId, stored: stored.meta_es_config_id ?? null },
    appSecret: {
      present,
      lastVerifiedAt: stats.lastVerifiedAt,
      lastInvalidAt: stats.lastInvalidAt,
      invalidSinceBoot: stats.invalidSinceBoot,
    },
    wapiGateway,
    embeddedSignupReady:
      present && !wapiGateway && Boolean(ids.appId.value && ids.configId.value),
    checklist: { domain, featureType: ES_FEATURE_TYPE, webhookFields: META_WEBHOOK_FIELDS },
  };
}

export async function saveMetaPlatformIds(
  input: z.infer<typeof metaPlatformInput>,
  updatedBy: string
): Promise<void> {
  await writeInstanceSettings(
    { meta_app_id: input.appId, meta_es_config_id: input.configId },
    updatedBy
  );
}
