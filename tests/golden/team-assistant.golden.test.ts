import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, getSql } from "@/lib/db";
import { removeDemo, seedDemo } from "@/server/seed/demo";
import { waFixture } from "./fixtures/whatsapp";
import { aiWillReply, conversationIdOf, postWebhook, recordedRequests } from "./harness";
import { ORG_A, ORG_B } from "./setup";

// IA configurada (proveedor sintético) y sin espera de coalesce, como agent.golden.
vi.hoisted(() => {
  process.env.OPENROUTER_API_TOKEN = "sk-or-golden-synthetic-token";
  process.env.OPENROUTER_MODEL = "golden/modelo-sintetico";
  process.env.AGENT_COALESCE_MS = "0";
});

/**
 * 007 — Asistente interno (specs/custom-heili/007-assistente-interno.md).
 * Aserciones EXPLÍCITAS (sin instantánea): este archivo no cambia ningún
 * golden de comportamiento existente. PostgreSQL real, gestores verdaderos.
 */

const sql = () => getSql();
const ANA = "525512345678"; // inbound-text-mx (5215512345678 normalizado)
const OUTSIDER_REPLY = "Este número es de uso interno del equipo.";

async function profile(opts: {
  restrict: boolean;
  allowed?: string[];
  outsiderReply?: string | null;
}): Promise<void> {
  await sql()`
    insert into agent_profile (id, organization_id, enabled, name, restrict_to_allowlist, allowed_identities, outsider_reply)
    values ('agp_team_a', ${ORG_A}, true, 'Asistente del equipo', ${opts.restrict},
            ${opts.allowed ?? []}, ${opts.outsiderReply ?? null})
  `;
  await sql()`
    insert into kb_entry (id, organization_id, kind, question, answer)
    values ('kb_team_secreto', ${ORG_A}, 'qa', '¿Clave del almacén?', 'SECRETO-INTERNO-42')
  `;
}

const aiCalls = () => recordedRequests().filter((r) => r.to === "ai");
const graphSends = () =>
  recordedRequests().filter((r) => r.to === "graph" && r.method === "POST" && /\/messages$/.test(r.path));

async function outbound(conversationId: string) {
  return sql()<{ text: string | null; ai_generated: boolean; origin: string }[]>`
    select text, ai_generated, origin from message
    where conversation_id = ${conversationId} and direction = 'out' order by created_at
  `;
}

async function legacyCheck(): Promise<Record<string, number>> {
  const rows = await sql()<{ verifica: string; anomalie: string }[]>`
    select verifica, anomalie from channels_legacy_check()
  `;
  return Object.fromEntries(rows.map((r) => [r.verifica, Number(r.anomalie)]));
}

describe("007 acceso reservado", () => {
  it("externo: sin IA ni KB; la respuesta fija UNA vez por conversación, por Graph", async () => {
    await profile({ restrict: true, allowed: ["393471234567"], outsiderReply: OUTSIDER_REPLY });
    aiWillReply('{"action":"reply","text":"SECRETO-INTERNO-42"}');

    await postWebhook(waFixture("inbound-text-mx"));
    await postWebhook(waFixture("inbound-text-mx-again"));

    expect(aiCalls()).toHaveLength(0);
    const sends = graphSends();
    expect(sends).toHaveLength(1);
    expect(sends[0]?.body).toMatchObject({ to: ANA, type: "text", text: { body: OUTSIDER_REPLY } });
    expect(JSON.stringify(recordedRequests())).not.toContain("SECRETO-INTERNO-42");

    const cv = await conversationIdOf(ORG_A, ANA);
    expect(await outbound(cv)).toEqual([
      { text: OUTSIDER_REPLY, ai_generated: true, origin: "ai" },
    ]);
    // Ni handoff: el operador ve la conversación en la bandeja como siempre.
    const [conv] = await sql()<{ handoff_at: Date | null; ai_enabled: boolean }[]>`
      select handoff_at, ai_enabled from conversation where id = ${cv}
    `;
    expect(conv).toEqual({ handoff_at: null, ai_enabled: true });
  });

  it("externo sin respuesta configurada: silencio total (ni IA ni Graph)", async () => {
    await profile({ restrict: true, allowed: ["393471234567"], outsiderReply: null });
    await postWebhook(waFixture("inbound-text-mx"));
    expect(aiCalls()).toHaveLength(0);
    expect(graphSends()).toHaveLength(0);
  });

  it("número de la lista (forma 521 → 52): el agente normal responde", async () => {
    await profile({ restrict: true, allowed: ["525512345678"], outsiderReply: OUTSIDER_REPLY });
    aiWillReply('{"action":"reply","text":"Hola equipo, la clave es SECRETO-INTERNO-42"}');
    await postWebhook(waFixture("inbound-text-mx"));

    expect(aiCalls()).toHaveLength(1);
    const sends = graphSends();
    expect(sends).toHaveLength(1);
    expect(sends[0]?.body).toMatchObject({ text: { body: "Hola equipo, la clave es SECRETO-INTERNO-42" } });
    expect(JSON.stringify(sends)).not.toContain(OUTSIDER_REPLY);
  });

  it("restricción apagada (por defecto): el agente responde a cualquiera", async () => {
    await profile({ restrict: false, allowed: [], outsiderReply: OUTSIDER_REPLY });
    aiWillReply('{"action":"reply","text":"Respuesta normal"}');
    await postWebhook(waFixture("inbound-text-mx"));
    expect(aiCalls()).toHaveLength(1);
    expect(graphSends().map((r) => r.body)).toMatchObject([{ text: { body: "Respuesta normal" } }]);
  });

  it("contacto solo-BSUID: nunca está en la lista (fail-closed)", async () => {
    await profile({ restrict: true, allowed: ["525512345678"], outsiderReply: null });
    await postWebhook(waFixture("inbound-bsuid-only"));
    expect(aiCalls()).toHaveLength(0);
    expect(graphSends()).toHaveLength(0);
  });

  it("columnas nuevas con sus valores por defecto en un perfil existente", async () => {
    await sql()`insert into agent_profile (id, organization_id) values ('agp_team_default', ${ORG_B})`;
    const [row] = await sql()<{ restrict_to_allowlist: boolean; allowed_identities: string[]; outsider_reply: string | null }[]>`
      select restrict_to_allowlist, allowed_identities, outsider_reply from agent_profile where id = 'agp_team_default'
    `;
    expect(row).toEqual({ restrict_to_allowlist: false, allowed_identities: [], outsider_reply: null });
  });
});

