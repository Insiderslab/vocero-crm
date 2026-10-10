import { beforeEach, describe, it, vi } from "vitest";
import { getSql } from "@/lib/db";
import { runAgentTurn } from "@/server/ai/pipeline";
import { waFixture } from "./fixtures/whatsapp";
import { aiWillReply, expectGolden, postWebhook, snapshot } from "./harness";
import { ORG_A } from "./setup";

// IA configurada (proveedor sintético interceptado) y sin espera de coalesce:
// el turno que agenda el webhook corre enseguida y `settle()` lo espera.
vi.hoisted(() => {
  process.env.OPENROUTER_API_TOKEN = "sk-or-golden-synthetic-token";
  process.env.OPENROUTER_MODEL = "golden/modelo-sintetico";
  process.env.AGENT_COALESCE_MS = "0";
});

/**
 * Golden — AGENTE IA (plan §7.1): respuesta por WhatsApp, ventana cerrada →
 * handoff `ventana` sin llamar al modelo, Laboratorio sin ninguna petición a
 * Graph. La petición al modelo (incluido el prompt de sistema) es parte del
 * golden: si cambia el prompt (M1.5), el golden se actualiza de forma
 * DECLARADA en el registro de ese paquete.
 */
describe("agent", () => {
  beforeEach(async () => {
    await getSql()`
      insert into agent_profile (id, organization_id, enabled, name, tone, instructions)
      values ('agp_golden_a', ${ORG_A}, true, 'Asistente Golden', 'cercano',
              'Atiende citas de un negocio de prueba.')
    `;
    await getSql()`
      insert into kb_entry (id, organization_id, kind, question, answer)
      values ('kb_golden_a_horario', ${ORG_A}, 'qa', '¿Horario?', 'De 9 a 19 h')
    `;
  });

  it("entrante real → turno agendado → respuesta enviada por Graph (aiGenerated)", async () => {
    aiWillReply('{"action":"reply","text":"¡Hola Ana! Abrimos de 9 a 19 h."}');
    const response = await postWebhook(waFixture("inbound-text-mx"));
    expectGolden(await snapshot({ response }));
  });

  it("el modelo pide handoff con despedida → despedida enviada y handoff modelo", async () => {
    aiWillReply('{"action":"handoff","reason":"pide precio","farewell":"Te paso con una persona del equipo."}');
    const response = await postWebhook(waFixture("inbound-text-mx"));
    expectGolden(await snapshot({ response }));
  });

  it("ventana cerrada → handoff ventana sin llamar al modelo ni a Graph", async () => {
    const response = await postWebhook(waFixture("inbound-old-text"));
    expectGolden(await snapshot({ response }));
  });

  it("conversación del Laboratorio → responde el modelo, se persiste en sandbox, ninguna petición a Graph", async () => {
    const sql = getSql();
    await sql`
      insert into contact (id, organization_id, wa_identity, phone, name, archived_at)
      values ('ct_golden_lab_persona', ${ORG_A}, '5200000000001', '5200000000001', 'Persona del Laboratorio', now())
    `;
    await sql`
      insert into conversation (id, organization_id, contact_id, is_test, ai_enabled, last_inbound_at, last_message_at)
      values ('cv_golden_lab_a', ${ORG_A}, 'ct_golden_lab_persona', true, true, '2030-01-01 11:59:00', '2030-01-01 11:59:00')
    `;
    await sql`
      insert into message (id, organization_id, conversation_id, direction, type, text, status, wa_timestamp)
      values ('msg_golden_lab_in_1', ${ORG_A}, 'cv_golden_lab_a', 'in', 'text', '¿Tienen cita mañana?', 'delivered', '2030-01-01 11:59:00')
    `;
    aiWillReply('{"action":"reply","text":"Lo confirmo con el equipo."}');
    await runAgentTurn("cv_golden_lab_a");
    expectGolden(await snapshot());
  });
});
