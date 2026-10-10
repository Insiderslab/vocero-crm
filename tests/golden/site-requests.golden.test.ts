import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { getSql } from "@/lib/db";
import { resetRateLimit } from "@/lib/rate-limit";
import { OPTIONS, POST } from "@/app/api/public/site-requests/route";
import { runAgentTurn } from "@/server/ai/pipeline";
import { revokeSiteKey, rotateSiteKey, setAllowedOrigins } from "@/server/site-requests/config";
import { MAX_BODY_BYTES, SITE_IP_LIMIT } from "@/server/site-requests/validation";
import { API_KEY_SCOPES } from "@/server/api-keys";
import { waFixture } from "./fixtures/whatsapp";
import { aiWillReply, conversationIdOf, postWebhook, recordedRequests, settle } from "./harness";
import { ORG_A, ORG_B } from "./setup";

// IA configurada (proveedor sintético) y sin espera de coalesce, como
// agent.golden: así un turno del agente, si se disparara, se vería.
vi.hoisted(() => {
  process.env.OPENROUTER_API_TOKEN = "sk-or-golden-synthetic-token";
  process.env.OPENROUTER_MODEL = "golden/modelo-sintetico";
  process.env.AGENT_COALESCE_MS = "0";
});

/**
 * 008 — Solicitudes del sitio web (specs/custom-heili/008-richieste-dal-sito.md).
 * Aserciones EXPLÍCITAS (sin instantánea): ningún golden existente cambia.
 * PostgreSQL real, gestor verdadero de la ruta pública.
 */

const sql = () => getSql();
const ORIGIN_A = "https://labambola.example";
const ORIGIN_B = "https://negocio-b.example";
const ANA = "525512345678"; // inbound-text-mx (5215512345678 normalizado)

let keyA = "";
let keyB = "";

beforeEach(async () => {
  resetRateLimit();
  keyA = (await rotateSiteKey(ORG_A, "u_golden")).key;
  keyB = (await rotateSiteKey(ORG_B, "u_golden")).key;
  await setAllowedOrigins(ORG_A, [ORIGIN_A]);
  await setAllowedOrigins(ORG_B, [ORIGIN_B]);
});

type Opts = {
  key?: string | null;
  origin?: string | null;
  ip?: string;
  raw?: string;
  contentType?: string;
  headers?: Record<string, string>;
};

async function send(body: unknown, opts: Opts = {}) {
  const headers: Record<string, string> = {
    "content-type": opts.contentType ?? "application/json",
    "x-forwarded-for": opts.ip ?? "203.0.113.10",
    ...(opts.headers ?? {}),
  };
  const key = opts.key === undefined ? keyA : opts.key;
  if (key !== null) headers["x-site-key"] = key;
  const origin = opts.origin === undefined ? ORIGIN_A : opts.origin;
  if (origin !== null) headers.origin = origin;
  const res = await POST(
    new Request("http://localhost:3000/api/public/site-requests", {
      method: "POST",
      headers,
      body: opts.raw ?? JSON.stringify(body),
    })
  );
  await settle();
  const text = await res.text();
  return {
    status: res.status,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : null,
    acao: res.headers.get("access-control-allow-origin"),
  };
}

async function preflight(origin: string | null, ip = "203.0.113.50") {
  const headers: Record<string, string> = {
    "access-control-request-method": "POST",
    "access-control-request-headers": "content-type,x-site-key",
    "x-forwarded-for": ip,
  };
  if (origin) headers.origin = origin;
  const res = await OPTIONS(
    new Request("http://localhost:3000/api/public/site-requests", { method: "OPTIONS", headers })
  );
  return { status: res.status, headers: Object.fromEntries(res.headers.entries()) };
}

