import { and, asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { moveLeadToStage as moveLeadThroughHistory } from "@/server/leads/stage-history";
import { getEnv, isAiConfigured } from "@/lib/env";
import { chatJson, type ChatMessage } from "@/lib/ai";
import { publish } from "@/server/events/bus";
import { isWindowOpen } from "@/server/inbox/window";
import { SendError, sendText } from "@/server/inbox/send";
import { AgentAction, degradeAction, resolveStage, type AgentActionType } from "@/server/ai/actions";
import { matchesHandoffIntent } from "@/server/ai/handoff";
import { buildAgentSystemPrompt } from "@/server/ai/prompts";
import { isAllowedIdentity } from "@/server/ai/allowlist";

/**
 * Turno del agente (FR-021..FR-025).
 *
 * Coalesce + lock in-process por conversación: ráfagas de mensajes → UNA
 * respuesta; nunca dos turnos simultáneos; lo que llega durante un turno
 * re-encola exactamente un turno más. Suficiente para el monolito de una
 * instancia (sin colas externas — Constitución II).
 */

type CoalesceEntry = {
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  pending: boolean;
};

const globalForAgent = globalThis as unknown as {
  __agentCoalesce?: Map<string, CoalesceEntry>;
};

function coalesceMap(): Map<string, CoalesceEntry> {
  if (!globalForAgent.__agentCoalesce) {
    globalForAgent.__agentCoalesce = new Map();
  }
  return globalForAgent.__agentCoalesce;
}

/** Punto de entrada con debounce (mensajes entrantes reales). */
export function scheduleAgentTurn(conversationId: string): void {
  const map = coalesceMap();
  const entry = map.get(conversationId) ?? {
    timer: null,
    running: false,
    pending: false,
  };
  map.set(conversationId, entry);

  if (entry.running) {
    entry.pending = true; // se re-encola al terminar el turno actual
    return;
  }
  if (entry.timer) clearTimeout(entry.timer);
  const delay = getEnv().AGENT_COALESCE_MS;
  entry.timer = setTimeout(() => {
    entry.timer = null;
    void executeTurn(conversationId);
  }, delay);
}

async function executeTurn(conversationId: string): Promise<void> {
  const map = coalesceMap();
  const entry = map.get(conversationId);
  if (!entry || entry.running) return;
  entry.running = true;
  try {
    await runAgentTurn(conversationId);
  } catch (err) {
    console.error("[agente] turno falló:", err);
  } finally {
    entry.running = false;
    if (entry.pending) {
      entry.pending = false;
      void executeTurn(conversationId);
    } else {
      map.delete(conversationId);
    }
  }
}

/**
 * Ejecuta UN turno del agente ahora (el Laboratorio lo llama directo, con
 * debounce 0 y sin pasar por el coalesce).
 */
export async function runAgentTurn(conversationId: string): Promise<void> {
  if (!isAiConfigured()) return;

  const db = getDb();
  const convRows = await db
    .select()
    .from(schema.conversation)
    .where(eq(schema.conversation.id, conversationId))
    .limit(1);
  const conversation = convRows[0];
  if (!conversation) return;
  const organizationId = conversation.organizationId;

  // Condiciones de silencio: handoff activo o IA apagada en la conversación.
  if (conversation.handoffAt || !conversation.aiEnabled) return;

  const profileRows = await db
    .select()
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  const profile = profileRows[0];
  if (!profile) return;
  // El toggle global aplica a conversaciones reales; el Laboratorio evalúa el
  // comportamiento configurado aunque el agente aún no esté encendido.
  if (!conversation.isTest && !profile.enabled) return;

  // 007 — Acceso reservado (asistente interno): con la restricción
  // encendida, un contacto fuera de la lista NO llega al modelo ni al KB (ni
  // siquiera se leen). Como mucho recibe la respuesta fija, una vez. El
  // Laboratorio no la aplica: evalúa el comportamiento configurado.
  if (!conversation.isTest && profile.restrictToAllowlist) {
    const contactRows = await db
      .select({ waIdentity: schema.contact.waIdentity, phone: schema.contact.phone })
      .from(schema.contact)
      .where(
        scoped(
          schema.contact.organizationId,
          organizationId,
          eq(schema.contact.id, conversation.contactId)
        )
      )
      .limit(1);
    const contact = contactRows[0];
    if (!contact || !isAllowedIdentity(profile, contact.waIdentity, contact.phone)) {
      await replyToOutsider(conversation, profile.outsiderReply);
      return;
    }
  }

  const history = await db
    .select()
    .from(schema.message)
    .where(eq(schema.message.conversationId, conversationId))
    .orderBy(desc(schema.message.createdAt))
    .limit(20);
  history.reverse();
  // 008 — Una solicitud del formulario del sitio (`channel = web`) NO es un
  // mensaje de WhatsApp: no abre la ventana de 24 h y el agente jamás le
  // contesta por WhatsApp (la responde el equipo a mano). Se busca el último
  // entrante de WhatsApp; si solo hay solicitudes web, no hay turno (ni
  // handoff "ventana": la conversación queda como está para el equipo).
  const lastInbound = [...history]
    .reverse()
    .find((m) => m.direction === "in" && m.channel !== "web");
  if (!lastInbound) return;

  // Ventana cerrada: el agente JAMÁS envía texto libre → handoff 'ventana'.
  if (!conversation.isTest && !isWindowOpen(conversation.lastInboundAt)) {
    await applyHandoff(conversationId, organizationId, "ventana");
    return;
  }

  // Patrón de respaldo ANTES del LLM (FR-022).
  if (lastInbound.text && matchesHandoffIntent(lastInbound.text)) {
    await applyHandoff(conversationId, organizationId, "cliente");
    return;
  }

  const kb = await db
    .select()
    .from(schema.kbEntry)
    .where(eq(schema.kbEntry.organizationId, organizationId))
    .orderBy(asc(schema.kbEntry.createdAt));
  const stages = await db
    .select({ id: schema.pipelineStage.id, name: schema.pipelineStage.name })
    .from(schema.pipelineStage)
    .where(eq(schema.pipelineStage.organizationId, organizationId))
    .orderBy(asc(schema.pipelineStage.position));

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: buildAgentSystemPrompt({ profile, kb, stages }),
    },
    ...history
      // 008: las solicitudes web las atiende el equipo; no van al proveedor
      // de IA (traen email, página y campos del formulario).
      .filter((m) => m.text && m.channel !== "web")
      .map((m) => ({
        role: m.direction === "in" ? ("user" as const) : ("assistant" as const),
        content: m.text!,
      })),
  ];

  const result = await chatJson(AgentAction, messages);
  if (!result.ok) {
    if (result.error === "not_configured") return;
    // Fallo persistente del proveedor o salida imposible → escalar (FR-022).
    console.error(`[agente] fallo del proveedor (raw): ${result.detail}`);
    await applyHandoff(conversationId, organizationId, "error");
    return;
  }

  let action: AgentActionType = result.data;

  if (action.action === "move_stage") {
    const stage = resolveStage(action.stage, stages);
    if (!stage) {
      action = degradeAction(action);
    } else {
      await moveLeadToStage(organizationId, conversation.contactId, stage.id);
      publish(organizationId, {
        type: "conversation.updated",
        data: { conversation: { id: conversationId } },
      });
      if (action.reply) {
        await deliverReply(conversation, action.reply);
      }
      return;
    }
  }

  switch (action.action) {
    case "none":
      return;
    case "reply":
      await deliverReply(conversation, action.text);
      return;
    case "update_lead": {
      await appendLeadNote(organizationId, conversation.contactId, action.note);
      if (action.reply) await deliverReply(conversation, action.reply);
      return;
    }
    case "handoff": {
      if (action.farewell) {
        await deliverReply(conversation, action.farewell);
      }
      await applyHandoff(conversationId, organizationId, "modelo");
      return;
    }
  }
}

