import { after } from "next/server";
import { getEnv } from "@/lib/env";
import {
  unsignedWebhookAllowed,
  webhookSecretMissingWarning,
} from "@/lib/dev-guard";
import {
  checkSignature,
  isValidWebhookToken,
  type WebhookPayload,
} from "@/server/inbox/webhook";
import { processEchoesValue, processMessagesValue } from "@/server/inbox/ingest";
import { processTemplateStatusValue } from "@/server/whatsapp/template-events";
import {
  processAccountUpdateValue,
  processHistoryValue,
  processStateSyncValue,
} from "@/server/inbox/coexistence";

/**
 * Webhook público de WhatsApp (contrato webhook.md).
 * Capa 1: el segmento [webhookToken] debe coincidir (si no → 404 sin efectos).
 * Capa 2: firma x-hub-signature-256 OBLIGATORIA (fail-closed). Sin
 * META_APP_SECRET el webhook responde 503 a todo (GET y POST) y lo registra;
 * con secreto, una firma ausente o errónea → 401. La única excepción es el
 * gate de pruebas (`unsignedWebhookAllowed`, cerrado en producción).
 * El POST siempre responde 200 tras validar; el procesamiento va en after().
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ webhookToken: string }> };

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

export async function GET(req: Request, { params }: Params) {
  const { webhookToken } = await params;
  const env = getEnv();
  if (!isValidWebhookToken(webhookToken, env.META_WEBHOOK_VERIFY_TOKEN)) {
    return new Response(null, { status: 404 });
  }
  // Sin secreto no se completa ni la suscripción: el fallo se ve al configurar
  // el webhook en Meta, no días después con mensajes perdidos.
  const missing = secretMissingResponse(env.META_APP_SECRET);
  if (missing) return missing;

  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === env.META_WEBHOOK_VERIFY_TOKEN) {
    return new Response(challenge ?? "", { status: 200 });
  }
  return new Response(null, { status: 403 });
}

export async function POST(req: Request, { params }: Params) {
  const { webhookToken } = await params;
  const env = getEnv();
  if (!isValidWebhookToken(webhookToken, env.META_WEBHOOK_VERIFY_TOKEN)) {
    return new Response(null, { status: 404 });
  }
  const missing = secretMissingResponse(env.META_APP_SECRET);
  if (missing) return missing;

  const rawBody = await req.text();
  const check = checkSignature(
    rawBody,
    req.headers.get("x-hub-signature-256"),
    env.META_APP_SECRET,
    unsignedWebhookAllowed()
  );
  if (!check.ok) {
    // `secret_missing` ya se respondió arriba; aquí solo queda firma inválida.
    return new Response(null, { status: check.reason === "secret_missing" ? 503 : 401 });
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WebhookPayload;
  } catch {
    // body ilegible: 200 igualmente (Meta reintenta y termina desactivando)
    return Response.json({ received: true });
  }

  after(async () => {
    try {
      await processPayload(payload);
    } catch (err) {
      console.error("[webhook] error procesando payload:", err);
    }
  });

  return Response.json({ received: true });
}

async function processPayload(payload: WebhookPayload): Promise<void> {
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (!change.value) continue;
      if (change.field === "messages") {
        await processMessagesValue(change.value);
      } else if (change.field === "smb_message_echoes") {
        // 008: mensajes enviados a mano desde la app del teléfono (coexistence)
        await processEchoesValue(change.value);
      } else if (change.field === "message_template_status_update") {
        await processTemplateStatusValue(entry.id ?? null, change.value);
      } else if (change.field === "history") {
        // 009: chats pasados de la app del teléfono (coexistence)
        await processHistoryValue(change.value);
      } else if (change.field === "smb_app_state_sync") {
        // 009: agenda de la app del teléfono (coexistence)
        await processStateSyncValue(change.value);
      } else if (change.field === "account_update") {
        // 009: corte/reconexión de la coexistence
        await processAccountUpdateValue(entry.id ?? null, change.value);
      }
      // otros fields: ignorar sin error
    }
  }
}
