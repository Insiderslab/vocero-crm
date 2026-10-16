import { getEnv } from "@/lib/env";
import { graphRequest } from "@/lib/meta/client";
import {
  unsignedWebhookAllowed,
  webhookSecretMissingWarning,
} from "@/lib/dev-guard";
import type { ChannelAdapter } from "@/server/channels/types";
import { checkSignature, safeEqual } from "@/server/inbox/webhook";
import {
  recordInvalidSignature,
  recordVerifiedSignature,
} from "@/server/inbox/webhook-signature-stats";
import { downloadGraphMedia } from "@/server/whatsapp/media";
import { whatsappCapabilities } from "@/server/channels/whatsapp/capabilities";
import { parseWhatsappPayload } from "@/server/channels/whatsapp/parse";
import { sendWhatsapp, whatsappRecipient } from "@/server/channels/whatsapp/send";

/**
 * 005-livello-canali (M1.3, T027) — Adaptador de WhatsApp Cloud API detrás del
 * contrato (ADR §3.1), con el comportamiento de hoy:
 * - URL `/api/webhooks/wa/<META_WEBHOOK_VERIFY_TOKEN>` (slug `wa`, histórico);
 * - firma x-hub-signature-256 OBLIGATORIA (PR #9, D3): sin META_APP_SECRET el
 *   webhook responde 503 a todo, salvo el gate de pruebas; con secreto, firma
 *   ausente o errónea → 401 (contada en Configuración → WhatsApp);
 * - handshake GET de Meta con el verify token comparado en tiempo constante.
 */

const SECRET_WARNING_EVERY_MS = 60_000;
let lastSecretWarningAt = 0;

/**
 * 503 cuando la firma es obligatoria y no hay secreto. El aviso se registra
 * como mucho una vez por minuto (Meta reintenta y no debe inundar los logs) y
 * no contiene ningún valor secreto (ni el token de la URL ni el App Secret).
 */
function secretMissingResponse(appSecret: string | undefined): Response | null {
  const warning = webhookSecretMissingWarning(appSecret);
  if (!warning) return null;
  const now = Date.now();
  if (now - lastSecretWarningAt >= SECRET_WARNING_EVERY_MS) {
    lastSecretWarningAt = now;
    console.error(warning);
  }
  return new Response(null, { status: 503 });
}

export const whatsappAdapter: ChannelAdapter = {
  channel: "whatsapp",
  webhookSlug: "wa",
  capabilities: whatsappCapabilities,

  webhook: {
    expectedToken: () => getEnv().META_WEBHOOK_VERIFY_TOKEN,

    // Sin secreto no se completa ni la suscripción (GET) ni se ingiere nada
    // (POST): el fallo se ve al configurar el webhook en Meta.
    unavailable: () => secretMissingResponse(getEnv().META_APP_SECRET),

    handshake(query) {
      const env = getEnv();
      const mode = query.get("hub.mode");
      const token = query.get("hub.verify_token");
      const challenge = query.get("hub.challenge");
      // Comparación en tiempo constante, como el segmento de la URL: el verify
      // token es el mismo secreto.
      if (mode === "subscribe" && token !== null && safeEqual(token, env.META_WEBHOOK_VERIFY_TOKEN)) {
        return new Response(challenge ?? "", { status: 200 });
      }
      return new Response(null, { status: 403 });
    },

    verifySignature(rawBody, headers) {
      const env = getEnv();
      const signatureHeader = headers.get("x-hub-signature-256");
      const check = checkSignature(
        rawBody,
        signatureHeader,
        env.META_APP_SECRET,
        unsignedWebhookAllowed()
      );
      // `secret_missing` no llega aquí: `unavailable()` ya respondió 503.
      if (!check.ok && check.reason === "secret_missing") return false;
      if (!check.ok) {
        // Antes era un 401 mudo: con el secreto equivocado TODO se perdía sin
        // rastro. Log limitado (1/min, sin cabecera ni secreto) + contadores.
        recordInvalidSignature({
          headerPresent: signatureHeader !== null,
          bytes: typeof rawBody === "string" ? Buffer.byteLength(rawBody) : rawBody.byteLength,
        });
        return false;
      }
      // Solo cuenta como «verificada» si de verdad se comprobó una firma (no
      // el gate de pruebas sin secreto).
      if (env.META_APP_SECRET) recordVerifiedSignature();
      return true;
    },

    parse: parseWhatsappPayload,
  },

  recipientFor: (identity) => whatsappRecipient(identity),

  send: (ctx, message) => sendWhatsapp(ctx, message),

  async fetchMedia(ctx, ref) {
    if (!("externalMediaId" in ref)) {
      throw new Error("WhatsApp: los adjuntos se descargan por media id, no por URL");
    }
    const { data, mimeType } = await downloadGraphMedia(ctx.secret ?? "", ref.externalMediaId, {
      organizationId: ctx.organizationId,
    });
    return { data, mimeType: mimeType ?? "application/octet-stream" };
  },

  async markReadAndTyping(ctx, lastInboundExternalId) {
    await graphRequest(`${ctx.account.externalAccountId}/messages`, {
      method: "POST",
      token: ctx.secret ?? "",
      organizationId: ctx.organizationId,
      body: {
        messaging_product: "whatsapp",
        status: "read",
        message_id: lastInboundExternalId,
        typing_indicator: { type: "text" },
      },
    });
  },

  async checkHealth(ctx) {
    // Sin llamadas a Meta: el estado lo marca el envío (190 → reconnect_required).
    return { status: ctx.account.status };
  },
};
