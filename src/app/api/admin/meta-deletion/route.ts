import { withSuperadmin } from "@/server/auth/superadmin";
import { listDeletionRequests } from "@/server/meta/data-deletion";

export const dynamic = "force-dynamic";

/**
 * 015 — /admin → «Richieste di cancellazione Meta»: elenco per chi le
 * gestisce (solo super-admin). Contiene l'ID utente Meta: serve per trovare a
 * mano i dati da cancellare, quindi mai fuori da questa rotta.
 */
export const GET = withSuperadmin(async () => {
  return Response.json({ requests: await listDeletionRequests() });
});