type Conversation = typeof schema.conversation.$inferSelect;

/** Entrega la respuesta: envío real o persistencia sandbox (is_test). */
async function deliverReply(
  conversation: Conversation,
  text: string
): Promise<void> {
  if (conversation.isTest) {
    await persistTestOutbound(conversation, text);
    return;
  }
  try {
    await sendText({
      conversationId: conversation.id,
      organizationId: conversation.organizationId,
      text,
      aiGenerated: true,
    });
  } catch (err) {
    if (err instanceof SendError && err.code === "window_closed") {
      await applyHandoff(conversation.id, conversation.organizationId, "ventana");
      return;
    }
    throw err;
  }
}

/**
 * 007 — Respuesta fija a quien no está en la lista. Una vez por conversación:
 * si ya hay un saliente con ese texto exacto, no se reenvía. Va por el envío
 * normal (`sendText`: ventana de 24 h, sandbox, credenciales); si el envío no
 * es posible se registra y el turno termina sin handoff ni reintento.
 * `aiGenerated`: es un mensaje automático del asistente, no de una persona.
 */
async function replyToOutsider(
  conversation: Conversation,
  text: string | null
): Promise<void> {
  if (!text?.trim()) return;
  const db = getDb();
  const already = await db
    .select({ id: schema.message.id })
    .from(schema.message)
    .where(
      and(
        eq(schema.message.organizationId, conversation.organizationId),
        eq(schema.message.conversationId, conversation.id),
        eq(schema.message.direction, "out"),
        eq(schema.message.text, text)
      )
    )
    .limit(1);
  if (already[0]) return;
  try {
    await sendText({
      conversationId: conversation.id,
      organizationId: conversation.organizationId,
      text,
      aiGenerated: true,
    });
  } catch (err) {
    if (err instanceof SendError) {
      console.warn(
        `[agente] respuesta a externo no enviada (${err.code}) en ${conversation.id}`
      );
      return;
    }
    throw err;
  }
}

