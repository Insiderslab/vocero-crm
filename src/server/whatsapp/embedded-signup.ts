import { getEnv } from "@/lib/env";
import {
  exchangeEmbeddedSignupCode,
  graphRequest,
  MetaApiError,
} from "@/lib/meta/client";
import {
  getCredentialsByPhoneNumberId,
  saveCredentials,
} from "@/server/whatsapp/credentials";
import { subscribeAppToWaba, testConnection } from "@/server/whatsapp/connect";

/**
 * 009 — Embedded Signup de Meta (custom heili.cloud).
 *
 * El navegador corre el popup de Meta (SDK JS) y nos entrega un `code` de un
 * solo uso + los IDs de la WABA y del número. Aquí, en el servidor: canje del
 * code por el token de negocio, validación token↔número, guardado cifrado,
 * suscripción de la app a la WABA y — en coexistence — pedido de
 * sincronización de agenda e historial (Meta da ~24 h para pedirlas).
 *
 * En coexistence NO se llama a `/register`: el número ya está registrado por
 * la app WhatsApp Business del teléfono y sigue viviendo ahí.
 */

export type EmbeddedSignupConfig =
  | { enabled: true; appId: string; configId: string; graphVersion: string }
  | { enabled: false };

/** Config pública para el navegador. App ID y Config ID no son secretos. */
export function getEmbeddedSignupConfig(): EmbeddedSignupConfig {
  const env = getEnv();
  if (!env.META_APP_ID || !env.META_ES_CONFIG_ID || !env.META_APP_SECRET) {
    return { enabled: false };
  }
  // Con el gateway Wapi activo los envíos usan la clave Wapi, no el token del
  // Embedded Signup: el botón no aparece para no dejar una conexión que no se
  // usa (y Wapi está congelado desde el 10/10/2026).
  if (env.WAPI_BASE_URL) return { enabled: false };
  return {
    enabled: true,
    appId: env.META_APP_ID,
    configId: env.META_ES_CONFIG_ID,
    graphVersion: env.META_GRAPH_API_VERSION,
  };
}

export type EmbeddedSignupErrorCode =
  | "not_configured"
  | "code_exchange_failed"
  | "phone_not_found"
  | "phone_ambiguous"
  | "phone_in_use"
  | "invalid_token"
  | "meta_unavailable"
  | "meta_error";

const STATUS: Record<EmbeddedSignupErrorCode, number> = {
  not_configured: 409,
  code_exchange_failed: 422,
  phone_not_found: 422,
  phone_ambiguous: 422,
  phone_in_use: 409,
  invalid_token: 422,
  meta_unavailable: 503,
  meta_error: 422,
};

export class EmbeddedSignupError extends Error {
  code: EmbeddedSignupErrorCode;
  status: number;
  constructor(code: EmbeddedSignupErrorCode, message: string) {
    super(message);
    this.name = "EmbeddedSignupError";
    this.code = code;
    this.status = STATUS[code];
  }
}

export type SyncRequestStatus = "requested" | "failed" | "skipped";

export type EmbeddedSignupResult = {
  displayPhoneNumber: string;
  verifiedName: string | null;
  onboardingMode: "embedded" | "coexistence";
  sync: { contacts: SyncRequestStatus; history: SyncRequestStatus };
};

/**
 * Comprueba que el número pertenece a la WABA que mandó el navegador (los IDs
 * del popup llegan del cliente y no son de fiar). Si el popup no trajo el
 * phone_number_id, se deduce de la WABA cuando tiene un solo número.
 */
async function resolvePhoneInWaba(
  wabaId: string,
  phoneNumberId: string | null,
  token: string
): Promise<string> {
  const res = await graphRequest<{ data?: { id: string }[] }>(
    `${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name`,
    { token }
  );
  const ids = (res.data ?? []).map((n) => String(n.id));
  if (phoneNumberId) {
    if (!ids.includes(phoneNumberId)) {
      throw new EmbeddedSignupError(
        "phone_not_found",
        "El número elegido no pertenece a esa cuenta de WhatsApp: repite la conexión"
      );
    }
    return phoneNumberId;
  }
  if (ids.length === 0) {
    throw new EmbeddedSignupError(
      "phone_not_found",
      "La cuenta de WhatsApp conectada no tiene números"
    );
  }
  if (ids.length > 1) {
    throw new EmbeddedSignupError(
      "phone_ambiguous",
      "La cuenta de WhatsApp tiene varios números: repite la conexión eligiendo uno"
    );
  }
  return ids[0]!;
}

