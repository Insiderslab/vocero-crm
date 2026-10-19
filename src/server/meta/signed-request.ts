import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * 015 — `signed_request` di Meta (Data Deletion Request Callback).
 *
 * Formato: `<firma>.<payload>`, entrambi in base64 URL-safe senza padding.
 * La firma è l'HMAC-SHA256 della parte `<payload>` così com'è (la stringa
 * codificata, non il JSON decodificato), con l'App Secret dell'app Meta.
 * Il payload è un JSON con almeno `algorithm: "HMAC-SHA256"` e `user_id`.
 *
 * Modulo PURO (nessun DB, nessun ambiente): il segreto lo passa il chiamante.
 * Non registra niente: né la firma né il segreto finiscono nei log.
 */

/** Oltre questa lunghezza la richiesta non è di Meta: si rifiuta senza calcoli. */
export const SIGNED_REQUEST_MAX_LENGTH = 4096;

const BASE64URL = /^[A-Za-z0-9_-]+$/;

export type SignedRequestPayload = {
  userId: string;
  /** `issued_at` (secondi Unix), se presente e valido. */
  issuedAt: Date | null;
};

export type SignedRequestResult =
  | { ok: true; payload: SignedRequestPayload }
  | { ok: false; reason: "malformed" | "bad_signature" | "bad_algorithm" | "no_user_id" };

function decodeBase64Url(part: string): Buffer | null {
  if (!part || !BASE64URL.test(part)) return null;
  return Buffer.from(part, "base64url");
}

/**
 * Verifica e decodifica. Ordine voluto: forma → firma (a tempo costante) →
 * contenuto. Il JSON si legge SOLO dopo una firma valida.
 */
export function parseSignedRequest(
  signedRequest: string | null | undefined,
  appSecret: string
): SignedRequestResult {
  if (!appSecret) throw new Error("parseSignedRequest: App Secret mancante");
  if (typeof signedRequest !== "string" || signedRequest.length > SIGNED_REQUEST_MAX_LENGTH) {
    return { ok: false, reason: "malformed" };
  }
  const parts = signedRequest.split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };
  const [sigPart, payloadPart] = parts as [string, string];
  const signature = decodeBase64Url(sigPart);
  if (!signature || !decodeBase64Url(payloadPart)) return { ok: false, reason: "malformed" };

  const expected = createHmac("sha256", appSecret).update(payloadPart, "utf8").digest();
  // timingSafeEqual vuole lunghezze uguali: una firma di lunghezza diversa è
  // comunque sbagliata (la lunghezza di un HMAC-SHA256 non è un segreto).
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) {
    return { ok: false, reason: "bad_signature" };
  }

  let data: unknown;
  try {
    data = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, reason: "malformed" };
  }
  const obj = data as Record<string, unknown>;
  if (typeof obj.algorithm !== "string" || obj.algorithm.toUpperCase() !== "HMAC-SHA256") {
    return { ok: false, reason: "bad_algorithm" };
  }
  const rawUser = obj.user_id;
  const userId =
    typeof rawUser === "string" ? rawUser.trim() : typeof rawUser === "number" ? String(rawUser) : "";
  if (!/^[0-9A-Za-z_-]{1,64}$/.test(userId)) return { ok: false, reason: "no_user_id" };
  const issued = typeof obj.issued_at === "number" && Number.isFinite(obj.issued_at) ? obj.issued_at : null;
  return {
    ok: true,
    payload: { userId, issuedAt: issued !== null ? new Date(issued * 1000) : null },
  };
}

/** Per i test e gli strumenti di prova: costruisce un signed_request valido. */
export function buildSignedRequest(payload: Record<string, unknown>, appSecret: string): string {
  const payloadPart = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", appSecret).update(payloadPart, "utf8").digest("base64url");
  return `${sig}.${payloadPart}`;
}
