import { after } from "next/server";
import { apiError, withAuth } from "@/lib/api";
import { runAgentTurnNow } from "@/server/ai/pipeline";
import { prepareManualRetry } from "@/server/ai/manual-retry";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const RETRY_REFUSED = {
  ai_not_configured: "La IA no está configurada en esta instancia",
  agent_disabled: "El agente está apagado",
  not_retryable: "La conversación no está en pausa por un fallo del proveedor de IA",
  already_answered: "Alguien ya respondió después del último mensaje del cliente",
} as const;

/**
 * 009 (E1c) — «Riprova risposta IA» desde el panel del contacto. Mismo
 * permiso que reactivar la IA de una conversación (`PATCH
 * /api/conversations/[id]`): cualquier miembro. Solo para un handoff por
 * fallo del proveedor (`error`): lo reclama de forma atómica y lanza un turno
 * YA, después de responder (202). Repetido, sobre otro motivo o con una
 * respuesta ya enviada → 409; dentro de 30 s del anterior → 429.
 */
export const POST = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const result = await prepareManualRetry(session.organizationId, id);
  if (result.status !== "ok") {
    if (result.status === "not_found") {
      return apiError(404, "not_found", "Conversación no encontrada");
    }
    if (result.status === "cooldown") {
      return apiError(429, "retry_cooldown", "Espera unos segundos antes de reintentar otra vez");
    }
    return apiError(409, result.status, RETRY_REFUSED[result.status]);
  }
  after(() => runAgentTurnNow(id));
  return Response.json({ ok: true, conversation: result.conversation }, { status: 202 });
});
