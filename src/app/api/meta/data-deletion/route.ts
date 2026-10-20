import { apiError } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { readBodyCapped } from "@/server/inbox/webhook";
import { registerDeletionRequest, statusUrl } from "@/server/meta/data-deletion";
import { parseSignedRequest } from "@/server/meta/signed-request";

export const dynamic = "force-dynamic";

/**
 * 015 — «Data Deletion Request Callback» di Meta
 * (specs/custom-heili/015-cancellazione-dati-meta.md).
 *
 * Rotta PUBBLICA: la chiama Meta quando una persona rimuove l'app dal suo
 * account Facebook e chiede la cancellazione dei dati. La autentica il
 * `signed_request` firmato con l'App Secret (META_APP_SECRET, lo stesso del
 * webhook WhatsApp). Firma non valida o payload malformato → 400 e nessuna
 * riga scritta. Risposta come la vuole Meta: `{ url, confirmation_code }`.
 * Nei log solo il codice: mai firma, payload o segreto.
 */

/** Il corpo di Meta è un solo campo form-encoded: 8 KB bastano e avanzano. */
const MAX_BODY_BYTES = 8 * 1024;
/** Meta chiama da pochi indirizzi e di rado; il tetto frena solo gli abusi. */
const IP_LIMIT = { windowMs: 60_000, max: 60 };

export async function POST(req: Request) {
  if (!checkRateLimit(`meta-deletion:${clientIp(req.headers)}`, IP_LIMIT).allowed) {
    return apiError(429, "rate_limited", "Troppe richieste");
  }
  const appSecret = getEnv().META_APP_SECRET;
  if (!appSecret) {
    console.error("[data-deletion] META_APP_SECRET mancante: richiesta rifiutata (503), niente registrato");
    return apiError(503, "not_configured", "Servizio non configurato");
  }

  const raw = await readBodyCapped(req, MAX_BODY_BYTES);
  if (!raw) return apiError(400, "invalid_request", "Richiesta non valida");
  const contentType = req.headers.get("content-type") ?? "";
  let signed: string | null = null;
  if (contentType.startsWith("application/x-www-form-urlencoded")) {
    signed = new URLSearchParams(raw.toString("utf8")).get("signed_request");
  } else if (contentType.startsWith("multipart/form-data")) {
    const form = await new Response(new Uint8Array(raw), { headers: { "content-type": contentType } })
      .formData()
      .catch(() => null);
    const value = form?.get("signed_request");
    signed = typeof value === "string" ? value : null;
  }

  const parsed = parseSignedRequest(signed, appSecret);
  if (!parsed.ok) {
    console.warn(`[data-deletion] richiesta rifiutata (${parsed.reason})`);
    return apiError(400, "invalid_signed_request", "signed_request non valido");
  }

  const { code, reused } = await registerDeletionRequest({
    metaUserId: parsed.payload.userId,
    issuedAt: parsed.payload.issuedAt,
  });
  console.log(`[data-deletion] richiesta ${reused ? "già aperta" : "registrata"}: codice ${code}`);
  return Response.json({
    url: statusUrl(getEnv().APP_BASE_URL, code),
    confirmation_code: code,
  });
}
