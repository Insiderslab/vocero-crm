import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import { getDb, getSql } from "@/lib/db";
import { provisionOrganization } from "@/server/auth/on-signup";
import { getBranding } from "@/server/branding";
import { seedDemo } from "@/server/seed/demo";
import {
  applyHandoff,
  cancelAgentRetry,
  clearAgentRetryOnHumanReply,
  pendingAgentRetries,
  recoverAgentRetries,
  runAgentTurn,
  runAgentTurnNow,
} from "@/server/ai/pipeline";
import { prepareManualRetry } from "@/server/ai/manual-retry";
import { listConversations, listMessages } from "@/server/inbox/queries";
import { waFixture } from "./fixtures/whatsapp";
import {
  aiWillFail,
  aiWillReply,
  conversationIdOf,
  postWebhook,
  recordedRequests,
  recordedSse,
  settle,
} from "./harness";
import { ORG_A, ORG_B } from "./setup";

// IA configurada (proveedor sintético interceptado), como agent.golden, y un
// segundo intento corto para no esperar el minuto real.
vi.hoisted(() => {
  process.env.OPENROUTER_API_TOKEN = "sk-or-golden-synthetic-token";
  process.env.OPENROUTER_MODEL = "golden/modelo-sintetico";
  process.env.AGENT_COALESCE_MS = "0";
  process.env.AGENT_RETRY_MS = "300";
});

const RETRY_MS = 300;

/**
 * 009 — Usabilidad P1 (specs/custom-heili/009-usabilita-p1.md). Aserciones
 * EXPLÍCITAS, sin instantánea: los golden de comportamiento existentes no se
 * tocan desde aquí. PostgreSQL real, gestores verdaderos.
 */

const sql = () => getSql();

async function contactAndConversation(id: string, opts: { isTest?: boolean } = {}) {
  await sql()`
    insert into contact (id, organization_id, wa_identity, phone, name)
    values (${`ct_${id}`}, ${ORG_A}, ${`52100${id.length}0000${id.length}`}, null, ${`Contacto ${id}`})
  `;
  await sql()`
    insert into conversation (id, organization_id, contact_id, is_test, ai_enabled, last_inbound_at, last_message_at)
    values (${`cv_${id}`}, ${ORG_A}, ${`ct_${id}`}, ${opts.isTest ?? false}, true, now(), now())
  `;
  return `cv_${id}`;
}

describe("E4 — orden de los mensajes", () => {
  it("pregunta y respuesta en el MISMO instante (precisión de segundo): la pregunta va primero, siempre", async () => {
    const cv = await contactAndConversation("orden");
    // Como un bloque del historial de coexistence: ambos con el timestamp de
    // Meta (segundos) y la respuesta INSERTADA ANTES que la pregunta, con un
    // id que además ordena antes. Sin desempate, PostgreSQL las devuelve en
    // el orden físico: la respuesta primero.
    await sql()`
      insert into message (id, organization_id, conversation_id, direction, type, text, status, wa_timestamp, created_at)
      values ('msg_a_respuesta', ${ORG_A}, ${cv}, 'out', 'text', 'Abrimos a las 9', 'sent',
              '2030-01-01 10:05:42', '2030-01-01 10:05:42')
    `;
    await sql()`
      insert into message (id, organization_id, conversation_id, direction, type, text, status, wa_timestamp, created_at)
      values ('msg_z_pregunta', ${ORG_A}, ${cv}, 'in', 'text', '¿A qué hora abren?', 'delivered',
              '2030-01-01 10:05:42', '2030-01-01 10:05:42')
    `;

    for (let i = 0; i < 3; i++) {
      const rows = await listMessages(ORG_A, cv);
      expect(rows.map((r) => r.message.text)).toEqual(["¿A qué hora abren?", "Abrimos a las 9"]);
    }

    // La vista previa de la bandeja es el ÚLTIMO mensaje con el mismo orden.
    const conv = (await listConversations(ORG_A)).find((c) => c.id === cv);
    expect(conv?.preview).toBe("Abrimos a las 9");
  });

  it("el contexto que ve el modelo usa el mismo orden determinista", async () => {
    const cv = await contactAndConversation("ctx", { isTest: true });
    await sql()`
      insert into message (id, organization_id, conversation_id, direction, type, text, status, wa_timestamp, created_at)
      values ('msg_b_in2', ${ORG_A}, ${cv}, 'in', 'text', 'P2', 'delivered', now(), '2030-01-01 10:00:01'),
             ('msg_z_in', ${ORG_A}, ${cv}, 'in', 'text', 'P1', 'delivered', now(), '2030-01-01 10:00:00'),
             ('msg_a_out', ${ORG_A}, ${cv}, 'out', 'text', 'R1', 'sent', now(), '2030-01-01 10:00:00')
    `;
    await sql()`insert into agent_profile (id, organization_id, enabled, name) values ('agp_e4', ${ORG_A}, true, 'A')`;
    aiWillReply('{"action":"none"}');
    await runAgentTurn(cv);
    const call = recordedRequests().find((r) => r.to === "ai");
    const body = call?.body as { messages: { role: string; content: string }[] };
    expect(body.messages.slice(1).map((m) => `${m.role}:${m.content}`)).toEqual([
      "user:P1",
      "assistant:R1",
      "user:P2",
    ]);
  });
});

