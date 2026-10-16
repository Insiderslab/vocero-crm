import { headers } from "next/headers";
import { withAdminAuth } from "@/lib/api";
import { getAuth } from "@/lib/auth";
import { isUnusuallyQuiet, type WebhookRouteCheckResponse } from "@/lib/webhook-route";
import { isSuperadminEmail } from "@/server/auth/superadmin";
import { checkWebhookRoute, inboundStats } from "@/server/whatsapp/webhook-route";

export const dynamic = "force-dynamic";

/** Con `?refresh=1` si ricontrolla da Meta, ma non più di una volta ogni 30 s. */
const REFRESH_MIN_AGE_MS = 30_000;

/**
 * 014 — Guardia del webhook: Meta manda gli eventi del numero al CRM? E il
 * silenzio di adesso è normale? Solo owner/admin. Niente segreti: dell'
 * indirizzo estraneo solo l'host, del nostro niente.
 */
export const GET = withAdminAuth(async (session, req: Request) => {
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  const [route, stats, authSession] = await Promise.all([
    checkWebhookRoute(session.organizationId, refresh ? { maxAgeMs: REFRESH_MIN_AGE_MS } : {}),
    inboundStats(session.organizationId),
    // Dentro una funzione async: se `headers()` lancia, è un rifiuto gestito
    // da Promise.all e non lascia le altre due promesse senza gestore.
    (async () => getAuth().api.getSession({ headers: await headers() }))(),
  ]);
  const body: WebhookRouteCheckResponse = {
    route,
    quiet: route !== null && isUnusuallyQuiet(stats),
    lastInboundAt: stats.lastInboundAt,
    canRestore: isSuperadminEmail(authSession?.user.email),
  };
  return Response.json(body);
});