const form = (patch: Record<string, unknown> = {}) => ({
  name: "Lucía Marín",
  phone: "+58 412 555 0101",
  email: "lucia@example.com",
  message: "Hola, queremos el tour en barco del sábado para 4 personas",
  pageUrl: "https://labambola.example/reservas",
  locale: "es",
  fields: { personas: "4" },
  ...patch,
});
const LUCIA = "584125550101";

async function counts() {
  const [row] = await sql()<
    { contacts: number; conversations: number; messages: number; leads: number; identities: number }[]
  >`
    select (select count(*)::int from contact) as contacts,
           (select count(*)::int from conversation) as conversations,
           (select count(*)::int from message) as messages,
           (select count(*)::int from lead) as leads,
           (select count(*)::int from contact_identity) as identities
  `;
  return row!;
}

async function contactOf(org: string, waIdentity: string) {
  const rows = await sql()<
    {
      id: string;
      wa_identity: string;
      phone: string | null;
      email: string | null;
      name: string;
      source: string | null;
    }[]
  >`select id, wa_identity, phone, email, name, source from contact
    where organization_id = ${org} and wa_identity = ${waIdentity}`;
  return rows[0];
}

async function legacyCheck(): Promise<Record<string, number>> {
  const rows = await sql()<{ verifica: string; anomalie: string }[]>`
    select verifica, anomalie from channels_legacy_check()
  `;
  return Object.fromEntries(rows.map((r) => [r.verifica, Number(r.anomalie)]));
}

async function enableAgent(org: string) {
  await sql()`
    insert into agent_profile (id, organization_id, enabled, name)
    values (${`agp_site_${org}`}, ${org}, true, 'Asistente')
  `;
}

const aiCalls = () => recordedRequests().filter((r) => r.to === "ai");
const graphCalls = () => recordedRequests().filter((r) => r.to === "graph" || r.to === "wapi");