/* ------------------------------------------------------------------------ */
/* E1 — el proveedor de IA falla                                            */
/* ------------------------------------------------------------------------ */

const ANA = "525512345678"; // inbound-text-mx (5215512345678 normalizado)
const ERROR_REPLY = "Ahora mismo no puedo responder; una persona del equipo te escribe enseguida.";

async function agentProfile(opts: { errorReply?: string | null; enabled?: boolean } = {}) {
  await sql()`
    insert into agent_profile (id, organization_id, enabled, name, error_reply)
    values ('agp_e1', ${ORG_A}, ${opts.enabled ?? true}, 'Asistente E1', ${opts.errorReply ?? null})
  `;
}

const aiCalls = () => recordedRequests().filter((r) => r.to === "ai");
const graphTexts = () =>
  recordedRequests()
    .filter((r) => r.to === "graph" && r.method === "POST" && /\/messages$/.test(r.path))
    .map((r) => (r.body as { text?: { body?: string } }).text?.body ?? null);

async function conv(cv: string) {
  const [row] = await sql()<
    { handoff_at: Date | null; handoff_reason: string | null; ai_enabled: boolean; agent_retry_at: Date | null }[]
  >`
    select handoff_at, handoff_reason, ai_enabled, agent_retry_at from conversation where id = ${cv}
  `;
  return row!;
}

async function outbound(cv: string) {
  return sql()<{ text: string | null; ai_generated: boolean; origin: string }[]>`
    select text, ai_generated, origin from message
    where conversation_id = ${cv} and direction = 'out' order by created_at, id
  `;
}

/** Espera a que disparen los segundos intentos y a que su turno termine. */
async function waitRetries(): Promise<void> {
  await sleep(RETRY_MS + 50);
  for (let i = 0; i < 200 && pendingAgentRetries().length > 0; i++) await sleep(10);
  await settle();
}

