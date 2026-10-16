import { apiError } from "@/lib/api";
import { withSuperadmin } from "@/server/auth/superadmin";
import { restoreAppWebhook } from "@/server/whatsapp/webhook-route";

export const dynamic = "force-dynamic";

/**
 * 014 — Rimette il CRM come callback WhatsApp dell'app Meta della
 * piattaforma (lo stesso di `ripristina-webhook.sh`). Solo super-admin:
 * l'app è una per istanza e il cambio vale per tutte le organizzazioni.
 * Usa l'App Secret dell'ambiente lato server; la risposta non lo contiene.
 */
export const POST = withSuperadmin(async () => {
  const r = await restoreAppWebhook();
  if (r.ok) return Response.json({ ok: true });
  const status = r.code === "meta_rejected" ? 502 : 409;
  // Il codice decide il testo nell'interfaccia; il messaggio di Meta (ripulito) solo con meta_rejected.
  return apiError(status, r.code, r.message ?? "");
});
