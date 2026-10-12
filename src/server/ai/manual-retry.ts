import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { isAiConfigured } from "@/lib/env";
import { publish } from "@/server/events/bus";
import { answeredSinceLastInbound } from "@/server/ai/failure";
import { cancelAgentRetry } from "@/server/ai/pipeline";
import {
  getConversation,
  MESSAGE_CHRONOLOGY_DESC,
  serializeConversation,
  type ConversationDto,
} from "@/server/inbox/queries";

export type ManualRetryResult =
  | { status: "ok"; conversation: ConversationDto }
  | {
      status:
        | "not_found"
        | "ai_not_configured"
        | "agent_disabled"
        | "not_retryable"
        | "already_answered"
        | "cooldown";
    };

/** Entre dos «Riprova» de la misma conversación (doble clic, insistencia). */
export const MANUAL_RETRY_COOLDOWN_MS = 30_000;

const globalForRetry = globalThis as unknown as { __manualRetryAt?: Map<string, number> };
function lastRetries(): Map<string, number> {
  return (globalForRetry.__manualRetryAt ??= new Map());
}

/**
 * 009 (E1c) — Preparación de «Riprova risposta IA». Solo para lo que el
 * botón promete: una conversación pasada a una persona POR UN FALLO DEL
 * PROVEEDOR (`handoff_reason = 'error'`, también con un segundo intento
 * pendiente). Comprueba, en orden:
 * - que el agente puede responder (IA configurada, agente encendido);
 * - que nadie haya contestado ya después del último entrante (salvo la
 *   cortesía automática) — si no, la IA hablaría encima de una persona;
 * - una pausa de 30 s entre reintentos de la misma conversación;
 * y entonces RECLAMA la conversación de forma atómica (`UPDATE … WHERE
 * handoff_reason = 'error' RETURNING`): dos clics, dos pestañas o dos
 * personas → solo uno lanza el turno; el resto recibe 409.
 *
 * Nada cambia si la respuesta no es `ok`.
 */
export async function prepareManualRetry(
  organizationId: string,
  conversationId: string,
  now: number = Date.now()
): Promise<ManualRetryResult> {
  const row = await getConversation(organizationId, conversationId);
  // El Laboratorio no vive en la bandeja.
  if (!row || row.conversation.isTest) return { status: "not_found" };
  if (!isAiConfigured()) return { status: "ai_not_configured" };

  const db = getDb();
  const profiles = await db
    .select({ enabled: schema.agentProfile.enabled, errorReply: schema.agentProfile.errorReply })
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  if (!profiles[0]?.enabled) return { status: "agent_disabled" };

  if (row.conversation.handoffReason !== "error") return { status: "not_retryable" };

  const recent = await db
    .select({ direction: schema.message.direction, text: schema.message.text })
    .from(schema.message)
    .where(
      and(
        eq(schema.message.organizationId, organizationId),
        eq(schema.message.conversationId, conversationId)
      )
    )
    .orderBy(...MESSAGE_CHRONOLOGY_DESC)
    .limit(50);
  if (answeredSinceLastInbound(recent, profiles[0].errorReply)) {
    return { status: "already_answered" };
  }

  const last = lastRetries().get(conversationId);
  if (last !== undefined && now - last < MANUAL_RETRY_COOLDOWN_MS) return { status: "cooldown" };

  if (!(await claimManualRetry(organizationId, conversationId))) {
    return { status: "not_retryable" };
  }
  lastRetries().set(conversationId, now);
  cancelAgentRetry(conversationId);

  const fresh = await getConversation(organizationId, conversationId);
  if (!fresh) return { status: "not_found" };
  const dto = serializeConversation(fresh.conversation, fresh.contact);
  publish(organizationId, {
    type: "conversation.updated",
    data: { conversation: dto },
  });
  return { status: "ok", conversation: dto };
}

/**
 * El reclamo atómico: solo una petición pasa una conversación en handoff
 * `error` a «la IA responde». Las demás (doble clic, otra pestaña, otra
 * persona) reciben `false`.
 */
export async function claimManualRetry(
  organizationId: string,
  conversationId: string
): Promise<boolean> {
  const claimed = await getDb()
    .update(schema.conversation)
    .set({
      handoffAt: null,
      handoffReason: null,
      agentRetryAt: null,
      aiEnabled: true,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.conversation.id, conversationId),
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.handoffReason, "error")
      )
    )
    .returning({ id: schema.conversation.id });
  return Boolean(claimed[0]);
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