describe("E1a — segundo intento (persistido)", () => {
  it("el proveedor cae: handoff `error` PROVISIONAL con marca, sin aviso ni cortesía; el segundo intento responde UNA vez", async () => {
    await agentProfile({ errorReply: ERROR_REPLY });
    aiWillFail(3); // un turno entero (los 3 intentos de chatJson)
    aiWillReply('{"action":"reply","text":"¡Hola Ana! Ya estoy de vuelta."}');

    await postWebhook(waFixture("inbound-text-mx"));
    const cv = await conversationIdOf(ORG_A, ANA);
    expect(pendingAgentRetries()).toEqual([cv]);
    const pending = await conv(cv);
    expect(pending.handoff_reason).toBe("error");
    expect(pending.agent_retry_at).not.toBeNull();
    expect(graphTexts()).toEqual([]);
    expect(recordedSse().filter((e) => e.type === "conversation.handoff")).toEqual([]);

    await waitRetries();
    expect(aiCalls()).toHaveLength(4);
    expect(graphTexts()).toEqual(["¡Hola Ana! Ya estoy de vuelta."]);
    const after = await conv(cv);
    expect(after.handoff_at).toBeNull();
    expect(after.agent_retry_at).toBeNull();
    expect(pendingAgentRetries()).toEqual([]);
    expect(recordedSse().filter((e) => e.type === "conversation.handoff")).toEqual([]);
  });

  it("el segundo intento también falla: handoff `error` definitivo, cortesía UNA vez y aviso SSE", async () => {
    await agentProfile({ errorReply: ERROR_REPLY });
    aiWillFail(6);

    await postWebhook(waFixture("inbound-text-mx"));
    const cv = await conversationIdOf(ORG_A, ANA);
    await waitRetries();

    expect(aiCalls()).toHaveLength(6); // 3 + 3: nunca un tercer turno
    const c = await conv(cv);
    expect(c.handoff_reason).toBe("error");
    expect(c.handoff_at).not.toBeNull();
    expect(c.agent_retry_at).toBeNull();
    expect(graphTexts()).toEqual([ERROR_REPLY]);
    expect(await outbound(cv)).toEqual([{ text: ERROR_REPLY, ai_generated: true, origin: "ai" }]);
    expect(pendingAgentRetries()).toEqual([]);

    const alerts = recordedSse().filter((e) => e.type === "conversation.handoff");
    expect(alerts).toEqual([
      {
        org: ORG_A,
        type: "conversation.handoff",
        data: { conversationId: cv, reason: "error", contactName: "Ana Golden" },
      },
    ]);
    // El aviso es solo del canal de A.
    expect(recordedSse().some((e) => e.org === ORG_B)).toBe(false);

    // Otro entrante con el handoff DEFINITIVO: el agente calla, ni IA ni cortesía.
    await postWebhook(waFixture("inbound-text-mx-again"));
    await waitRetries();
    expect(aiCalls()).toHaveLength(6);
    expect(graphTexts()).toEqual([ERROR_REPLY]);
  });

  it("sin texto de cortesía configurado: handoff `error` y ningún mensaje al cliente", async () => {
    await agentProfile({ errorReply: null });
    aiWillFail(6);
    await postWebhook(waFixture("inbound-text-mx"));
    const cv = await conversationIdOf(ORG_A, ANA);
    await waitRetries();
    expect((await conv(cv)).handoff_reason).toBe("error");
    expect(graphTexts()).toEqual([]);
  });

  it("llega un entrante nuevo durante la espera: la marca no silencia, se quita y hay UNA sola respuesta", async () => {
    await agentProfile({ errorReply: ERROR_REPLY });
    aiWillFail(3);
    await postWebhook(waFixture("inbound-text-mx"));
    const cv = await conversationIdOf(ORG_A, ANA);
    expect(pendingAgentRetries()).toEqual([cv]);

    aiWillReply('{"action":"reply","text":"Respuesta a los dos mensajes."}');
    await postWebhook(waFixture("inbound-text-mx-again"));
    expect(pendingAgentRetries()).toEqual([]);

    await waitRetries();
    expect(graphTexts()).toEqual(["Respuesta a los dos mensajes."]);
    expect(aiCalls()).toHaveLength(4);
    const c = await conv(cv);
    expect(c.handoff_at).toBeNull();
    expect(c.agent_retry_at).toBeNull();
  });

  it("escenario C: falla otra vez con el segundo intento pendiente → escala YA, sin rearmar", async () => {
    await agentProfile({ errorReply: ERROR_REPLY });
    aiWillFail(6);
    await postWebhook(waFixture("inbound-text-mx"));
    const cv = await conversationIdOf(ORG_A, ANA);
    expect(pendingAgentRetries()).toEqual([cv]);

    // El cliente insiste durante la espera y el proveedor sigue caído.
    await postWebhook(waFixture("inbound-text-mx-again"));
    expect(pendingAgentRetries()).toEqual([]);
    const c = await conv(cv);
    expect(c.handoff_reason).toBe("error");
    expect(c.agent_retry_at).toBeNull();
    expect(graphTexts()).toEqual([ERROR_REPLY]);
    expect(recordedSse().filter((e) => e.type === "conversation.handoff")).toHaveLength(1);

    await waitRetries();
    expect(aiCalls()).toHaveLength(6); // ningún turno más
  });

  it("el operador contesta desde la bandeja durante la espera: fuera la marca, el handoff se queda, el agente no habla", async () => {
    await agentProfile({ errorReply: ERROR_REPLY });
    aiWillFail(3);
    aiWillReply('{"action":"reply","text":"NO DEBE SALIR"}');
    await postWebhook(waFixture("inbound-text-mx"));
    const cv = await conversationIdOf(ORG_A, ANA);
    // Lo que hace la ruta de envío de la bandeja tras enviar.
    await sql()`
      insert into message (id, organization_id, conversation_id, direction, type, text, status, origin)
      values ('msg_e1_operador', ${ORG_A}, ${cv}, 'out', 'text', 'Te contesto yo', 'sent', 'operator')
    `;
    expect(await clearAgentRetryOnHumanReply(ORG_A, cv)).toBe(true);
    expect(pendingAgentRetries()).toEqual([]);
    await waitRetries();
    expect(aiCalls()).toHaveLength(3);
    expect(graphTexts()).toEqual([]);
    const c = await conv(cv);
    expect(c.handoff_reason).toBe("error");
    expect(c.agent_retry_at).toBeNull();
    expect(recordedSse().filter((e) => e.type === "conversation.handoff")).toEqual([]);
  });

  it("una respuesta que NO pasó por la bandeja (eco del teléfono): al disparar, el segundo intento no habla", async () => {
    await agentProfile({ errorReply: ERROR_REPLY });
    aiWillFail(3);
    aiWillReply('{"action":"reply","text":"NO DEBE SALIR"}');
    await postWebhook(waFixture("inbound-text-mx"));
    const cv = await conversationIdOf(ORG_A, ANA);
    await sql()`
      insert into message (id, organization_id, conversation_id, direction, type, text, status, origin)
      values ('msg_e1_eco', ${ORG_A}, ${cv}, 'out', 'text', 'Te contesto yo', 'sent', 'manual')
    `;
    await waitRetries();
    expect(aiCalls()).toHaveLength(3);
    expect(graphTexts()).toEqual([]);
    const c = await conv(cv);
    expect(c.handoff_reason).toBe("error");
    expect(c.agent_retry_at).toBeNull();
  });

  it("reinicio con la marca FUTURA: el arranque reprograma y el segundo intento responde", async () => {
    await agentProfile({ errorReply: ERROR_REPLY });
    aiWillFail(3);
    await postWebhook(waFixture("inbound-text-mx"));
    const cv = await conversationIdOf(ORG_A, ANA);
    // «Se cae el proceso»: el temporizador en memoria desaparece; la marca no.
    cancelAgentRetry(cv);
    expect(pendingAgentRetries()).toEqual([]);
    expect((await conv(cv)).agent_retry_at).not.toBeNull();

    aiWillReply('{"action":"reply","text":"Perdona, ya estoy."}');
    expect(await recoverAgentRetries()).toEqual({ rescheduled: 1, finalized: 0 });
    expect(pendingAgentRetries()).toEqual([cv]);
    await waitRetries();
    expect(graphTexts()).toEqual(["Perdona, ya estoy."]);
    const c = await conv(cv);
    expect(c.handoff_at).toBeNull();
    expect(c.agent_retry_at).toBeNull();
  });

  it("reinicio con la marca VENCIDA: el arranque cierra el handoff (aviso + cortesía una vez), sin llamar al modelo", async () => {
    await agentProfile({ errorReply: ERROR_REPLY });
    aiWillFail(3);
    await postWebhook(waFixture("inbound-text-mx"));
    const cv = await conversationIdOf(ORG_A, ANA);
    cancelAgentRetry(cv);
    await sql()`update conversation set agent_retry_at = now() - interval '1 hour' where id = ${cv}`;

    expect(await recoverAgentRetries()).toEqual({ rescheduled: 0, finalized: 1 });
    await settle();
    expect(aiCalls()).toHaveLength(3);
    const c = await conv(cv);
    expect(c.handoff_reason).toBe("error");
    expect(c.agent_retry_at).toBeNull();
    expect(graphTexts()).toEqual([ERROR_REPLY]);
    expect(recordedSse().filter((e) => e.type === "conversation.handoff")).toHaveLength(1);
    // Repetir la recuperación no hace nada más.
    expect(await recoverAgentRetries()).toEqual({ rescheduled: 0, finalized: 0 });
    expect(graphTexts()).toEqual([ERROR_REPLY]);
  });

  it("Laboratorio: sin segundo intento ni cortesía (handoff inmediato, como antes)", async () => {
    await agentProfile({ errorReply: ERROR_REPLY });
    const cv = await contactAndConversation("lab", { isTest: true });
    await sql()`
      insert into message (id, organization_id, conversation_id, direction, type, text, status, wa_timestamp)
      values ('msg_e1_lab', ${ORG_A}, ${cv}, 'in', 'text', 'Hola', 'delivered', now())
    `;
    aiWillFail(3);
    await runAgentTurn(cv);
    expect(pendingAgentRetries()).toEqual([]);
    expect((await conv(cv)).handoff_reason).toBe("error");
    expect(await outbound(cv)).toEqual([]);
    expect(recordedRequests().some((r) => r.to === "graph")).toBe(false);
  });

  it("Laboratorio: un handoff NO dispara el aviso en la app (no hay nadie esperando)", async () => {
    await agentProfile({ errorReply: ERROR_REPLY });
    const cv = await contactAndConversation("labaviso", { isTest: true });
    await sql()`
      insert into message (id, organization_id, conversation_id, direction, type, text, status, wa_timestamp)
      values ('msg_e1_lab_humano', ${ORG_A}, ${cv}, 'in', 'text', 'quiero hablar con un humano', 'delivered', now())
    `;
    await runAgentTurn(cv);
    expect((await conv(cv)).handoff_reason).toBe("cliente");
    expect(recordedSse().filter((e) => e.type === "conversation.handoff")).toEqual([]);
    // El resto sí: la conversación del Laboratorio sigue informando su estado.
    expect(recordedSse().some((e) => e.type === "conversation.updated")).toBe(true);
  });
});