/**
 * Pide a Meta la sincronización de agenda (`smb_app_state_sync`) y de
 * historial (`history`) de un número en coexistence. Llegan después por
 * webhook. Best-effort: un fallo no deshace la conexión (se informa).
 */
export async function requestCoexistenceSync(
  phoneNumberId: string,
  token: string
): Promise<{ contacts: SyncRequestStatus; history: SyncRequestStatus }> {
  const one = async (
    syncType: "smb_app_state_sync" | "history"
  ): Promise<SyncRequestStatus> => {
    try {
      await graphRequest(`${phoneNumberId}/smb_app_data`, {
        method: "POST",
        token,
        body: { messaging_product: "whatsapp", sync_type: syncType },
      });
      return "requested";
    } catch (err) {
      console.warn(
        `[embedded-signup] smb_app_data ${syncType} falló:`,
        err instanceof Error ? err.message : err
      );
      return "failed";
    }
  };
  // Orden de la guía de Meta: primero la agenda, luego el historial.
  const contacts = await one("smb_app_state_sync");
  const history = await one("history");
  return { contacts, history };
}

export async function completeEmbeddedSignup(input: {
  organizationId: string;
  code: string;
  wabaId: string;
  phoneNumberId?: string | null;
  coexistence: boolean;
}): Promise<EmbeddedSignupResult> {
  const config = getEmbeddedSignupConfig();
  const env = getEnv();
  if (!config.enabled || !env.META_APP_SECRET) {
    throw new EmbeddedSignupError(
      "not_configured",
      "El Embedded Signup no está configurado en esta instancia (META_APP_ID, META_ES_CONFIG_ID, META_APP_SECRET)"
    );
  }

  let token: string;
  try {
    token = await exchangeEmbeddedSignupCode({
      code: input.code,
      appId: config.appId,
      appSecret: env.META_APP_SECRET,
    });
  } catch (err) {
    if (err instanceof MetaApiError && (err.status === 0 || err.status >= 500)) {
      throw new EmbeddedSignupError(
        "meta_unavailable",
        "Meta no está disponible en este momento; intenta de nuevo"
      );
    }
    throw new EmbeddedSignupError(
      "code_exchange_failed",
      "Meta no aceptó el código de conexión (vence en pocos minutos): repite la conexión"
    );
  }

  let phoneNumberId: string;
  try {
    phoneNumberId = await resolvePhoneInWaba(
      input.wabaId,
      input.phoneNumberId?.trim() || null,
      token
    );
  } catch (err) {
    if (err instanceof EmbeddedSignupError) throw err;
    if (err instanceof MetaApiError && (err.status === 0 || err.status >= 500)) {
      throw new EmbeddedSignupError(
        "meta_unavailable",
        "Meta no está disponible en este momento; intenta de nuevo"
      );
    }
    throw new EmbeddedSignupError(
      "meta_error",
      err instanceof Error ? err.message : "No se pudo leer el número"
    );
  }

  const check = await testConnection(phoneNumberId, token);
  if (!check.ok) throw new EmbeddedSignupError(check.code, check.message);

  // Un número enruta a UNA organización (índice único por phone_number_id).
  const owner = await getCredentialsByPhoneNumberId(phoneNumberId);
  if (owner && owner.organizationId !== input.organizationId) {
    throw new EmbeddedSignupError(
      "phone_in_use",
      "Este número ya está conectado a otra organización de esta instancia"
    );
  }

  const onboardingMode = input.coexistence ? "coexistence" : "embedded";
  await saveCredentials({
    organizationId: input.organizationId,
    wabaId: input.wabaId,
    phoneNumberId,
    token,
    displayPhoneNumber: check.displayPhoneNumber,
    verifiedName: check.verifiedName,
    onboardingMode,
  });

  await subscribeAppToWaba(input.wabaId, token);

  const sync = input.coexistence
    ? await requestCoexistenceSync(phoneNumberId, token)
    : { contacts: "skipped" as const, history: "skipped" as const };

  return {
    displayPhoneNumber: check.displayPhoneNumber,
    verifiedName: check.verifiedName,
    onboardingMode,
    sync,
  };
}
