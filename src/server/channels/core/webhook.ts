import { after } from "next/server";
import { isValidWebhookToken, readBodyCapped } from "@/server/inbox/webhook";
import { processInboundEvents } from "@/server/channels/core/ingest";
import { channelRegistry, type ChannelLookup } from "@/server/channels/registry";

/**
 * 005-livello-canali (M1.3, T029) — Gestor ÚNICO de los webhooks de canal
 * (ADR §3.5). El orden de los controles es el mismo para todos los canales y
 * calca la ruta `wa` de hoy (con PR #9):
 *
 *   1. slug → adaptador; desconocido → 404 (sin leer el body);
 *   2. token del segmento, en tiempo constante; erróneo → 404 sin leer el body;
 *   3. configuración del canal (`unavailable`, p. ej. 503 sin META_APP_SECRET);
 *   4. body crudo con tope de 5 MB (413) ANTES del HMAC;
 *   5. firma sobre los bytes crudos → 401;
 *   6. JSON protegido: ilegible → 200 sin efectos (Meta reintenta y desactiva);
 *   7. 200 `{"received":true}` y el trabajo en `after()`: parse → eventos en orden.
 *
 * `lookup` es inyectable para los tests (adaptador falso); la app usa el registro.
 */

/**
 * Punto de entrada de la route `[channel]/[webhookToken]` (GET y POST): el
 * inventario de rutas (`tests/unit/helpers/route-roles.ts`) exige que la route
 * lo llame. El token se valida con `isValidWebhookToken` (vacío = inválido).
 */
export async function handleChannelWebhook(
  req: Request,
  params: { channel: string; webhookToken: string },
  lookup: ChannelLookup = channelRegistry
): Promise<Response> {
  return req.method === "GET"
    ? handleChannelWebhookGet(params.channel, params.webhookToken, req, lookup)
    : handleChannelWebhookPost(params.channel, params.webhookToken, req, lookup);
}

export async function handleChannelWebhookGet(
  slug: string,
  webhookToken: string,
  req: Request,
  lookup: ChannelLookup = channelRegistry
): Promise<Response> {
  const registration = lookup.bySlug(slug);
  if (!registration) return new Response(null, { status: 404 });
  const { adapter } = registration;
  if (!isValidWebhookToken(webhookToken, adapter.webhook.expectedToken())) {
    return new Response(null, { status: 404 });
  }
  const unavailable = adapter.webhook.unavailable?.();
  if (unavailable) return unavailable;
  if (!adapter.webhook.handshake) return new Response(null, { status: 405 });
  return adapter.webhook.handshake(new URL(req.url).searchParams);
}

export async function handleChannelWebhookPost(
  slug: string,
  webhookToken: string,
  req: Request,
  lookup: ChannelLookup = channelRegistry
): Promise<Response> {
  const registration = lookup.bySlug(slug);
  if (!registration) return new Response(null, { status: 404 });
  const { adapter } = registration;
  if (!isValidWebhookToken(webhookToken, adapter.webhook.expectedToken())) {
    return new Response(null, { status: 404 });
  }
  const unavailable = adapter.webhook.unavailable?.();
  if (unavailable) return unavailable;

  // Bytes crudos con tope (413) ANTES del HMAC; la firma se calcula sobre
  // esos bytes y solo después se decodifican como UTF-8 (sin BOM) para el JSON.
  const rawBody = await readBodyCapped(req);
  if (!rawBody) return new Response(null, { status: 413 });
  if (!adapter.webhook.verifySignature(rawBody, req.headers)) {
    return new Response(null, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder("utf-8").decode(rawBody));
  } catch {
    // body ilegible: 200 igualmente (Meta reintenta y termina desactivando)
    return Response.json({ received: true });
  }

  after(async () => {
    try {
      await processInboundEvents(registration, adapter.webhook.parse(payload));
    } catch (err) {
      console.error("[webhook] error procesando payload:", err);
    }
  });

  return Response.json({ received: true });
}
