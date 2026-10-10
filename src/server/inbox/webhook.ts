import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Autenticación en dos capas del webhook (contrato webhook.md / DV-VC-02).
 * Este módulo es puro (sin BD) para poder testearse unitariamente.
 */

/** Comparación timing-safe de strings de longitud arbitraria. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHmac("sha256", "cmp").update(a).digest();
  const hb = createHmac("sha256", "cmp").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Capa 1: el segmento de la ruta debe coincidir con el verify token. */
export function isValidWebhookToken(
  segment: string,
  verifyToken: string
): boolean {
  return verifyToken.length > 0 && safeEqual(segment, verifyToken);
}

/**
 * Capa 2: firma HMAC-SHA256 de Meta sobre el body CRUDO.
 * Fail-closed: sin secreto NO hay firma que verificar y devuelve false. Que un
 * entorno acepte eventos sin firma lo decide `checkSignature` (y solo dentro
 * del gate de pruebas), nunca esta primitiva.
 */
export function isValidSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string | undefined
): boolean {
  if (!appSecret?.trim()) return false;
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret)
    .update(rawBody, "utf8")
    .digest("hex");
  return safeEqual(signatureHeader.slice("sha256=".length), expected);
}

/**
 * Por qué se rechaza un evento en la capa 2:
 * - `secret_missing`: la instancia no tiene META_APP_SECRET y la firma es
 *   obligatoria (todo entorno fuera del gate de pruebas) → la ruta responde
 *   503 y lo registra; el evento no se procesa.
 * - `invalid_signature`: hay secreto pero la firma falta o no coincide → 401.
 */
export type SignatureCheck =
  | { ok: true }
  | { ok: false; reason: "secret_missing" | "invalid_signature" };

/**
 * Decide la capa 2 con la política del entorno.
 *
 * - Con secreto: SIEMPRE se verifica la firma (también en pruebas).
 * - Sin secreto: solo se acepta si `allowUnsigned` (el gate de pruebas de
 *   `@/lib/dev-guard`, cerrado en producción); si no, `secret_missing`.
 *
 * `allowUnsigned` llega como argumento para que el módulo siga puro.
 */
export function checkSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string | undefined,
  allowUnsigned: boolean
): SignatureCheck {
  if (!appSecret?.trim()) {
    return allowUnsigned ? { ok: true } : { ok: false, reason: "secret_missing" };
  }
  return isValidSignature(rawBody, signatureHeader, appSecret)
    ? { ok: true }
    : { ok: false, reason: "invalid_signature" };
}

/* ---------- Tipos del payload de Meta (subconjunto soportado) ---------- */

/** Payload de un adjunto en un mensaje del webhook (008). */
export type WebhookMediaPayload = {
  id?: string;
  mime_type?: string;
  sha256?: string;
  caption?: string;
  /** Solo documentos. */
  filename?: string;
  /** Solo audio: true si es nota de voz. */
  voice?: boolean;
};

export type WebhookLocation = {
  latitude?: number;
  longitude?: number;
  name?: string;
  address?: string;
};

export type WebhookMessage = {
  /** Teléfono del remitente. OPCIONAL desde la migración de Meta a BSUID (003). */
  from?: string;
  /** Business-Scoped User ID del remitente cuando no hay teléfono (003). */
  from_user_id?: string;
  /** Destinatario — presente en echoes de coexistence (008): el wa_id del lead. */
  to?: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: WebhookMediaPayload;
  video?: WebhookMediaPayload;
  audio?: WebhookMediaPayload;
  document?: WebhookMediaPayload;
  sticker?: WebhookMediaPayload;
  location?: WebhookLocation;
  contacts?: unknown[];
};

export type WebhookStatus = {
  id: string;
  status: string;
  timestamp: string;
  recipient_id?: string;
  errors?: { code: number; title?: string; message?: string }[];
};

/** 009 — Mensaje del historial de coexistence (`history`). */
export type HistoryMessage = WebhookMessage & {
  history_context?: { status?: string };
};

/** 009 — Un bloque del webhook `history` (fases 0–1 d, 1–90 d, 90–180 d). */
export type HistoryChunk = {
  metadata?: { phase?: number; chunk_order?: number; progress?: number };
  /** Un hilo por cliente: `id` es su teléfono (wa_id). */
  threads?: { id?: string; messages?: HistoryMessage[] }[];
  /** Presente si el negocio NO compartió el historial (código 2593109). */
  errors?: { code?: number; title?: string; message?: string }[];
};

/** 009 — Entrada de agenda del webhook `smb_app_state_sync`. */
export type StateSyncItem = {
  type?: string;
  contact?: { full_name?: string; first_name?: string; phone_number?: string };
  action?: string;
  metadata?: { timestamp?: string };
};

export type WebhookValue = {
  messaging_product?: string;
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  contacts?: { profile?: { name?: string }; wa_id?: string; user_id?: string }[];
  messages?: WebhookMessage[];
  /** Echoes de coexistence (008): mensajes enviados desde la app del teléfono. */
  message_echoes?: WebhookMessage[];
  statuses?: WebhookStatus[];
  /** 009 — historial de coexistence. */
  history?: HistoryChunk[];
  /** 009 — agenda de la app WhatsApp Business. */
  state_sync?: StateSyncItem[];
  /** 009 — account_update (PARTNER_REMOVED trae el número). */
  phone_number?: string;
  // message_template_status_update · 009: account_update (PARTNER_REMOVED,
  // ACCOUNT_OFFBOARDED, ACCOUNT_RECONNECTED, …)
  event?: string;
  message_template_name?: string;
  message_template_language?: string;
  message_template_id?: number | string;
  reason?: string | null;
};

export type WebhookChange = { field?: string; value?: WebhookValue };

export type WebhookPayload = {
  object?: string;
  entry?: { id?: string; changes?: WebhookChange[] }[];
};
