import { apiError } from "@/lib/api";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { authenticateSiteKey, consumeSiteKeyLimit } from "@/server/site-requests/auth";
import { getAllowedOrigins, isOriginRegistered } from "@/server/site-requests/config";
import { ingestSiteRequest } from "@/server/site-requests/ingest";
import {
  MAX_BODY_BYTES,
  SITE_IP_LIMIT,
  SITE_PREFLIGHT_LIMIT,
  corsHeaders,
  isHoneypotFilled,
  normalizeOrigin,
  originAllowed,
  preflightHeaders,
  readBodyCapped,
  siteRequestSchema,
  toSiteRequest,
} from "@/server/site-requests/validation";

export const dynamic = "force-dynamic";

/**
 * 008 — Solicitudes del formulario del sitio web de un negocio
 * (specs/custom-heili/008-richieste-dal-sito.md).
 *
 * Ruta PÚBLICA para el navegador del visitante: la autentica la clave del
 * sitio (`X-Site-Key: vsk_…`), de la que sale SIEMPRE la organización. La
 * clave va publicada en el HTML del sitio: no es un secreto fuerte. Lo que
 * protege es el CORS por organización, los límites, el honeypot y el tope del
 * body. Jamás se registra la clave ni el body.
 */

/** Respuesta con las cabeceras CORS que tocan (vacías si no hay origen autorizado). */
function reply(res: Response, cors: Record<string, string>): Response {
  for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
  return res;
}

/**
 * Preflight. No trae la clave (el navegador no la manda), así que responde a
 * un origen que ALGUNA organización autorizó; el POST vuelve a comprobarlo
 * contra la organización de la clave. A cualquier otro: 403 sin CORS.
 */
export async function OPTIONS(req: Request): Promise<Response> {
  if (!checkRateLimit(`site-preflight:${clientIp(req.headers)}`, SITE_PREFLIGHT_LIMIT).allowed) {
    return new Response(null, { status: 429 });
  }
  const origin = req.headers.get("origin");
  // El navegador manda el origen ya en forma canónica; otra forma no se acepta.
  if (!origin || normalizeOrigin(origin) !== origin) return new Response(null, { status: 403 });
  try {
    if (!(await isOriginRegistered(origin))) return new Response(null, { status: 403 });
  } catch (err) {
    console.error("[sito] preflight fallido:", err instanceof Error ? err.message : "error");
    return new Response(null, { status: 500 });
  }
  return new Response(null, { status: 204, headers: preflightHeaders(origin) });
}

export async function POST(req: Request): Promise<Response> {
  try {
    const contentType = req.headers.get("content-type") ?? "";
    if (!/^application\/json\b/i.test(contentType)) {
      return apiError(415, "unsupported_media_type", "El body debe ser JSON (application/json)");
    }
    const declared = Number(req.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return apiError(413, "payload_too_large", "Solicitud demasiado grande");
    }

    // 1. La clave decide la organización (401, o 429 por fallos de la IP). El
    //    límite de la clave NO se consume aquí (paso 3).
    const auth = await authenticateSiteKey(req);
    if (auth instanceof Response) return auth;
    const { organizationId } = auth;

    // 2. Origen: un navegador solo puede escribir desde un origen autorizado
    //    por ESTA organización. Sin `Origin` (llamada de servidor) se acepta:
    //    el origen no autentica, la clave sí.
    const origin = req.headers.get("origin");
    if (origin !== null && !originAllowed(origin, await getAllowedOrigins(organizationId))) {
      return apiError(403, "origin_not_allowed", "Origen no autorizado para esta clave");
    }
    const cors = origin !== null ? corsHeaders(origin) : {};

    // 3. Límite por IP del cliente, y DESPUÉS el de la clave: una IP que ya
    //    está limitada (o con un origen ajeno, paso 2) no gasta el cupo de la
    //    organización, que es de todos sus visitantes.
    const ipKey = `site-api:ip:${organizationId}:${clientIp(req.headers)}`;
    if (!checkRateLimit(ipKey, SITE_IP_LIMIT).allowed) {
      return reply(apiError(429, "rate_limited", "Demasiadas solicitudes"), cors);
    }
    const keyLimited = consumeSiteKeyLimit(organizationId);
    if (keyLimited) return reply(keyLimited, cors);

    // 4. Body con tope real (aunque falte o mienta el Content-Length).
    const raw = await readBodyCapped(req, MAX_BODY_BYTES);
    if (raw === null) {
      return reply(apiError(413, "payload_too_large", "Solicitud demasiado grande"), cors);
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return reply(apiError(422, "invalid_body", "El body debe ser JSON válido"), cors);
    }
    const parsed = siteRequestSchema.safeParse(json);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
        .join("; ");
      return reply(apiError(422, "invalid_body", detail), cors);
    }

    // 5. Honeypot: misma respuesta que el éxito, nada escrito.
    if (isHoneypotFilled(parsed.data)) {
      console.warn("[sito] richiesta scartata: honeypot");
      return reply(Response.json({ ok: true }, { status: 202 }), cors);
    }

    const result = await ingestSiteRequest(organizationId, toSiteRequest(parsed.data));
    if (!result.ok) {
      return reply(
        apiError(
          422,
          "phone_required",
          "Indica un número de teléfono con código de país para que podamos contactarte"
        ),
        cors
      );
    }
    return reply(Response.json({ ok: true }, { status: 202 }), cors);
  } catch (err) {
    // Solo el mensaje del error: nunca cabeceras (la clave) ni el body.
    console.error("[sito] errore non gestito:", err instanceof Error ? err.message : "error");
    return apiError(500, "internal", "Error interno");
  }
}