describe("E1c — «Riprova risposta IA»", () => {
  async function failedConversation(): Promise<string> {
    aiWillFail(6);
    await postWebhook(waFixture("inbound-text-mx"));
    const cv = await conversationIdOf(ORG_A, ANA);
    await waitRetries();
    expect((await conv(cv)).handoff_reason).toBe("error");
    return cv;
  }

  it("quita el handoff y el turno inmediato responde", async () => {
    await agentProfile({ errorReply: ERROR_REPLY });
    const cv = await failedConversation();

    const res = await prepareManualRetry(ORG_A, cv);
    expect(res.status).toBe("ok");
    const c = await conv(cv);
    expect(c.handoff_at).toBeNull();
    expect(c.ai_enabled).toBe(true);

    aiWillReply('{"action":"reply","text":"Perdona la espera, abrimos de 9 a 19 h."}');
    expect(await runAgentTurnNow(cv)).toBe("ran");
    await settle();
    expect(graphTexts()).toEqual([ERROR_REPLY, "Perdona la espera, abrimos de 9 a 19 h."]);
  });

  it("si el proveedor sigue caído: handoff `error` inmediato, sin otro intento y sin repetir la cortesía", async () => {
    await agentProfile({ errorReply: ERROR_REPLY });
    const cv = await failedConversation();
    expect((await prepareManualRetry(ORG_A, cv)).status).toBe("ok");

    aiWillFail(3);
    await runAgentTurnNow(cv);
    await settle();
    expect(pendingAgentRetries()).toEqual([]);
    expect((await conv(cv)).handoff_reason).toBe("error");
    // La cortesía ya salió tras el último entrante: no se repite.
    expect(graphTexts()).toEqual([ERROR_REPLY]);
    expect(aiCalls()).toHaveLength(9);
  });

  it("agente apagado o conversación de otra organización: nada cambia", async () => {
    await agentProfile({ errorReply: ERROR_REPLY });
    const cv = await failedConversation();

    await sql()`update agent_profile set enabled = false where id = 'agp_e1'`;
    expect((await prepareManualRetry(ORG_A, cv)).status).toBe("agent_disabled");
    expect((await conv(cv)).handoff_reason).toBe("error");

    await sql()`update agent_profile set enabled = true where id = 'agp_e1'`;
    expect((await prepareManualRetry(ORG_B, cv)).status).toBe("not_found");
    expect((await conv(cv)).handoff_reason).toBe("error");
  });
});

