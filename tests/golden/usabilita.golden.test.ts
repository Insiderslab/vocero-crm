import { describe, expect, it, vi } from "vitest";
import { getSql } from "@/lib/db";
import { runAgentTurn } from "@/server/ai/pipeline";
import { listConversations, listMessages } from "@/server/inbox/queries";
import { aiWillReply, recordedRequests } from "./harness";
import { ORG_A } from "./setup";

// IA configurada (proveedor sintético interceptado), como agent.golden.
vi.hoisted(() => {
  process.env.OPENROUTER_API_TOKEN = "sk-or-golden-synthetic-token";
  process.env.OPENROUTER_MODEL = "golden/modelo-sintetico";
  process.env.AGENT_COALESCE_MS = "0";
});

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
