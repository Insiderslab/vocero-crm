import { describe, expect, it } from "vitest";
import { getSql } from "@/lib/db";
import { getDashboardSummary } from "@/server/dashboard/summary";
import { ORG_A, ORG_B } from "./setup";

/**
 * 010 — Sintesi (specs/custom-heili/010-sintesi-e-primo-avvio.md).
 *
 * Aserciones EXPLÍCITAS (sin instantánea): PostgreSQL real, números escritos a
 * mano, aislamiento entre dos organizaciones. No toca ningún `__golden__`.
 *
 * El reloj está congelado por el arnés (FIXED_NOW_MS = 2030-01-01T12:00:00Z) y
 * `getDashboardSummary` calcula el período con `Date.now()`, así que el «hace
 * N días» de estos datos es determinista.
 */

const sql = () => getSql();

const nowDate = () => new Date(Date.now());
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
/**
 * postgres-js (con los serializadores que Drizzle le instala) no acepta un
 * `Date` como parámetro crudo: va como texto ISO y `::timestamp`, igual que lo
 * guarda Drizzle (columnas sin zona, hora UTC).
 */
const ts = (d: Date | null | undefined) => (d ? d.toISOString() : null);

const stageNuevo = (org: "a" | "b") => `stg_golden_${org}_nuevo`;
const stageGanado = (org: "a" | "b") => `stg_golden_${org}_ganado`;

async function addContact(id: string, org: string, waIdentity: string) {
  await sql()`
    insert into contact (id, organization_id, wa_identity, name)
    values (${id}, ${org}, ${waIdentity}, ${id})
  `;
}

async function addConversation(
  id: string,
  org: string,
  contactId: string,
  opts: { isTest?: boolean; handoffAt?: Date | null; handoffReason?: string | null } = {}
) {
  await sql()`
    insert into conversation (id, organization_id, contact_id, is_test, handoff_at, handoff_reason)
    values (${id}, ${org}, ${contactId}, ${opts.isTest ?? false}, ${ts(opts.handoffAt)}::timestamp, ${opts.handoffReason ?? null})
  `;
}

async function addMessage(
  id: string,
  org: string,
  conversationId: string,
  direction: "in" | "out",
  createdAt: Date,
  aiGenerated = false
) {
  await sql()`
    insert into message (id, organization_id, conversation_id, direction, created_at, ai_generated)
    values (${id}, ${org}, ${conversationId}, ${direction}, ${ts(createdAt)}::timestamp, ${aiGenerated})
  `;
}

async function addLead(id: string, org: string, contactId: string, stageId: string) {
  await sql()`
    insert into lead (id, organization_id, contact_id, stage_id)
    values (${id}, ${org}, ${contactId}, ${stageId})
  `;
}

async function addStageEvent(
  id: string,
  org: string,
  leadId: string,
  contactId: string,
  occurredAt: Date,
  kind: "open" | "won" | "lost",
  toStageId: string | null,
  toStageName: string,
  lossReason: string | null = null
) {
  await sql()`
    insert into lead_stage_event
      (id, organization_id, lead_id, contact_id, to_stage_id, to_stage_name, to_stage_kind, occurred_at, loss_reason)
    values (${id}, ${org}, ${leadId}, ${contactId}, ${toStageId}, ${toStageName}, ${kind}, ${ts(occurredAt)}::timestamp, ${lossReason})
  `;
}

describe("010 Sintesi — conversaciones por etapa", () => {
  it("cuenta las reales por etapa (nombre guardado), los tests no, y las vacías salen en 0", async () => {
    await addContact("c_ana", ORG_A, "525500000001");
    await addConversation("cv_ana", ORG_A, "c_ana");
    await addConversation("cv_ana_test", ORG_A, "c_ana", { isTest: true });
    await addLead("l_ana", ORG_A, "c_ana", stageNuevo("a"));

    await addContact("c_bruno", ORG_A, "525500000002");
    await addLead("l_bruno", ORG_A, "c_bruno", stageGanado("a"));

    await addContact("c_carla", ORG_B, "525500000003");
    await addConversation("cv_carla", ORG_B, "c_carla");
    await addLead("l_carla", ORG_B, "c_carla", stageGanado("b"));

    const a = await getDashboardSummary(ORG_A, 30);
    expect(a.stages).toEqual([
      { id: "stg_golden_a_nuevo", name: "Nuevo", conversations: 1 },
      { id: "stg_golden_a_ganado", name: "Ganado", conversations: 0 },
    ]);

    const b = await getDashboardSummary(ORG_B, 30);
    expect(b.stages).toEqual([
      { id: "stg_golden_b_nuevo", name: "Nuevo", conversations: 0 },
      { id: "stg_golden_b_ganado", name: "Ganado", conversations: 1 },
    ]);
  });
});