describe("E1c — «Riprova» idempotente y solo para fallos del proveedor", () => {
  async function failedConversation(): Promise<string> {
    aiWillFail(6);
    await postWebhook(waFixture("inbound-text-mx"));
    const cv = await conversationIdOf(ORG_A, ANA);
    await waitRetries();
    expect((await conv(cv)).handoff_reason).toBe("error");
    return cv;
  }

  it("escenario A: tras la respuesta, más «Riprova» → 409 y ningún envío más; dos a la vez → uno solo", async () => {
    await agentProfile({ errorReply: ERROR_REPLY });
    const cv = await failedConversation();
    const [a, b] = await Promise.all([prepareManualRetry(ORG_A, cv), prepareManualRetry(ORG_A, cv)]);
    expect([a.status, b.status].sort()).toEqual(["not_retryable", "ok"]);

    aiWillReply('{"action":"reply","text":"Perdona la espera."}');
    await runAgentTurnNow(cv);
    await settle();
    expect(graphTexts()).toEqual([ERROR_REPLY, "Perdona la espera."]);

    for (let i = 0; i < 3; i++) {
      expect((await prepareManualRetry(ORG_A, cv, Date.now() + 60_000 * (i + 1))).status).toBe("not_retryable");
    }
    aiWillReply('{"action":"reply","text":"NO DEBE SALIR"}');
    await runAgentTurnNow(cv); // aunque alguien lanzara el turno a mano, no hay nada que contestar
    await settle();
    expect(graphTexts()).toEqual([ERROR_REPLY, "Perdona la espera."]);
  });

  it("escenario B: handoff por respuesta desde el teléfono (manual_reply) → 409, nada cambia", async () => {
    await agentProfile({ errorReply: ERROR_REPLY });
    const cv = await contactAndConversation("manualreply");
    await sql()`update conversation set handoff_at = now(), handoff_reason = 'manual_reply', ai_enabled = false where id = ${cv}`;
    expect((await prepareManualRetry(ORG_A, cv)).status).toBe("not_retryable");
    const c = await conv(cv);
    expect(c.handoff_reason).toBe("manual_reply");
    expect(c.ai_enabled).toBe(false);
  });

  it("si una persona ya contestó tras el último entrante (la cortesía no cuenta) → already_answered", async () => {
    await agentProfile({ errorReply: ERROR_REPLY });
    const cv = await failedConversation();
    await sql()`
      insert into message (id, organization_id, conversation_id, direction, type, text, status, origin)
      values ('msg_e1c_operador', ${ORG_A}, ${cv}, 'out', 'text', 'Ya te atiendo yo', 'sent', 'operator')
    `;
    expect((await prepareManualRetry(ORG_A, cv)).status).toBe("already_answered");
    expect((await conv(cv)).handoff_reason).toBe("error");
  });

  it("pausa de 30 s entre reintentos de la misma conversación", async () => {
    await agentProfile({ errorReply: ERROR_REPLY });
    const cv = await failedConversation();
    const t0 = Date.now();
    expect((await prepareManualRetry(ORG_A, cv, t0)).status).toBe("ok");
    aiWillFail(3);
    await runAgentTurnNow(cv);
    await settle();
    expect((await conv(cv)).handoff_reason).toBe("error");
    expect((await prepareManualRetry(ORG_A, cv, t0 + 10_000)).status).toBe("cooldown");
    expect((await conv(cv)).handoff_reason).toBe("error");
    expect((await prepareManualRetry(ORG_A, cv, t0 + 31_000)).status).toBe("ok");
  });
});

