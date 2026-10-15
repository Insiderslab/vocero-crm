import { withAdminAuth } from "@/lib/api";
import { getWhatsappGuideStatus } from "@/server/whatsapp/guide-status";

export const dynamic = "force-dynamic";

/**
 * 013 — Stato per la pagina guidata (striscia in alto e tre passi). Solo
 * owner/admin, come il resto della connessione WhatsApp. Senza segreti.
 */
export const GET = withAdminAuth(async (session) => {
  return Response.json(await getWhatsappGuideStatus(session.organizationId));
});