describe("010 Sintesi — primera respuesta", () => {
  it("mediana 20 y p90 28 a mano; tests y sin-respuesta quedan fuera", async () => {
    // Tres conversaciones respondidas a 10, 20 y 30 minutos.
    const delays = [10, 20, 30];
    for (let i = 0; i < delays.length; i++) {
      const delay = delays[i]!;
      const contact = `c_r${i}`;
      const conversation = `cv_r${i}`;
      const firstIn = minutesAgo(180 + i * 60);
      await addContact(contact, ORG_A, `5255000010${String(i).padStart(2, "0")}`);
      await addConversation(conversation, ORG_A, contact);
      await addMessage(`m_r${i}_in`, ORG_A, conversation, "in", firstIn);
      await addMessage(
        `m_r${i}_out`,
        ORG_A,
        conversation,
        "out",
        new Date(firstIn.getTime() + delay * 60_000)
      );
    }

    // Conversación de TEST: no entra aunque esté respondida.
    await addContact("c_rt", ORG_A, "525500001099");
    await addConversation("cv_rt", ORG_A, "c_rt", { isTest: true });
    await addMessage("m_rt_in", ORG_A, "cv_rt", "in", minutesAgo(60));
    await addMessage("m_rt_out", ORG_A, "cv_rt", "out", minutesAgo(59));

    // Primera ENTRADA fuera del período: no entra aunque la respuesta caiga dentro.
    await addContact("c_ro", ORG_A, "525500001098");
    await addConversation("cv_ro", ORG_A, "c_ro");
    await addMessage("m_ro_in", ORG_A, "cv_ro", "in", daysAgo(40));
    await addMessage("m_ro_out", ORG_A, "cv_ro", "out", daysAgo(1));

    // Sin respuesta: no hay tiempo que medir.
    await addContact("c_rn", ORG_A, "525500001097");
    await addConversation("cv_rn", ORG_A, "c_rn");
    await addMessage("m_rn_in", ORG_A, "cv_rn", "in", minutesAgo(120));

    const a = await getDashboardSummary(ORG_A, 30);
    expect(a.firstResponse).toEqual({ medianMinutes: 20, p90Minutes: 28, answered: 3 });
  });
});

describe("010 Sintesi — IA contra persona y pasos a persona", () => {
  it("salientes IA/persona del período, y handoffs por motivo (sin los de test)", async () => {
    await addContact("c_o1", ORG_A, "525500002001");
    await addConversation("cv_o1", ORG_A, "c_o1", { handoffAt: daysAgo(1), handoffReason: "cliente" });
    await addContact("c_o2", ORG_A, "525500002002");
    await addConversation("cv_o2", ORG_A, "c_o2", { handoffAt: daysAgo(2), handoffReason: "cliente" });
    await addContact("c_o3", ORG_A, "525500002003");
    await addConversation("cv_o3", ORG_A, "c_o3", { handoffAt: daysAgo(3), handoffReason: "ventana" });
    await addContact("c_o4", ORG_A, "525500002004");
    await addConversation("cv_o4", ORG_A, "c_o4", { handoffAt: daysAgo(40), handoffReason: "error" });

    await addMessage("m_o1_ai", ORG_A, "cv_o1", "out", minutesAgo(90), true);
    await addMessage("m_o2_ai", ORG_A, "cv_o2", "out", minutesAgo(80), true);
    await addMessage("m_o3_ai", ORG_A, "cv_o3", "out", minutesAgo(70), true);
    await addMessage("m_o4_p", ORG_A, "cv_o4", "out", minutesAgo(60), false);
    await addMessage("m_o5_old", ORG_A, "cv_o1", "out", daysAgo(40), true);
    await addMessage("m_o6_in", ORG_A, "cv_o1", "in", minutesAgo(50));

    // Conversación de TEST (Laboratorio): ni sus salientes ni su handoff cuentan.
    await addContact("c_ot", ORG_A, "525500002099");
    await addConversation("cv_ot", ORG_A, "c_ot", {
      isTest: true,
      handoffAt: daysAgo(1),
      handoffReason: "cliente",
    });
    await addMessage("m_ot_ai", ORG_A, "cv_ot", "out", minutesAgo(40), true);
    await addMessage("m_ot_p", ORG_A, "cv_ot", "out", minutesAgo(39), false);

    const a = await getDashboardSummary(ORG_A, 30);
    expect(a.outgoing).toEqual({ ai: 3, human: 1 });
    expect(a.handoffs).toEqual([
      { reason: "cliente", conversations: 2 },
      { reason: "ventana", conversations: 1 },
    ]);
  });
});

