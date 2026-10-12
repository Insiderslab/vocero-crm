import { and, asc, eq, isNull } from "drizzle-orm";
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
import { MESSAGE_CHRONOLOGY_DESC } from "@/server/inbox/queries";
import {
  decideOnFailure,
  retryStillValid,
  sentSinceLastInbound,
  shouldSendErrorReply,
  type TurnMode,
} from "@/server/ai/failure";

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

/** 009 (E1) — Segundo intento programado tras un `provider_error`. */
type RetryEntry = {
  timer: ReturnType<typeof setTimeout>;
  /** El entrante al que el turno fallido debía responder. */
  inboundId: string;
};

export type TurnOptions = {
  mode?: TurnMode;
  /** Solo `retry`: el entrante que debe seguir siendo el último mensaje. */
  expectInboundId?: string;
};

const globalForAgent = globalThis as unknown as {
  __agentCoalesce?: Map<string, CoalesceEntry>;
  __agentRetry?: Map<string, RetryEntry>;
};

function coalesceMap(): Map<string, CoalesceEntry> {
  if (!globalForAgent.__agentCoalesce) {
    globalForAgent.__agentCoalesce = new Map();
  }
  return globalForAgent.__agentCoalesce;
}

/**
 * Mapa aparte del coalesce A PROPÓSITO: un segundo intento espera un minuto y
 * no es "trabajo en curso" (un turno no lo espera, y quien espera a que el
 * agente termine —p. ej. el arnés golden— no debe quedarse colgado de él).
 */
function retryMap(): Map<string, RetryEntry> {
  if (!globalForAgent.__agentRetry) {
    globalForAgent.__agentRetry = new Map();
  }
  return globalForAgent.__agentRetry;
}

/** Conversaciones con un segundo intento pendiente (diagnóstico y pruebas). */
export function pendingAgentRetries(): string[] {
  return [...retryMap().keys()];
}

/** Anula el segundo intento pendiente de una conversación, si lo hay. */
export function cancelAgentRetry(conversationId: string): boolean {
  const map = retryMap();
  const entry = map.get(conversationId);
  if (!entry) return false;
  clearTimeout(entry.timer);
  map.delete(conversationId);
  return true;
}

