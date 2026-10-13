import { apiError, parseBody } from "@/lib/api";
import { authenticateBot } from "@/server/bot/auth";
import { runTeamBroadcast, TeamBroadcastError } from "@/server/team-broadcast/service";
import {
  parseIdempotencyKey,
  teamBroadcastBody,
} from "@/server/team-broadcast/validation";

export const dynamic = "force-dynamic";

/**
 * 012 — Ronda del team (specs/custom-heili/012-ronda-team.md).
 *
 * Un generatore esterno (n8n, attività pianificata di Claude) manda le
 * priorità del giorno; il CRM le invia come modello approvato dal numero
 * dell'organizzazione della chiave `vbk_` SOLO ai numeri della lista del team
 * (Accesso riservato, 007). Il CRM non parla con Monday (Costituzione II).
 *
 * 400 idempotency_key_required · 409 no_team_list / team_too_large /
 * not_connected / reconnect_required / broadcast_in_progress · 422
 * invalid_body / template_not_found / template_not_approved /
 * template_params_mismatch · 429 rate_limited.
 */
export async function POST(req: Request) {
  const auth = await authenticateBot(req);
  if (auth instanceof Response) return auth;
  const { organizationId } = auth;

  const idempotencyKey = parseIdempotencyKey(req.headers.get("idempotency-key"));
  if (!idempotencyKey) {
    return apiError(
      400,
      "idempotency_key_required",
      "Header Idempotency-Key obbligatorio (1–128 caratteri A-Z a-z 0-9 . _ : -), es. ronda-2026-10-13"
    );
  }

  const body = await parseBody(req, teamBroadcastBody);
  if (!body.ok) return body.response;

  try {
    const result = await runTeamBroadcast({ organizationId, idempotencyKey, body: body.data });
    return Response.json(result);
  } catch (err) {
    if (err instanceof TeamBroadcastError) {
      const res = apiError(err.status, err.code, err.message);
      if (err.retryAfterSec) res.headers.set("retry-after", String(err.retryAfterSec));
      return res;
    }
    console.error(
      "[team-broadcast] errore non gestito:",
      err instanceof Error ? err.message : "sconosciuto"
    );
    return apiError(500, "internal", "Errore interno");
  }
}