describe("010 Sintesi — conversiones", () => {
  it("leads distintos que entran a ganada en el período; B no cuenta en A", async () => {
    await addContact("c_w1", ORG_A, "525500003001");
    await addLead("l_w1", ORG_A, "c_w1", stageNuevo("a"));
    await addStageEvent("e_w1a", ORG_A, "l_w1", "c_w1", daysAgo(5), "won", stageGanado("a"), "Ganado");
    await addStageEvent("e_w1b", ORG_A, "l_w1", "c_w1", daysAgo(3), "won", stageGanado("a"), "Ganado");

    await addContact("c_w2", ORG_A, "525500003002");
    await addLead("l_w2", ORG_A, "c_w2", stageNuevo("a"));
    await addStageEvent("e_w2", ORG_A, "l_w2", "c_w2", daysAgo(10), "won", stageGanado("a"), "Ganado");

    await addContact("c_l1", ORG_A, "525500003003");
    await addLead("l_l1", ORG_A, "c_l1", stageNuevo("a"));
    await addStageEvent("e_l1", ORG_A, "l_l1", "c_l1", daysAgo(4), "lost", null, "Perdido", "precio");

    await addContact("c_old", ORG_A, "525500003004");
    await addLead("l_old", ORG_A, "c_old", stageGanado("a"));
    await addStageEvent("e_old", ORG_A, "l_old", "c_old", daysAgo(40), "won", stageGanado("a"), "Ganado");

    await addContact("c_b1", ORG_B, "525500003005");
    await addLead("l_b1", ORG_B, "c_b1", stageNuevo("b"));
    await addStageEvent("e_b1", ORG_B, "l_b1", "c_b1", daysAgo(1), "won", stageGanado("b"), "Ganado");

    const a = await getDashboardSummary(ORG_A, 30);
    expect(a.conversions).toEqual({ won: 2 });
    const b = await getDashboardSummary(ORG_B, 30);
    expect(b.conversions).toEqual({ won: 1 });
  });
});

describe("010 Sintesi — andamento por día", () => {
  it("entrantes y salientes por fecha; lo viejo y los tests quedan fuera", async () => {
    await addContact("c_d1", ORG_A, "525500004001");
    await addConversation("cv_d1", ORG_A, "c_d1");
    await addMessage("m_d1", ORG_A, "cv_d1", "in", daysAgo(1));
    await addMessage("m_d2", ORG_A, "cv_d1", "in", daysAgo(1));
    await addMessage("m_d3", ORG_A, "cv_d1", "out", daysAgo(1), true);
    await addMessage("m_d4", ORG_A, "cv_d1", "in", daysAgo(2));
    await addMessage("m_d5", ORG_A, "cv_d1", "in", daysAgo(40));

    await addContact("c_dt", ORG_A, "525500004002");
    await addConversation("cv_dt", ORG_A, "c_dt", { isTest: true });
    await addMessage("m_dt", ORG_A, "cv_dt", "in", daysAgo(1));

    const a = await getDashboardSummary(ORG_A, 30);
    expect(a.daily).toEqual([
      { date: isoDay(daysAgo(2)), inbound: 1, outbound: 0 },
      { date: isoDay(daysAgo(1)), inbound: 2, outbound: 1 },
    ]);
  });

  it("el período filtra: con 7 días lo de hace 10 no aparece; con 90 sí", async () => {
    await addContact("c_p1", ORG_A, "525500005001");
    await addConversation("cv_p1", ORG_A, "c_p1");
    await addMessage("m_p1", ORG_A, "cv_p1", "in", daysAgo(10));

    const d7 = await getDashboardSummary(ORG_A, 7);
    expect(d7.days).toBe(7);
    expect(d7.daily).toEqual([]);

    const d90 = await getDashboardSummary(ORG_A, 90);
    expect(d90.days).toBe(90);
    expect(d90.daily).toEqual([
      { date: isoDay(daysAgo(10)), inbound: 1, outbound: 0 },
    ]);
  });
});

describe("010 Sintesi — aislamiento entre organizaciones", () => {
  it("los agregados de A no ven nada de B: cada bloque en su estado real", async () => {
    await addContact("c_iso_a", ORG_A, "525500006001");
    await addConversation("cv_iso_a", ORG_A, "c_iso_a");
    await addMessage("m_iso_a", ORG_A, "cv_iso_a", "out", minutesAgo(30), true);

    await addContact("c_iso_b", ORG_B, "525500006002");
    await addConversation("cv_iso_b", ORG_B, "c_iso_b");
    await addMessage("m_iso_b", ORG_B, "cv_iso_b", "in", minutesAgo(30));

    const a = await getDashboardSummary(ORG_A, 30);
    expect(a.stages).toEqual([
      { id: "stg_golden_a_nuevo", name: "Nuevo", conversations: 0 },
      { id: "stg_golden_a_ganado", name: "Ganado", conversations: 0 },
    ]);
    expect(a.firstResponse).toEqual({ medianMinutes: null, p90Minutes: null, answered: 0 });
    expect(a.outgoing).toEqual({ ai: 1, human: 0 });
    expect(a.handoffs).toEqual([]);
    expect(a.conversions).toEqual({ won: 0 });
    expect(a.daily).toEqual([{ date: isoDay(nowDate()), inbound: 0, outbound: 1 }]);

    const b = await getDashboardSummary(ORG_B, 30);
    expect(b.stages).toEqual([
      { id: "stg_golden_b_nuevo", name: "Nuevo", conversations: 0 },
      { id: "stg_golden_b_ganado", name: "Ganado", conversations: 0 },
    ]);
    expect(b.outgoing).toEqual({ ai: 0, human: 0 });
    expect(b.daily).toEqual([{ date: isoDay(nowDate()), inbound: 1, outbound: 0 }]);
  });
});