/** Punto de entrada con debounce (mensajes entrantes reales). */
export function scheduleAgentTurn(conversationId: string): void {
  // Un entrante nuevo agenda su propio turno, que responde a todo lo
  // pendiente: el segundo intento del turno anterior sobra.
  cancelAgentRetry(conversationId);
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

async function executeTurn(
  conversationId: string,
  options?: TurnOptions
): Promise<void> {
  const map = coalesceMap();
  const entry = map.get(conversationId);
  if (!entry || entry.running) return;
  entry.running = true;
  try {
    await runAgentTurn(conversationId, options);
  } catch (err) {
    console.error("[agente] turno falló:", err);
  } finally {
    entry.running = false;
    if (entry.pending) {
      entry.pending = false;
      // Lo que llegó durante el turno: un turno NORMAL más.
      void executeTurn(conversationId);
    } else {
      map.delete(conversationId);
    }
  }
}

/**
 * Turno fuera del debounce pero CON el lock por conversación. Si ya hay un
 * turno corriendo o agendado, no se lanza otro: ese responde a lo último
 * (`queued`). Devuelve cuándo terminó el turno lanzado.
 */
async function runExclusive(
  conversationId: string,
  options: TurnOptions
): Promise<"ran" | "busy"> {
  const map = coalesceMap();
  if (map.has(conversationId)) return "busy";
  map.set(conversationId, { timer: null, running: false, pending: false });
  await executeTurn(conversationId, options);
  return "ran";
}

/** 009 (E1a) — Programa EL segundo intento (uno; reprogramar lo reemplaza). */
function scheduleAgentRetry(conversationId: string, inboundId: string): void {
  cancelAgentRetry(conversationId);
  const delay = getEnv().AGENT_RETRY_MS;
  const timer = setTimeout(() => {
    retryMap().delete(conversationId);
    void runExclusive(conversationId, {
      mode: "retry",
      expectInboundId: inboundId,
    });
  }, delay);
  // Que el temporizador no mantenga vivo el proceso (scripts, pruebas).
  if (typeof timer.unref === "function") timer.unref();
  retryMap().set(conversationId, { timer, inboundId });
}

/**
 * 009 (E1c) — «Riprova risposta IA»: un turno YA, con el lock. Es el segundo
 * intento pedido por una persona, así que si el proveedor vuelve a fallar se
 * pasa a un humano sin programar otro. Quien llama ya quitó el handoff.
 */
export async function runAgentTurnNow(conversationId: string): Promise<"ran" | "busy"> {
  cancelAgentRetry(conversationId);
  return runExclusive(conversationId, { mode: "manual" });
}

/**
 * Ejecuta UN turno del agente ahora (el Laboratorio lo llama directo, con
 * debounce 0 y sin pasar por el coalesce).
 */
export async function runAgentTurn(
  conversationId: string,
  options: TurnOptions = {}
): Promise<void> {
  if (!isAiConfigured()) return;
  const mode: TurnMode = options.mode ?? "normal";

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
    .orderBy(...MESSAGE_CHRONOLOGY_DESC)
    .limit(20);
  // 009 (E1a): el segundo intento solo responde si el entrante del turno
  // fallido sigue siendo el ÚLTIMO mensaje (nada nuevo, nadie contestó).
  if (mode === "retry" && !retryStillValid(options.expectInboundId, history[0])) {
    return;
  }
  history.reverse();
  const lastInbound = [...history].reverse().find((m) => m.direction === "in");
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
      .filter((m) => m.text)
      .map((m) => ({
        role: m.direction === "in" ? ("user" as const) : ("assistant" as const),
        content: m.text!,
      })),
  ];

  const result = await chatJson(AgentAction, messages);
  if (!result.ok) {
    if (result.error === "not_configured") return;
    console.error(`[agente] fallo del proveedor (raw): ${result.detail}`);
    // 009 (E1a): un proveedor caído puede volver en un minuto. UN segundo
    // intento antes de dejar al cliente sin respuesta; nunca más de uno.
    const decision = decideOnFailure({
      error: result.error,
      mode,
      isTest: conversation.isTest,
      retryDelayMs: getEnv().AGENT_RETRY_MS,
    });
    if (decision === "retry_later") {
      scheduleAgentRetry(conversationId, lastInbound.id);
      console.warn(
        `[agente] proveedor no disponible en ${conversationId}: segundo intento en ${getEnv().AGENT_RETRY_MS} ms`
      );
      return;
    }
    // Fallo persistente del proveedor o salida imposible → escalar (FR-022)
    // y, si el dueño lo configuró, avisar al cliente (E1b).
    const transitioned = await applyHandoff(conversationId, organizationId, "error");
    await sendErrorReply(conversation, profile.errorReply, transitioned);
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

/**
 * 009 (E1b) — Mensaje de cortesía al pasar a un humano por `error`. Una vez:
 * solo en la transición y si tras el último entrante no hay ya un saliente
 * con ese texto. Por el envío normal (`sendText`: ventana de 24 h, sandbox,
 * credenciales); si no se puede enviar se registra y no se reintenta.
 */
async function sendErrorReply(
  conversation: Conversation,
  text: string | null,
  transitioned: boolean
): Promise<void> {
  const reply = text?.trim() ?? "";
  if (
    !shouldSendErrorReply({
      text: reply,
      transitioned,
      isTest: conversation.isTest,
      alreadySent: false,
    })
  ) {
    return;
  }
  const db = getDb();
  const recent = await db
    .select({ direction: schema.message.direction, text: schema.message.text })
    .from(schema.message)
    .where(
      and(
        eq(schema.message.organizationId, conversation.organizationId),
        eq(schema.message.conversationId, conversation.id)
      )
    )
    .orderBy(...MESSAGE_CHRONOLOGY_DESC)
    .limit(50);
  if (sentSinceLastInbound(recent, reply)) return;
  try {
    await sendText({
      conversationId: conversation.id,
      organizationId: conversation.organizationId,
      text: reply,
      aiGenerated: true,
    });
  } catch (err) {
    if (err instanceof SendError) {
      console.warn(
        `[agente] mensaje de cortesía no enviado (${err.code}) en ${conversation.id}`
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

/**
 * Pasa la conversación a un humano. Solo en la TRANSICIÓN (sin handoff
 * activo): no pisa la hora ni el motivo de un handoff anterior y devuelve si
 * la hizo, para que lo que va una vez por handoff (cortesía, aviso) no se
 * repita.
 */
export async function applyHandoff(
  conversationId: string,
  organizationId: string,
  reason: "cliente" | "modelo" | "error" | "ventana"
): Promise<boolean> {
  const db = getDb();
  const updated = await db
    .update(schema.conversation)
    .set({ handoffAt: new Date(), handoffReason: reason, updatedAt: new Date() })
    .where(
      and(
        eq(schema.conversation.id, conversationId),
        isNull(schema.conversation.handoffAt)
      )
    )
    .returning();
  const conv = updated[0];
  if (!conv) return false;
  publish(organizationId, {
    type: "conversation.updated",
    data: {
      conversation: { id: conversationId, handoffReason: reason },
    },
  });
  // El Laboratorio (is_test) no es una persona esperando: sin aviso.
  if (!conv.isTest) {
    await publishHandoffAlert(organizationId, conversationId, conv.contactId, reason);
  }
  return true;
}

/**
 * 009 (E1d) — Aviso en la app: un evento SSE propio, para que la pantalla no
 * tenga que adivinar un handoff a partir de un `conversation.updated`.
 */
export async function publishHandoffAlert(
  organizationId: string,
  conversationId: string,
  contactId: string,
  reason: string
): Promise<void> {
  const rows = await getDb()
    .select({ name: schema.contact.name })
    .from(schema.contact)
    .where(
      scoped(schema.contact.organizationId, organizationId, eq(schema.contact.id, contactId))
    )
    .limit(1);
  publish(organizationId, {
    type: "conversation.handoff",
    data: { conversationId, reason, contactName: rows[0]?.name ?? null },
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