describe("008 crear vs reutilizar el contacto", () => {
  it("contacto nuevo: fuente sito, identidad WhatsApp, conversación no leída, mensaje web, lead en la 1.ª etapa, SSE", async () => {
    const r = await send(form());
    expect(r).toEqual({ status: 202, body: { ok: true }, acao: ORIGIN_A });

    const c = await contactOf(ORG_A, LUCIA);
    expect(c).toMatchObject({
      wa_identity: LUCIA,
      phone: LUCIA,
      email: "lucia@example.com",
      name: "Lucía Marín",
      source: "sito",
    });
    const ids = await sql()`select channel, external_id from contact_identity where contact_id = ${c!.id}`;
    expect(ids).toEqual([{ channel: "whatsapp", external_id: LUCIA }]);

    const cv = await conversationIdOf(ORG_A, LUCIA);
    const [conv] = await sql()<
      { unread_count: number; last_inbound_at: Date | null; last_message_at: Date | null; channel_account_id: string | null }[]
    >`select unread_count, last_inbound_at, last_message_at, channel_account_id from conversation where id = ${cv}`;
    expect(conv!.unread_count).toBe(1);
    expect(conv!.last_inbound_at).toBeNull(); // la ventana de 24 h NO se abre
    expect(conv!.last_message_at).not.toBeNull();
    expect(conv!.channel_account_id).not.toBeNull(); // V4: la cuenta WA de A, como toda conversación real

    const msgs = await sql()<
      { direction: string; channel: string; type: string; wa_message_id: string | null; external_message_id: string | null; text: string; status: string }[]
    >`select direction, channel, type, wa_message_id, external_message_id, text, status from message where conversation_id = ${cv}`;
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({
      direction: "in",
      channel: "web",
      type: "text",
      wa_message_id: null,
      external_message_id: null,
      status: "delivered",
    });
    expect(msgs[0]!.text).toBe(
      [
        "Solicitud desde el sitio web",
        "Nombre: Lucía Marín",
        `Teléfono: +${LUCIA}`,
        "Email: lucia@example.com",
        "",
        "Hola, queremos el tour en barco del sábado para 4 personas",
        "",
        "personas: 4",
        "",
        "Página: https://labambola.example/reservas",
      ].join("\n")
    );

    const leads = await sql()`select stage_id from lead where contact_id = ${c!.id}`;
    expect(leads).toEqual([{ stage_id: "stg_golden_a_nuevo" }]);
    const events = await sql()`select to_stage_name, source from lead_stage_event where contact_id = ${c!.id}`;
    expect(events).toEqual([{ to_stage_name: "Nuevo", source: "sistema" }]);

    expect(graphCalls()).toEqual([]);
    expect(await legacyCheck()).toEqual({ V1: 0, V2: 0, V3: 0, V4: 0, V5: 0, V6: 0 });
  });

  it("los eventos SSE son los de la bandeja, solo en A, y el mensaje viaja con channel web", async () => {
    const { subscribe } = await import("@/server/events/bus");
    const seen: { org: string; type: string; data: unknown }[] = [];
    const offA = subscribe(ORG_A, (e) => seen.push({ org: ORG_A, type: e.type, data: e.data }));
    const offB = subscribe(ORG_B, (e) => seen.push({ org: ORG_B, type: e.type, data: e.data }));
    await send(form());
    offA();
    offB();
    expect(seen.map((e) => `${e.org}:${e.type}`)).toEqual([
      `${ORG_A}:message.new`,
      `${ORG_A}:conversation.updated`,
    ]);
    expect((seen[0]!.data as { message: Record<string, unknown> }).message).toMatchObject({
      direction: "in",
      channel: "web",
      type: "text",
    });
  });

  it("contacto existente por teléfono (forma 521): mismo contacto y conversación; phone, wa_identity, email y nombre NO cambian", async () => {
    await enableAgent(ORG_A);
    aiWillReply('{"action":"none"}');
    await postWebhook(waFixture("inbound-text-mx")); // Ana escribe por WhatsApp (ventana abierta)
    await sql()`update contact set email = 'ana@original.example' where wa_identity = ${ANA}`;
    const before = await contactOf(ORG_A, ANA);
    const aiBefore = aiCalls().length;
    const n0 = await counts();

    const r = await send(
      form({ name: "Otra Persona", phone: "+52 1 55 1234 5678", email: "atacante@example.com" })
    );
    expect(r.status).toBe(202);

    expect(await contactOf(ORG_A, ANA)).toEqual(before); // identidad intacta
    const n1 = await counts();
    expect(n1).toEqual({ ...n0, messages: n0.messages + 1 }); // ni contacto, ni conversación, ni lead, ni identidad nuevos

    const cv = await conversationIdOf(ORG_A, ANA);
    const [conv] = await sql()<{ unread_count: number }[]>`select unread_count from conversation where id = ${cv}`;
    expect(conv!.unread_count).toBe(2);
    const [web] = await sql()<{ text: string }[]>`
      select text from message where conversation_id = ${cv} and channel = 'web'`;
    expect(web!.text).toContain("Nombre: Otra Persona");
    expect(web!.text).toContain("Email: atacante@example.com");
    const [lead] = await sql()<{ last_activity_at: Date }[]>`
      select last_activity_at from lead where contact_id = ${before!.id}`;
    expect(lead!.last_activity_at).not.toBeNull();

    // Ni con la ventana abierta y el agente encendido: ningún turno nuevo.
    expect(aiCalls().length).toBe(aiBefore);
    expect(graphCalls().filter((g) => g.method === "POST")).toEqual([]);
  });

  it("contacto existente por email (solo email): se reutiliza y no se le añade teléfono", async () => {
    await send(form({ phone: "+58 412 555 0202", email: "marco@example.com", name: "Marco" }));
    const marco = await contactOf(ORG_A, "584125550202");
    const n0 = await counts();

    const r = await send(form({ phone: "", email: "MARCO@example.com", name: "Marco bis" }), { ip: "203.0.113.11" });
    expect(r.status).toBe(202);
    expect(await counts()).toEqual({ ...n0, messages: n0.messages + 1 });
    expect(await contactOf(ORG_A, "584125550202")).toEqual(marco);
  });

  it("teléfono nuevo + email de un contacto existente: mensaje a ese contacto; el teléfono nuevo NO se le escribe", async () => {
    await send(form({ phone: "+58 412 555 0303", email: "eva@example.com", name: "Eva" }));
    const eva = await contactOf(ORG_A, "584125550303");
    const n0 = await counts();
    await send(form({ phone: "+58 412 555 0404", email: "eva@example.com" }), { ip: "203.0.113.12" });
    expect(await counts()).toEqual({ ...n0, messages: n0.messages + 1 });
    expect(await contactOf(ORG_A, "584125550303")).toEqual(eva);
    expect(await contactOf(ORG_A, "584125550404")).toBeUndefined();
  });

  it("solo email y ningún contacto con ese email: 422 phone_required, nada escrito (spec D1)", async () => {
    const n0 = await counts();
    const r = await send(form({ phone: undefined, email: "nuevo@example.com" }));
    expect(r.status).toBe(422);
    expect((r.body?.error as { code: string }).code).toBe("phone_required");
    expect(r.acao).toBe(ORIGIN_A); // el sitio puede leer el motivo
    expect(await counts()).toEqual(n0);
  });

  it("contacto archivado: vuelve a la bandeja", async () => {
    await send(form());
    await sql()`update contact set archived_at = now() where wa_identity = ${LUCIA}`;
    await send(form(), { ip: "203.0.113.13" });
    const [row] = await sql()<{ archived_at: Date | null }[]>`select archived_at from contact where wa_identity = ${LUCIA}`;
    expect(row!.archived_at).toBeNull();
  });
});

