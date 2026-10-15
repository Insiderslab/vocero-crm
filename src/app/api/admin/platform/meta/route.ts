import { parseBody } from "@/lib/api";
import { withSuperadmin } from "@/server/auth/superadmin";
import {
  getMetaPlatformStatus,
  metaPlatformInput,
  saveMetaPlatformIds,
} from "@/server/platform/meta-config";

export const dynamic = "force-dynamic";

/**
 * 013 — /admin → Piattaforma → Meta. Solo super-admin (non un ruolo di
 * organizzazione: owner/admin/member di qualunque azienda ricevono 403).
 * App ID e Configuration ID dell'Embedded Signup NON sono segreti; dell'App
 * Secret la risposta dice solo se c'è e come vanno le firme, mai il valore.
 */
export const GET = withSuperadmin(async () => {
  return Response.json(await getMetaPlatformStatus());
});

/** Salva (o cancella, con vuoto/null) i due ID. Solo cifre, da 6 a 25. */
export const PUT = withSuperadmin(async (ctx, req: Request) => {
  const body = await parseBody(req, metaPlatformInput);
  if (!body.ok) return body.response;
  await saveMetaPlatformIds(body.data, ctx.userId);
  return Response.json(await getMetaPlatformStatus());
});
