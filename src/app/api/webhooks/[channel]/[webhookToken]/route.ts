import { handleChannelWebhook } from "@/server/channels/core/webhook";

/**
 * Webhooks públicos de los canales: `/api/webhooks/<canal>/<token>`
 * (005-livello-canali, ADR §3.5). El slug `wa` sirve EXACTAMENTE la URL de
 * siempre (`/api/webhooks/wa/<META_WEBHOOK_VERIFY_TOKEN>`, configurada en Meta
 * y en el `override_callback_uri` de Wapi). Slug desconocido → 404.
 *
 * Todo el orden de controles (slug → token → configuración → tope → firma →
 * JSON → 200 + after) está en el núcleo (`handleChannelWebhook`), igual para
 * cada canal; aquí solo se pasa el slug.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ channel: string; webhookToken: string }> };

export async function GET(req: Request, { params }: Params) {
  return handleChannelWebhook(req, await params);
}

export async function POST(req: Request, { params }: Params) {
  return handleChannelWebhook(req, await params);
}
