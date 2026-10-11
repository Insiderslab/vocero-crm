import { after } from "next/server";
import { apiError, withAuth } from "@/lib/api";
import { runAgentTurnNow } from "@/server/ai/pipeline";
import { prepareManualRetry } from "@/server/ai/manual-retry";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * 009 (E1c) — «Riprova risposta IA» desde el panel del contacto. Mismo
 * permiso que reactivar la IA de una conversación (`PATCH
 * /api/conversations/[id]`): cualquier miembro. Quita el handoff y lanza un
 * turno YA, después de responder (202): el turno puede tardar lo que tarde el
 * proveedor y el resultado llega por SSE como cualquier mensaje.
 */
export const POST = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const result = await prepareManualRetry(session.organizationId, id);
  if (result.status !== "ok") {
    if (result.status === "not_found") {
      return apiError(404, "not_found", "Conversación no encontrada");
    }
    return apiError(
      409,
      result.status,
      result.status === "ai_not_configured"
        ? "La IA no está configurada en esta instancia"
        : "El agente está apagado"
    );
  }
  after(() => runAgentTurnNow(id));
  return Response.json({ ok: true, conversation: result.conversation }, { status: 202 });
});
