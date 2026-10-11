import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { isAiConfigured } from "@/lib/env";
import { publish } from "@/server/events/bus";
import {
  getConversation,
  serializeConversation,
  updateConversation,
  type ConversationDto,
} from "@/server/inbox/queries";

export type ManualRetryResult =
  | { status: "ok"; conversation: ConversationDto }
  | { status: "not_found" | "ai_not_configured" | "agent_disabled" };

/**
 * 009 (E1c) — Preparación de «Riprova risposta IA»: comprueba que el agente
 * PUEDE responder y, solo entonces, quita el handoff y reactiva la IA de la
 * conversación (lo mismo que «Riattiva IA»). El turno lo lanza quien llama
 * (`runAgentTurnNow`), después de responder al navegador.
 *
 * Nada cambia si la respuesta no es `ok`: quitar el handoff sin un agente que
 * conteste dejaría al cliente sin nadie, que es justo lo que E1 corrige.
 */
export async function prepareManualRetry(
  organizationId: string,
  conversationId: string
): Promise<ManualRetryResult> {
  const row = await getConversation(organizationId, conversationId);
  // El Laboratorio no vive en la bandeja.
  if (!row || row.conversation.isTest) return { status: "not_found" };
  if (!isAiConfigured()) return { status: "ai_not_configured" };

  const profiles = await getDb()
    .select({ enabled: schema.agentProfile.enabled })
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  if (!profiles[0]?.enabled) return { status: "agent_disabled" };

  await updateConversation(organizationId, conversationId, { reactivate: true });
  const fresh = await getConversation(organizationId, conversationId);
  if (!fresh) return { status: "not_found" };
  const dto = serializeConversation(fresh.conversation, fresh.contact);
  publish(organizationId, {
    type: "conversation.updated",
    data: { conversation: dto },
  });
  return { status: "ok", conversation: dto };
}

/** Para pruebas: ¿la conversación sigue con handoff? */
export async function handoffOf(
  conversationId: string
): Promise<{ handoffAt: Date | null; handoffReason: string | null } | null> {
  const rows = await getDb()
    .select({
      handoffAt: schema.conversation.handoffAt,
      handoffReason: schema.conversation.handoffReason,
    })
    .from(schema.conversation)
    .where(eq(schema.conversation.id, conversationId))
    .limit(1);
  return rows[0] ?? null;
}