describe("008 aislamiento entre organizaciones", () => {
  it("la clave de A escribe SOLO en A, aunque el mismo teléfono exista en B", async () => {
    await postWebhook(waFixture("inbound-text-b")); // contacto en B
    const [bContact] = await sql()<{ wa_identity: string }[]>`
      select wa_identity from contact where organization_id = ${ORG_B}`;
    const bBefore = await sql()`select * from contact where organization_id = ${ORG_B} order by id`;
    const bMsgs = await sql()`select id from message where organization_id = ${ORG_B}`;

    const r = await send(form({ phone: `+${bContact!.wa_identity}` }));
    expect(r.status).toBe(202);

    expect(await contactOf(ORG_A, bContact!.wa_identity)).toMatchObject({ source: "sito" });
    expect(await sql()`select * from contact where organization_id = ${ORG_B} order by id`).toEqual(bBefore);
    expect(await sql()`select id from message where organization_id = ${ORG_B}`).toEqual(bMsgs);
  });

  it("el body no puede elegir organización (strict → 422, nada escrito)", async () => {
    const n0 = await counts();
    const r = await send({ ...form(), organizationId: ORG_B });
    expect(r.status).toBe(422);
    expect(await counts()).toEqual(n0);
  });

  it("la clave de B desde el origen de B escribe en B", async () => {
    const r = await send(form(), { key: keyB, origin: ORIGIN_B });
    expect(r.status).toBe(202);
    expect(await contactOf(ORG_B, LUCIA)).toBeDefined();
    expect(await contactOf(ORG_A, LUCIA)).toBeUndefined();
  });
});