async function demoContacts(org: string): Promise<number> {
  const [row] = await sql()<{ n: number }[]>`
    select count(*)::int as n from contact where organization_id = ${org} and phone like '52156123400%'
  `;
  return row?.n ?? 0;
}

async function count(table: string, org: string): Promise<number> {
  const [row] = await sql().unsafe<{ n: number }[]>(
    `select count(*)::int as n from "${table}" where organization_id = $1`,
    [org]
  );
  return row?.n ?? 0;
}

describe("007 datos demo por organización", () => {
  beforeEach(async () => {
    // La demo coloca leads por nombre de etapa; con "Nuevo" basta (fallback).
    for (const org of [ORG_A, ORG_B]) {
      await sql()`insert into agent_profile (id, organization_id) values (${`agp_demo_${org}`}, ${org})`;
    }
  });

  it("recargar la demo en A NO borra la demo de B (bug de la limpieza sin organización)", async () => {
    await seedDemo(getDb(), ORG_B);
    await seedDemo(getDb(), ORG_A);
    expect(await demoContacts(ORG_B)).toBe(8);
    await seedDemo(getDb(), ORG_A); // recarga (idempotente en A)
    expect(await demoContacts(ORG_A)).toBe(8);
    expect(await demoContacts(ORG_B)).toBe(8);
    expect(await count("conversation", ORG_B)).toBe(8);
    expect(await legacyCheck()).toMatchObject({ V3: 0, V4: 0, V5: 0 });
  });

  it("quitar la demo: solo la de la organización, conserva lo real y el KB editado; V3 = 0", async () => {
    await seedDemo(getDb(), ORG_A);
    await seedDemo(getDb(), ORG_B);
    // Datos reales de A: un contacto que escribe y un KB propio + uno demo editado.
    await postWebhook(waFixture("inbound-text-mx"));
    await sql()`
      insert into kb_entry (id, organization_id, kind, question, answer)
      values ('kb_team_propio', ${ORG_A}, 'qa', '¿Turnos?', 'Lunes a viernes')
    `;
    await sql()`
      update kb_entry set answer = answer || ' (editado)'
      where organization_id = ${ORG_A} and question = '¿Cuál es el horario?'
    `;
    const kbB = await count("kb_entry", ORG_B);

    const result = await removeDemo(getDb(), ORG_A);
    expect(result).toEqual({ contacts: 8, kbEntries: 7 });

    expect(await demoContacts(ORG_A)).toBe(0);
    expect(await count("contact", ORG_A)).toBe(1); // Ana (real)
    expect(await count("conversation", ORG_A)).toBe(1);
    expect(await count("lead", ORG_A)).toBe(1);
    expect(await count("contact_identity", ORG_A)).toBe(1);
    const kbA = await sql()<{ id: string }[]>`select id from kb_entry where organization_id = ${ORG_A} order by id`;
    expect(kbA).toHaveLength(2); // el propio + el demo editado
    expect(kbA.map((r) => r.id)).toContain("kb_team_propio");

    // B intacta.
    expect(await demoContacts(ORG_B)).toBe(8);
    expect(await count("message", ORG_B)).toBeGreaterThan(0);
    expect(await count("kb_entry", ORG_B)).toBe(kbB);

    expect(await legacyCheck()).toMatchObject({ V3: 0, V4: 0, V5: 0 });
    // Idempotente.
    expect(await removeDemo(getDb(), ORG_A)).toEqual({ contacts: 0, kbEntries: 0 });
  });

  it("quitar la demo sin la FK en cascada de la fase B (fase B incompleta): V3 sigue en 0", async () => {
    await seedDemo(getDb(), ORG_A);
    await sql()`alter table contact_identity drop constraint contact_identity_contact_fk`;
    try {
      expect(await removeDemo(getDb(), ORG_A)).toMatchObject({ contacts: 8 });
      expect(await count("contact_identity", ORG_A)).toBe(0);
      expect(await legacyCheck()).toMatchObject({ V3: 0 });
    } finally {
      // La misma definición que la fase B del runner (scripts/migrate-channels.mjs).
      await sql().unsafe(
        'ALTER TABLE "contact_identity" ADD CONSTRAINT "contact_identity_contact_fk" FOREIGN KEY ("organization_id","contact_id") REFERENCES "public"."contact"("organization_id","id") ON DELETE cascade ON UPDATE no action'
      );
    }
  });
});
