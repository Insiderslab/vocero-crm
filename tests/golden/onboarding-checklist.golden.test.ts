import { describe, expect, it } from "vitest";
import { getSql } from "@/lib/db";
import { getOnboardingChecklist } from "@/server/onboarding/checklist";
import { ORG_A, ORG_B } from "./setup";

/**
 * 010 — checklist de primer avvio (specs/custom-heili/010-sintesi-e-primo-avvio.md).
 *
 * Aserciones EXPLÍCITAS: PostgreSQL real y organización B para el aislamiento.
 * El arnés siembra A y B con una conexión de WhatsApp `connected`, así que el
 * paso 1 nace hecho; el resto se construye caso por caso.
 */

const sql = () => getSql();

async function setCredentials(
  org: string,
  status: "connected" | "reconnect_required",
  appDisconnectedAt: Date | null
) {
  await sql()`
    update meta_credentials
    set status = ${status}, app_disconnected_at = ${appDisconnectedAt?.toISOString() ?? null}::timestamp
    where organization_id = ${org}
  `;
}

describe("010 checklist — organización recién creada", () => {
  it("solo el WhatsApp conectado (sembrado por el arnés); nada más", async () => {
    const a = await getOnboardingChecklist(ORG_A);
    expect(a).toEqual({
      whatsappConnected: true,
      templateApproved: false,
      agentConfigured: false,
      labRunDone: false,
      agentEnabled: false,
      allDone: false,
    });
    expect((await getOnboardingChecklist(ORG_B)).allDone).toBe(false);
  });
});

describe("010 checklist — plantilla aprobada", () => {
  it("aprobada cuenta; rejected no; B queda fuera", async () => {
    await sql()`
      insert into template (id, organization_id, name, language, category, body, status)
      values ('tpl_ok', ${ORG_A}, 'seguimiento', 'es', 'marketing', 'Hola {{1}}', 'approved')
    `;
    await sql()`
      insert into template (id, organization_id, name, language, category, body, status)
      values ('tpl_no', ${ORG_B}, 'seguimiento', 'es', 'marketing', 'Hola {{1}}', 'rejected')
    `;

    expect((await getOnboardingChecklist(ORG_A)).templateApproved).toBe(true);
    expect((await getOnboardingChecklist(ORG_B)).templateApproved).toBe(false);
  });
});

describe("010 checklist — agente configurado", () => {
  it("pide instrucciones no vacías Y al menos una entrada de KB", async () => {
    await sql()`insert into agent_profile (id, organization_id) values ('agp_a', ${ORG_A})`;
    await sql()`
      insert into kb_entry (id, organization_id, kind, question, answer)
      values ('kb_a', ${ORG_A}, 'qa', '¿Horario?', 'De 9 a 18')
    `;
    expect((await getOnboardingChecklist(ORG_A)).agentConfigured).toBe(false); // sin instrucciones

    await sql()`update agent_profile set instructions = '   ' where id = 'agp_a'`;
    expect((await getOnboardingChecklist(ORG_A)).agentConfigured).toBe(false); // en blanco no cuenta

    await sql()`update agent_profile set instructions = 'Atiende con tono cercano' where id = 'agp_a'`;
    expect((await getOnboardingChecklist(ORG_A)).agentConfigured).toBe(true);
  });

  it("con instrucciones pero sin KB sigue pendiente (y B no se contamina)", async () => {
    await sql()`
      insert into agent_profile (id, organization_id, instructions)
      values ('agp_a2', ${ORG_A}, 'Atiende pedidos')
    `;
    expect((await getOnboardingChecklist(ORG_A)).agentConfigured).toBe(false);
    expect((await getOnboardingChecklist(ORG_B)).agentConfigured).toBe(false);

    await sql()`
      insert into kb_entry (id, organization_id, kind, content)
      values ('kb_block_a', ${ORG_A}, 'block', 'Devoluciones: 30 días')
    `;
    expect((await getOnboardingChecklist(ORG_A)).agentConfigured).toBe(true);
  });
});

describe("010 checklist — evaluación en el Laboratorio", () => {
  it("solo una corrida terminada cuenta; running y failed no", async () => {
    await sql()`insert into agent_test_run (id, organization_id, status) values ('run_f', ${ORG_A}, 'failed')`;
    expect((await getOnboardingChecklist(ORG_A)).labRunDone).toBe(false);

    await sql()`insert into agent_test_run (id, organization_id, status) values ('run_ok', ${ORG_A}, 'done')`;
    expect((await getOnboardingChecklist(ORG_A)).labRunDone).toBe(true);

    await sql()`insert into agent_test_run (id, organization_id, status) values ('run_b', ${ORG_B}, 'running')`;
    expect((await getOnboardingChecklist(ORG_B)).labRunDone).toBe(false);
  });
});

describe("010 checklist — agente encendido y allDone", () => {
  it("allDone solo con los cinco pasos; completar A no cambia B", async () => {
    await sql()`
      insert into agent_profile (id, organization_id, instructions)
      values ('agp_a', ${ORG_A}, 'Atiende')
    `;
    await sql()`
      insert into kb_entry (id, organization_id, kind, question, answer)
      values ('kb_a', ${ORG_A}, 'qa', '¿Horario?', 'De 9 a 18')
    `;
    await sql()`
      insert into template (id, organization_id, name, language, category, body, status)
      values ('tpl_ok', ${ORG_A}, 'seguimiento', 'es', 'marketing', 'Hola {{1}}', 'approved')
    `;
    await sql()`insert into agent_test_run (id, organization_id, status) values ('run_ok', ${ORG_A}, 'done')`;

    let a = await getOnboardingChecklist(ORG_A);
    expect(a.agentEnabled).toBe(false);
    expect(a.allDone).toBe(false);

    await sql()`update agent_profile set enabled = true where id = 'agp_a'`;
    a = await getOnboardingChecklist(ORG_A);
    expect(a).toEqual({
      whatsappConnected: true,
      templateApproved: true,
      agentConfigured: true,
      labRunDone: true,
      agentEnabled: true,
      allDone: true,
    });

    expect((await getOnboardingChecklist(ORG_B)).allDone).toBe(false);
  });
});

describe("010 checklist — conexión caída", () => {
  it("reconnect_required o coexistence cortada no cuentan como conexión activa", async () => {
    await setCredentials(ORG_A, "reconnect_required", null);
    expect((await getOnboardingChecklist(ORG_A)).whatsappConnected).toBe(false);

    await setCredentials(ORG_A, "connected", new Date());
    expect((await getOnboardingChecklist(ORG_A)).whatsappConnected).toBe(false);

    await setCredentials(ORG_A, "connected", null);
    expect((await getOnboardingChecklist(ORG_A)).whatsappConnected).toBe(true);
  });
});