describe("008 claves", () => {
  it("revocada → 401 y nada escrito", async () => {
    await revokeSiteKey(ORG_A);
    const n0 = await counts();
    const r = await send(form());
    expect(r.status).toBe(401);
    expect(r.acao).toBeNull();
    expect(await counts()).toEqual(n0);
  });

  it("rotada: la vieja → 401, la nueva funciona; una sola activa por organización", async () => {
    const old = keyA;
    const fresh = (await rotateSiteKey(ORG_A, "u_golden")).key;
    expect((await send(form(), { key: old })).status).toBe(401);
    expect((await send(form(), { key: fresh, ip: "203.0.113.14" })).status).toBe(202);
    const [row] = await sql()<{ n: number }[]>`
      select count(*)::int as n from bot_api_key
      where organization_id = ${ORG_A} and scope = 'site' and revoked_at is null`;
    expect(row!.n).toBe(1);
  });

  it("sin clave, inventada, o una clave de bot → 401", async () => {
    expect((await send(form(), { key: null })).status).toBe(401);
    expect((await send(form(), { key: "vsk_inventada" })).status).toBe(401);
    expect((await send(form(), { key: "vbk_algo", headers: { "x-api-key": keyA } })).status).toBe(401);
    expect(await counts()).toMatchObject({ contacts: 0, messages: 0 });
  });

  it("la clave jamás aparece en los registros (ni en éxito ni en error)", async () => {
    await send(form());
    await send(form({ website: "bot" }), { ip: "203.0.113.15" });
    await send({ name: "x" }, { ip: "203.0.113.16" });
    await revokeSiteKey(ORG_A);
    await send(form(), { ip: "203.0.113.17" });
    const logged = JSON.stringify(
      [console.log, console.warn, console.error].flatMap((f) => (f as unknown as Mock).mock.calls)
    );
    expect(logged).not.toContain(keyA);
    expect(logged).not.toContain(keyA.slice(4));
    expect(logged).toContain("honeypot"); // el registro existe: solo no lleva la clave
  });
});

describe("008 CORS", () => {
  it("preflight: origen autorizado (por alguna organización) → 204 con cabeceras; otro → 403 sin CORS", async () => {
    const ok = await preflight(ORIGIN_A);
    expect(ok.status).toBe(204);
    expect(ok.headers).toMatchObject({
      "access-control-allow-origin": ORIGIN_A,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type, x-site-key",
      vary: "Origin",
    });
    for (const o of ["https://evil.example", "null", null, "https://LABAMBOLA.example"]) {
      const r = await preflight(o);
      expect(r.status).toBe(403);
      expect(r.headers["access-control-allow-origin"]).toBeUndefined();
    }
  });

  it("POST con la clave de A desde el origen de B → 403 origin_not_allowed, nada escrito", async () => {
    const n0 = await counts();
    const r = await send(form(), { origin: ORIGIN_B });
    expect(r.status).toBe(403);
    expect((r.body?.error as { code: string }).code).toBe("origin_not_allowed");
    expect(r.acao).toBeNull();
    expect(await counts()).toEqual(n0);
  });

  it("organización sin orígenes: desde un navegador → 403; sin Origin (servidor) → 202 sin CORS", async () => {
    await setAllowedOrigins(ORG_A, []);
    expect((await send(form())).status).toBe(403);
    expect(await preflight(ORIGIN_A)).toMatchObject({ status: 403 });
    const server = await send(form(), { origin: null });
    expect(server).toMatchObject({ status: 202, acao: null });
  });
});