describe("E1d — el handoff se aplica y se avisa solo en la transición", () => {
  it("dos handoffs seguidos: el segundo no pisa motivo ni hora y no repite el aviso", async () => {
    const cv = await contactAndConversation("transicion");
    expect(await applyHandoff(cv, ORG_A, "cliente")).toBe(true);
    const first = await conv(cv);
    expect(await applyHandoff(cv, ORG_A, "error")).toBe(false);
    const second = await conv(cv);
    expect(second.handoff_reason).toBe("cliente");
    expect(String(second.handoff_at)).toBe(String(first.handoff_at));
    expect(recordedSse().filter((e) => e.type === "conversation.handoff")).toEqual([
      {
        org: ORG_A,
        type: "conversation.handoff",
        data: { conversationId: cv, reason: "cliente", contactName: "Contacto transicion" },
      },
    ]);
  });
});

/* ------------------------------------------------------------------------ */
/* E2 — organización nueva en el idioma de quien la crea                    */
/* ------------------------------------------------------------------------ */

describe("E2 — siembra de una organización nueva", () => {
  async function newOrg(id: string, metadata: string | null = null) {
    await sql()`insert into organization (id, name, slug, metadata) values (${id}, ${id}, ${id}, ${metadata})`;
  }
  async function stagesOf(orgId: string) {
    return sql()<{ name: string; kind: string }[]>`
      select name, kind from pipeline_stage where organization_id = ${orgId} order by position
    `;
  }

  it("italiano: etapas en italiano y moneda EUR en la marca", async () => {
    await newOrg("org_e2_it");
    await getDb().transaction((tx) => provisionOrganization(tx, "org_e2_it", "it"));
    expect(await stagesOf("org_e2_it")).toEqual([
      { name: "Nuovo", kind: "open" },
      { name: "In conversazione", kind: "open" },
      { name: "Interessato", kind: "open" },
      { name: "Cliente", kind: "won" },
      { name: "Perso", kind: "lost" },
    ]);
    expect((await getBranding("org_e2_it")).currency).toBe("EUR");
  });

  it("español: como siempre (etapas en español, MXN)", async () => {
    await newOrg("org_e2_es");
    await getDb().transaction((tx) => provisionOrganization(tx, "org_e2_es", "es"));
    expect((await stagesOf("org_e2_es")).map((s) => s.name)).toEqual([
      "Nuevo",
      "En conversación",
      "Interesado",
      "Cliente",
      "Perdido",
    ]);
    expect((await getBranding("org_e2_es")).currency).toBe("MXN");
  });

  it("una marca ya guardada no se pisa", async () => {
    await newOrg("org_e2_meta", JSON.stringify({ branding: { currency: "USD", name: "Mía" } }));
    await getDb().transaction((tx) => provisionOrganization(tx, "org_e2_meta", "it"));
    const branding = await getBranding("org_e2_meta");
    expect(branding.currency).toBe("USD");
    expect(branding.name).toBe("Mía");
  });

  it("la demo (escrita en español) encuentra las etapas italianas por su clave", async () => {
    await newOrg("org_e2_demo");
    await getDb().transaction((tx) => provisionOrganization(tx, "org_e2_demo", "it"));
    await seedDemo(getDb(), "org_e2_demo");
    const rows = await sql()<{ name: string; n: number }[]>`
      select s.name, count(l.id)::int as n
      from pipeline_stage s left join lead l on l.stage_id = s.id
      where s.organization_id = ${"org_e2_demo"}
      group by s.name, s.position order by s.position
    `;
    // Ninguna etapa queda vacía por no encontrar "Interesado" o "Perdido".
    expect(rows.every((r) => r.n > 0)).toBe(true);
  });
});
