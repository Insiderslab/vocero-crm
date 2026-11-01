import { z } from "zod";
import { parseBody, withAdminAuth } from "@/lib/api";
import { getListeningState, setListeningMode } from "@/server/listening/mode";

export const dynamic = "force-dynamic";

function body(state: { enabled: boolean; enabledAt: Date | null }) {
  return { enabled: state.enabled, enabledAt: state.enabledAt?.toISOString() ?? null };
}

/** 016 — Stato della modalità ascolto della organizzazione della sessione. Solo owner/admin. */
export const GET = withAdminAuth(async (session) =>
  Response.json(body(await getListeningState(session.organizationId)))
);

/** Nient'altro oltre a `enabled` (`.strict()`: campi in più → 422). */
const putSchema = z.object({ enabled: z.boolean() }).strict();

/** Accende o spegne la modalità ascolto; salva l'utente della sessione in `enabled_by`. */
export const PUT = withAdminAuth(async (session, req: Request) => {
  const parsed = await parseBody(req, putSchema);
  if (!parsed.ok) return parsed.response;
  const state = await setListeningMode(session.organizationId, parsed.data.enabled, session.userId);
  return Response.json(body(state));
});