describe("008 protecciones", () => {
  it("honeypot: misma respuesta que el éxito y nada escrito ni publicado", async () => {
    const n0 = await counts();
    const r = await send(form({ website: "https://spam.example" }));
    expect(r).toEqual({ status: 202, body: { ok: true }, acao: ORIGIN_A });
    expect(await counts()).toEqual(n0);
  });

  it("límite por IP: la 11.ª solicitud en 10 minutos → 429; otra IP sigue", async () => {
    expect(SITE_IP_LIMIT.max).toBe(10);
    for (let i = 0; i < SITE_IP_LIMIT.max; i++) {
      expect((await send(form({ message: `m${i}` }), { ip: "198.51.100.1" })).status).toBe(202);
    }
    const n0 = await counts();
    const r = await send(form({ message: "una más" }), { ip: "198.51.100.1" });
    expect(r.status).toBe(429);
    expect(await counts()).toEqual(n0);
    expect((await send(form({ message: "otra ip" }), { ip: "198.51.100.2" })).status).toBe(202);
  });

  it("límite por clave: 30 por minuto aunque cambie la IP → 429; la clave de B sigue", async () => {
    const { max } = API_KEY_SCOPES.site.rateLimit;
    for (let i = 0; i < max; i++) {
      expect((await send(form({ message: `k${i}` }), { ip: `192.0.2.${i + 1}` })).status).toBe(202);
    }
    const n0 = await counts();
    expect((await send(form(), { ip: "192.0.2.200" })).status).toBe(429);
    expect(await counts()).toEqual(n0);
    expect((await send(form(), { key: keyB, origin: ORIGIN_B, ip: "192.0.2.201" })).status).toBe(202);
  });

  it("body: > 16 KiB → 413 (declarado o real); no JSON → 415; JSON roto → 422", async () => {
    const big = JSON.stringify(form({ message: "x".repeat(MAX_BODY_BYTES) }));
    expect((await send(null, { raw: big })).status).toBe(413);
    expect((await send(null, { raw: big, ip: "203.0.113.20", headers: { "content-length": "100" } })).status).toBe(413);
    expect((await send(form(), { contentType: "text/plain", ip: "203.0.113.21" })).status).toBe(415);
    expect((await send(null, { raw: "{no json", ip: "203.0.113.22" })).status).toBe(422);
    expect(await counts()).toMatchObject({ contacts: 0, messages: 0 });
  });
});

describe("008 el agente no contesta a una solicitud web", () => {
  it("agente encendido + IA configurada: ni llamada al modelo, ni envío por Graph, ni handoff", async () => {
    await enableAgent(ORG_A);
    aiWillReply('{"action":"reply","text":"¡Hola! Te escribo por WhatsApp"}');
    await send(form());
    expect(aiCalls()).toEqual([]);
    expect(graphCalls()).toEqual([]);
    const cv = await conversationIdOf(ORG_A, LUCIA);
    const [conv] = await sql()<{ handoff_at: Date | null; ai_enabled: boolean }[]>`
      select handoff_at, ai_enabled from conversation where id = ${cv}`;
    expect(conv).toEqual({ handoff_at: null, ai_enabled: true });
    const out = await sql()`select id from message where conversation_id = ${cv} and direction = 'out'`;
    expect(out).toEqual([]);
  });

  it("aunque alguien dispare el turno (runAgentTurn) sobre una conversación solo-web: nada (ni handoff «ventana»)", async () => {
    await enableAgent(ORG_A);
    aiWillReply('{"action":"reply","text":"respuesta indebida"}');
    await send(form());
    const cv = await conversationIdOf(ORG_A, LUCIA);
    await runAgentTurn(cv);
    await settle();
    expect(aiCalls()).toEqual([]);
    expect(graphCalls()).toEqual([]);
    const [conv] = await sql()<{ handoff_at: Date | null }[]>`select handoff_at from conversation where id = ${cv}`;
    expect(conv!.handoff_at).toBeNull();
  });

  it("conversación con WhatsApp y luego una solicitud web: el turno contesta al WhatsApp y la solicitud web NO va al modelo", async () => {
    await enableAgent(ORG_A);
    aiWillReply('{"action":"none"}');
    await postWebhook(waFixture("inbound-text-mx"));
    await send(form({ phone: "+52 1 55 1234 5678", message: "MENSAJE-WEB-PRIVADO" }));
    aiWillReply('{"action":"reply","text":"Hola Ana"}');
    await runAgentTurn(await conversationIdOf(ORG_A, ANA));
    await settle();
    const calls = aiCalls();
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(calls[1]!.body)).toContain("Hola, quiero información");
    expect(JSON.stringify(calls.map((c) => c.body))).not.toContain("MENSAJE-WEB-PRIVADO");
  });
});