/** Mensaje saliente del sandbox: se persiste, JAMÁS toca la API (FR-031). */
async function persistTestOutbound(
  conversation: Conversation,
  text: string
): Promise<void> {
  const db = getDb();
  await db.insert(schema.message).values({
    id: newId("message"),
    organizationId: conversation.organizationId,
    conversationId: conversation.id,
    direction: "out",
    type: "text",
    text,
    status: "sent",
    aiGenerated: true,
    origin: "ai",
  });
  await db
    .update(schema.conversation)
    .set({ lastMessageAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.conversation.id, conversation.id));
}

export async function applyHandoff(
  conversationId: string,
  organizationId: string,
  reason: "cliente" | "modelo" | "error" | "ventana"
): Promise<void> {
  const db = getDb();
  const updated = await db
    .update(schema.conversation)
    .set({ handoffAt: new Date(), handoffReason: reason, updatedAt: new Date() })
    .where(eq(schema.conversation.id, conversationId))
    .returning();
  if (!updated[0]) return;
  publish(organizationId, {
    type: "conversation.updated",
    data: {
      conversation: { id: conversationId, handoffReason: reason },
    },
  });
}

async function moveLeadToStage(
  organizationId: string,
  contactId: string,
  stageId: string
): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.lead.id })
    .from(schema.lead)
    .where(
      scoped(
        schema.lead.organizationId,
        organizationId,
        eq(schema.lead.contactId, contactId)
      )
    )
    .limit(1);
  const leadId = rows[0]?.id;
  if (!leadId) return;

  // Por la puerta única: el agente mueve tarjetas igual que el dueño, y su
  // movimiento tiene que quedar en la bitácora o el embudo mentirá sobre
  // quién hizo avanzar cada lead.
  await moveLeadThroughHistory({
    organizationId,
    leadId,
    toStageId: stageId,
    source: "bot",
    extra: { lastActivityAt: new Date() },
    // El agente no clasifica pérdidas: si su etapa destino resultara ser la
    // perdida, la puerta lo rechaza y el lead se queda donde está — mejor eso
    // que un motivo inventado.
  });
}

async function appendLeadNote(
  organizationId: string,
  contactId: string,
  note: string
): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.contact.id, notes: schema.contact.notes })
    .from(schema.contact)
    .where(eq(schema.contact.id, contactId))
    .limit(1);
  const contact = rows[0];
  if (!contact) return;
  const stamped = `[IA] ${note}`;
  await db
    .update(schema.contact)
    .set({
      notes: contact.notes ? `${contact.notes}\n${stamped}` : stamped,
      updatedAt: new Date(),
    })
    .where(eq(schema.contact.id, contact.id));
}
