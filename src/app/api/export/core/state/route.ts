import { withExport } from "@/server/export/handler";
import { FEED_SCHEMA } from "@/server/listening/feed";
import { getListeningState } from "@/server/listening/mode";

export const dynamic = "force-dynamic";

/**
 * 016 — Stato per Heili Core (`orbit.core-feed/v1`). Il Core lo legge a ogni
 * pull: se l'organizzazione non è quella attesa per lo spazio, o se
 * `listening.enabled` è falso mentre lo spazio è in ascolto, si ferma.
 * L'organizzazione sale SEMPRE dalla chiave `vex_`.
 */
export const GET = withExport(async (org) => {
  const state = await getListeningState(org.id);
  return Response.json({
    schema: FEED_SCHEMA,
    organizationId: org.id,
    organizationSlug: org.slug,
    listening: { enabled: state.enabled, enabledAt: state.enabledAt?.toISOString() ?? null },
    serverTime: new Date().toISOString(),
  });
});
