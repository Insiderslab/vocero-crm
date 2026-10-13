import { describe, expect, it, vi, type MockInstance } from "vitest";
import { getSql } from "@/lib/db";
import { generateApiKey } from "@/server/api-keys";
import { POST as teamBroadcastPost } from "@/app/api/bot/team-broadcast/route";
import { waFixture } from "./fixtures/whatsapp";
import { graphFails, postWebhook, recordedRequests, recordedSse } from "./harness";
import { FIXED_NOW_MS } from "./normalize";
import { ORG_A, ORG_B, ORGS } from "./setup";

/**
 * 012 — Ronda del team (specs/custom-heili/012-ronda-team.md).
 * Asserzioni ESPLICITE (nessuna istantanea): questo file non cambia nessun
 * golden esistente. PostgreSQL reale, gestori veri (la rotta e `sendTemplate`).
 */

const sql = () => getSql();

const TEAM1 = "393471110001";
const TEAM2 = "393471110002";
const TEAM_B = "393479990009";
const CUSTOMER = "525512345678"; // inbound-text-mx (5215512345678 normalizzato)
const BODY = "Buongiorno {{1}}! Le priorità di oggi: {{2}}. Dettagli su Monday.";
const PRIORITIES = "1) Offerta Rossi · 2) Call Bianchi · 3) Report";
const HOUR = 60 * 60 * 1000;

async function botKey(org: string): Promise<string> {
  const key = generateApiKey("bot");
  await sql()`
    insert into bot_api_key (id, organization_id, label, scope, key_prefix, key_hash, created_by)
    values (${`bk_${org}_${key.prefix}`}, ${org}, 'ronda', 'bot', ${key.prefix}, ${key.hash}, 'golden')
  `;
  return key.plain;
}

async function teamProfile(org: string, restrict: boolean, allowed: string[]): Promise<void> {
  await sql()`
    insert into agent_profile (id, organization_id, restrict_to_allowlist, allowed_identities)
    values (${`agp_${org}`}, ${org}, ${restrict}, ${allowed})
    on conflict (organization_id) do update
      set restrict_to_allowlist = excluded.restrict_to_allowlist,
          allowed_identities = excluded.allowed_identities
  `;
}

async function template(
  org: string,
  opts: { name?: string; language?: string; body?: string; status?: string } = {}
): Promise<void> {
  const name = opts.name ?? "ronda_mattutina";
  const language = opts.language ?? "it";
  await sql()`
    insert into template (id, organization_id, name, language, category, body, status, wa_template_id)
    values (${`tpl_${org}_${name}_${language}`}, ${org}, ${name}, ${language}, 'UTILITY',
            ${opts.body ?? BODY}, ${opts.status ?? "approved"}, ${`wa_${name}_${language}`})
  `;
}

/** Organizzazione A pronta: lista del team, modello approvato, chiave. */
async function readyA(allowed = [TEAM1, TEAM2]): Promise<string> {
  await teamProfile(ORG_A, true, allowed);
  await template(ORG_A);
  return botKey(ORG_A);
}

type Call = { status: number; body: Record<string, unknown>; headers: Headers };

async function call(
  key: string | null,
  body: unknown,
  idempotencyKey: string | null = "ronda-2030-01-01"
): Promise<Call> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key) headers["x-api-key"] = key;
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  const res = await teamBroadcastPost(
    new Request("http://localhost:3000/api/bot/team-broadcast", {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {}, headers: res.headers };
}

const ronda = (extra: Record<string, unknown> = {}) => ({
  templateName: "ronda_mattutina",
  language: "it",
  params: ["team", PRIORITIES],
  ...extra,
});

const graphSends = () =>
  recordedRequests().filter((r) => r.to === "graph" && r.method === "POST" && /\/messages$/.test(r.path));
type TemplatePayload = {
  to: string;
  type: string;
  template: { name: string; language: { code: string }; components: { parameters: { text: string }[] }[] };
};
const sentTo = () => graphSends().map((r) => (r.body as TemplatePayload).to).sort();
const paramsTo = (to: string) =>
  (graphSends().find((r) => (r.body as TemplatePayload).to === to)?.body as TemplatePayload | undefined)
    ?.template.components[0]?.parameters.map((p) => p.text);

async function broadcastRows(org?: string) {
  return org
    ? sql()<{ id: string; status: string; sent: number }[]>`
        select id, status, sent from team_broadcast where organization_id = ${org} order by created_at`
    : sql()<{ id: string; status: string; sent: number }[]>`
        select id, status, sent from team_broadcast order by created_at`;
}

async function outboundOf(org: string, identity: string) {
  return sql()<{ type: string; origin: string; text: string; status: string; wa_message_id: string }[]>`
    select m.type, m.origin, m.text, m.status, m.wa_message_id
    from message m join conversation cv on cv.id = m.conversation_id join contact c on c.id = cv.contact_id
    where m.organization_id = ${org} and c.wa_identity = ${identity} and m.direction = 'out'
    order by m.created_at
  `;
}

async function legacyCheck(): Promise<Record<string, number>> {
  const rows = await sql()<{ verifica: string; anomalie: string }[]>`
    select verifica, anomalie from channels_legacy_check()
  `;
  return Object.fromEntries(rows.map((r) => [r.verifica, Number(r.anomalie)]));
}

/** Tutto ciò che è finito nei log (console.log/warn/error sono spiati dall'arnés). */
function loggedText(): string {
  return [console.log, console.warn, console.error]
    .flatMap((fn) => (fn as unknown as MockInstance).mock.calls)
    .map((args) => args.map(String).join(" "))
    .join("\n");
}

describe("012 ronda del team — destinatari", () => {
  it("solo la lista del team: un cliente della stessa organizzazione non riceve nulla", async () => {
    await postWebhook(waFixture("inbound-text-mx")); // il cliente esiste e ha la finestra aperta
    const key = await readyA();

    const res = await call(key, ronda());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      replayed: false,
      dryRun: false,
      template: { name: "ronda_mattutina", language: "it" },
      total: 2,
      sent: 2,
      failed: 0,
      skipped: 0,
      unknownRecipients: [],
    });
    expect(res.body.results).toEqual([
      { recipient: "…001", status: "sent", messageId: expect.stringMatching(/^msg_/) },
      { recipient: "…002", status: "sent", messageId: expect.stringMatching(/^msg_/) },
    ]);

    // Meta: due modelli, dal numero di A, solo ai numeri del team.
    expect(sentTo()).toEqual([TEAM1, TEAM2]);
    for (const r of graphSends()) {
      expect(r.path).toMatch(new RegExp(`/${ORGS.A.phoneNumberId}/messages$`));
      expect(r.auth).toBe(`Bearer ${ORGS.A.token}`);
      expect(r.body).toMatchObject({
        type: "template",
        template: {
          name: "ronda_mattutina",
          language: { code: "it" },
          components: [{ type: "body", parameters: [{ type: "text", text: "team" }, { type: "text", text: PRIORITIES }] }],
        },
      });
    }
    expect(await outboundOf(ORG_A, CUSTOMER)).toEqual([]);

    // Persistiti e visibili in Posta: modello renderizzato, SSE message.new.
    const rendered = `Buongiorno team! Le priorità di oggi: ${PRIORITIES}. Dettagli su Monday.`;
    for (const id of [TEAM1, TEAM2]) {
      expect(await outboundOf(ORG_A, id)).toEqual([
        { type: "template", origin: "template", text: rendered, status: "pending", wa_message_id: expect.stringMatching(/^wamid\./) },
      ]);
    }
    const newMessages = recordedSse().filter(
      (e) => e.type === "message.new" && e.org === ORG_A && (e.data as { message: { direction: string } }).message.direction === "out"
    );
    expect(newMessages.map((e) => (e.data as { message: { text: string } }).message.text)).toEqual([rendered, rendered]);
    expect(recordedSse().filter((e) => e.org === ORG_B)).toEqual([]);

    // Contatti nuovi con la loro identità (005) e conversazione reale; V1–V6 = 0.
    const contacts = await sql()<{ wa_identity: string; phone: string; identities: number; convs: number }[]>`
      select c.wa_identity, c.phone,
        (select count(*)::int from contact_identity ci where ci.contact_id = c.id and ci.external_id = c.wa_identity) as identities,
        (select count(*)::int from conversation cv where cv.contact_id = c.id and cv.is_test = false and cv.last_message_at is not null) as convs
      from contact c where c.organization_id = ${ORG_A} order by c.wa_identity
    `;
    expect(contacts).toEqual([
      { wa_identity: TEAM1, phone: TEAM1, identities: 1, convs: 1 },
      { wa_identity: TEAM2, phone: TEAM2, identities: 1, convs: 1 },
      { wa_identity: CUSTOMER, phone: CUSTOMER, identities: 1, convs: 1 },
    ]);
    expect(await legacyCheck()).toEqual({ V1: 0, V2: 0, V3: 0, V4: 0, V5: 0, V6: 0 });

    // Registro della ronda, e nessun numero completo né parametro nei log o nella risposta.
    expect(await broadcastRows(ORG_A)).toEqual([{ id: res.body.broadcastId, status: "done", sent: 2 }]);
    const logs = loggedText();
    expect(logs).toContain("ronda");
    for (const secret of [TEAM1, TEAM2, PRIORITIES]) {
      expect(logs).not.toContain(secret);
      expect(JSON.stringify(res.body)).not.toContain(secret);
    }
  });

  it("un collega già in Posta (anche archiviato) riceve la ronda sulla sua conversazione, senza contatti doppi", async () => {
    await postWebhook(waFixture("inbound-text-mx"));
    await sql()`update contact set archived_at = now() where wa_identity = ${CUSTOMER}`;
    const key = await readyA([CUSTOMER]);
    const res = await call(key, ronda());
    expect(res.body).toMatchObject({ sent: 1 });
    expect(sentTo()).toEqual([CUSTOMER]);
    const [c] = await sql()<{ n: number; archived: boolean }[]>`
      select count(*)::int as n, bool_and(archived_at is not null) as archived from contact where organization_id = ${ORG_A}
    `;
    expect(c).toEqual({ n: 1, archived: true }); // nessun contatto nuovo, non riattivato
    expect((await outboundOf(ORG_A, CUSTOMER)).map((m) => m.type)).toEqual(["template"]);
  });

  it("409 no_team_list: senza profilo, con la restrizione spenta, con la lista vuota", async () => {
    await template(ORG_A);
    const key = await botKey(ORG_A);
    const expectNoList = async () => {
      const res = await call(key, ronda());
      expect(res.status).toBe(409);
      expect((res.body.error as { code: string }).code).toBe("no_team_list");
    };
    await expectNoList();
    await teamProfile(ORG_A, false, [TEAM1, TEAM2]);
    await expectNoList();
    await teamProfile(ORG_A, true, []);
    await expectNoList();
    // Anche in dryRun.
    const dry = await call(key, ronda({ dryRun: true }));
    expect(dry.status).toBe(409);
    expect(graphSends()).toEqual([]);
    expect(await broadcastRows()).toEqual([]);
  });

  it("409 team_too_large oltre 50 numeri", async () => {
    const many = Array.from({ length: 51 }, (_, i) => `3934700${String(i).padStart(5, "0")}`);
    const key = await readyA(many);
    const res = await call(key, ronda());
    expect(res.status).toBe(409);
    expect((res.body.error as { code: string }).code).toBe("team_too_large");
    expect(graphSends()).toEqual([]);
  });
});

describe("012 ronda del team — modello e parametri", () => {
  it("422: modello sconosciuto, di un'altra lingua, non approvato, parametri sbagliati", async () => {
    const key = await readyA();
    await template(ORG_A, { name: "ronda_bozza", status: "pending" });
    const codeOf = async (body: unknown) => {
      const res = await call(key, body);
      expect(res.status).toBe(422);
      return (res.body.error as { code: string }).code;
    };
    expect(await codeOf(ronda({ templateName: "non_esiste" }))).toBe("template_not_found");
    expect(await codeOf(ronda({ language: "es" }))).toBe("template_not_found");
    expect(await codeOf(ronda({ templateName: "ronda_bozza" }))).toBe("template_not_approved");
    expect(await codeOf(ronda({ params: ["solo uno"] }))).toBe("template_params_mismatch");
    expect(await codeOf(ronda({ params: ["a", "b", "c"] }))).toBe("template_params_mismatch");
    expect(await codeOf(ronda({ perRecipient: { [`+${TEAM1}`]: ["Marco"] } }))).toBe("template_params_mismatch");
    expect(await codeOf(ronda({ dryRun: true, templateName: "non_esiste" }))).toBe("template_not_found");
    expect(graphSends()).toEqual([]);
    expect(await broadcastRows()).toEqual([]);
  });

  it("parametri su una riga: a capo, tab e spazi multipli arrivano a Meta normalizzati", async () => {
    const key = await readyA([TEAM1]);
    const res = await call(
      key,
      ronda({ params: ["  Marco\n", "1) Offerta\n2)\tCall     Bianchi\r\n3) Report  "] })
    );
    expect(res.status).toBe(200);
    expect(paramsTo(TEAM1)).toEqual(["Marco", "1) Offerta 2) Call Bianchi 3) Report"]);
    const [msg] = await outboundOf(ORG_A, TEAM1);
    expect(msg?.text).toBe("Buongiorno Marco! Le priorità di oggi: 1) Offerta 2) Call Bianchi 3) Report. Dettagli su Monday.");
    for (const p of paramsTo(TEAM1) ?? []) {
      expect(p).not.toMatch(/[\n\t]| {4,}/);
    }
  });

  it("422 invalid_body: parametro vuoto dopo la normalizzazione, oltre 1024, campo sconosciuto", async () => {
    const key = await readyA([TEAM1]);
    for (const body of [
      ronda({ params: ["team", " \n\t "] }),
      ronda({ params: ["team", "x".repeat(1025)] }),
      ronda({ organizationId: ORG_B }),
      ronda({ recipients: [CUSTOMER] }),
    ]) {
      const res = await call(key, body);
      expect(res.status).toBe(422);
      expect((res.body.error as { code: string }).code).toBe("invalid_body");
    }
    expect(graphSends()).toEqual([]);
  });

  it("perRecipient: ognuno i suoi parametri, gli altri quelli di default; fuori lista ignorato", async () => {
    const key = await readyA([TEAM1, TEAM2]);
    const res = await call(
      key,
      ronda({
        perRecipient: {
          "+39 347 111 0001": ["Marco", "1) Offerta Rossi"],
          [CUSTOMER]: ["Cliente", "non deve arrivare"],
        },
      })
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ sent: 2, unknownRecipients: ["…678"] });
    expect(paramsTo(TEAM1)).toEqual(["Marco", "1) Offerta Rossi"]);
    expect(paramsTo(TEAM2)).toEqual(["team", PRIORITIES]);
    expect(sentTo()).toEqual([TEAM1, TEAM2]);
    expect(JSON.stringify(recordedRequests())).not.toContain("non deve arrivare");

    const bad = await call(key, ronda({ perRecipient: { "347 111 0001": ["a", "b"] } }), "altra-chiave");
    expect(bad.status).toBe(422);
    const dup = await call(
      key,
      ronda({ perRecipient: { "+393471110001": ["a", "b"], "393471110001": ["c", "d"] } }),
      "altra-chiave-2"
    );
    expect(dup.status).toBe(422);
  });
});

describe("012 ronda del team — idempotenza, limite, dryRun", () => {
  it("400 senza Idempotency-Key, 401 senza chiave bot o con chiave revocata", async () => {
    const key = await readyA();
    const noIdem = await call(key, ronda(), null);
    expect(noIdem.status).toBe(400);
    expect((noIdem.body.error as { code: string }).code).toBe("idempotency_key_required");
    expect((await call(key, ronda(), "spazi non validi")).status).toBe(400);
    expect((await call(null, ronda())).status).toBe(401);
    await sql()`update bot_api_key set revoked_at = now()`;
    expect((await call(key, ronda())).status).toBe(401);
    expect(graphSends()).toEqual([]);
  });

  it("la stessa Idempotency-Key restituisce il primo risultato e non invia nulla; dopo 36 h torna libera", async () => {
    const key = await readyA();
    const first = await call(key, ronda());
    expect(first.body).toMatchObject({ sent: 2, replayed: false });
    expect(graphSends()).toHaveLength(2);

    const again = await call(key, ronda({ params: ["altro", "testo diverso"] }));
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ ...first.body, replayed: true });
    // Anche se nel frattempo la lista è stata spenta: è una replica, non una ronda nuova.
    await teamProfile(ORG_A, false, [TEAM1, TEAM2]);
    expect((await call(key, ronda())).body).toMatchObject({ replayed: true, broadcastId: first.body.broadcastId });
    expect(graphSends()).toHaveLength(2);
    expect(await broadcastRows(ORG_A)).toHaveLength(1);
    await teamProfile(ORG_A, true, [TEAM1, TEAM2]);

    vi.setSystemTime(FIXED_NOW_MS + 35 * HOUR);
    expect((await call(key, ronda())).body).toMatchObject({ replayed: true });
    expect(graphSends()).toHaveLength(2);

    vi.setSystemTime(FIXED_NOW_MS + 37 * HOUR);
    const later = await call(key, ronda());
    expect(later.body).toMatchObject({ replayed: false, sent: 2 });
    expect(later.body.broadcastId).not.toBe(first.body.broadcastId);
    expect(graphSends()).toHaveLength(4);
  });

  it("due chiamate contemporanee con la stessa chiave: una sola ronda", async () => {
    const key = await readyA();
    const [x, y] = await Promise.all([call(key, ronda()), call(key, ronda())]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    expect(graphSends()).toHaveLength(2);
    expect(await broadcastRows(ORG_A)).toHaveLength(1);
  });

  it("una ronda con la stessa chiave ancora in corso → 409 broadcast_in_progress", async () => {
    const key = await readyA();
    await sql()`
      insert into team_broadcast (id, organization_id, idempotency_key, template_name, language, status, total, created_at)
      values ('tb_running', ${ORG_A}, 'ronda-2030-01-01', 'ronda_mattutina', 'it', 'running', 2, ${new Date(FIXED_NOW_MS - 60_000).toISOString()})
    `;
    const res = await call(key, ronda());
    expect(res.status).toBe(409);
    expect((res.body.error as { code: string }).code).toBe("broadcast_in_progress");
    expect(graphSends()).toEqual([]);
  });

  it("limite: 3 ronde all'ora per organizzazione; la quarta 429 con Retry-After; dryRun e repliche non contano", async () => {
    const key = await readyA([TEAM1]);
    for (const k of ["r1", "r2", "r3"]) {
      expect((await call(key, ronda(), k)).status).toBe(200);
      vi.setSystemTime(Date.now() + 10 * 60 * 1000);
    }
    expect((await call(key, ronda(), "r1")).body).toMatchObject({ replayed: true });
    expect((await call(key, ronda({ dryRun: true }), "r-dry")).status).toBe(200);
    const fourth = await call(key, ronda(), "r4");
    expect(fourth.status).toBe(429);
    expect((fourth.body.error as { code: string }).code).toBe("rate_limited");
    // La prima ronda (minuto 0) esce dalla finestra al minuto 60: siamo al 30.
    expect(fourth.headers.get("retry-after")).toBe(String(30 * 60));
    expect(graphSends()).toHaveLength(3);

    // B non è toccata dal limite di A.
    await teamProfile(ORG_B, true, [TEAM_B]);
    await template(ORG_B);
    expect((await call(await botKey(ORG_B), ronda(), "r4")).status).toBe(200);

    vi.setSystemTime(FIXED_NOW_MS + 61 * 60 * 1000);
    expect((await call(key, ronda(), "r4")).status).toBe(200);
    expect(graphSends()).toHaveLength(5);
  });

  it("dryRun: stessi controlli, nessun invio, nessun contatto, nessuna riga", async () => {
    const key = await readyA();
    const res = await call(key, ronda({ dryRun: true }));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      broadcastId: null,
      replayed: false,
      dryRun: true,
      template: { name: "ronda_mattutina", language: "it" },
      total: 2,
      sent: 0,
      failed: 0,
      skipped: 2,
      results: [
        { recipient: "…001", status: "skipped", reason: "dry_run" },
        { recipient: "…002", status: "skipped", reason: "dry_run" },
      ],
      unknownRecipients: [],
    });
    expect(graphSends()).toEqual([]);
    expect(await sql()`select id from contact`).toHaveLength(0);
    expect(await broadcastRows()).toEqual([]);
    // La stessa chiave poi vale per la ronda vera.
    expect((await call(key, ronda())).body).toMatchObject({ sent: 2, replayed: false });
  });
});

describe("012 ronda del team — esiti per destinatario", () => {
  it("un rifiuto di Meta per un destinatario non ferma gli altri; un token scaduto sì", async () => {
    const key = await readyA([TEAM1, TEAM2, "393471110003"]);
    graphFails({
      method: "POST",
      path: /\/messages$/,
      status: 400,
      json: { error: { message: "(#131026) Message undeliverable", code: 131026 } },
    });
    const res = await call(key, ronda(), "k1");
    expect(res.body).toMatchObject({ sent: 2, failed: 1, skipped: 0 });
    expect((res.body.results as { status: string; error?: string }[])[0]).toEqual({
      recipient: "…001",
      status: "failed",
      error: "meta_error",
    });
    expect(graphSends()).toHaveLength(3);

    graphFails({
      method: "POST",
      path: /\/messages$/,
      status: 401,
      json: { error: { message: "Invalid OAuth access token", type: "OAuthException", code: 190 } },
    });
    const expired = await call(key, ronda(), "k2");
    expect(expired.status).toBe(200);
    expect(expired.body).toMatchObject({ sent: 0, failed: 1, skipped: 2 });
    expect(expired.body.results).toEqual([
      { recipient: "…001", status: "failed", error: "reconnect_required" },
      { recipient: "…002", status: "skipped", reason: "aborted" },
      { recipient: "…003", status: "skipped", reason: "aborted" },
    ]);
    expect(graphSends()).toHaveLength(4); // una sola chiamata in più
    // Con il numero da ricollegare la ronda successiva non parte nemmeno.
    const blocked = await call(key, ronda(), "k3");
    expect(blocked.status).toBe(409);
    expect((blocked.body.error as { code: string }).code).toBe("reconnect_required");
  });
});

describe("012 ronda del team — isolamento tra organizzazioni", () => {
  it("la chiave di A non usa il modello, la lista, il numero né i contatti di B", async () => {
    // B ha tutto; A solo la chiave.
    await teamProfile(ORG_B, true, [TEAM_B]);
    await template(ORG_B);
    const keyA = await botKey(ORG_A);
    const notFound = await call(keyA, ronda());
    expect(notFound.status).toBe(409); // A non ha lista: quella di B non conta
    await teamProfile(ORG_A, true, [TEAM1]);
    const noTemplate = await call(keyA, ronda());
    expect(noTemplate.status).toBe(422);
    expect((noTemplate.body.error as { code: string }).code).toBe("template_not_found");
    expect(graphSends()).toEqual([]);

    await template(ORG_A);
    const a = await call(keyA, ronda());
    expect(a.body).toMatchObject({ sent: 1 });
    expect(sentTo()).toEqual([TEAM1]);
    expect(graphSends()[0]?.path).toMatch(new RegExp(`/${ORGS.A.phoneNumberId}/messages$`));
    expect(graphSends()[0]?.auth).toBe(`Bearer ${ORGS.A.token}`);

    // B con la STESSA Idempotency-Key: chiavi separate per organizzazione.
    const b = await call(await botKey(ORG_B), ronda());
    expect(b.body).toMatchObject({ sent: 1, replayed: false });
    expect(b.body.broadcastId).not.toBe(a.body.broadcastId);
    const fromB = graphSends()[1];
    expect((fromB?.body as TemplatePayload).to).toBe(TEAM_B);
    expect(fromB?.path).toMatch(new RegExp(`/${ORGS.B.phoneNumberId}/messages$`));
    expect(fromB?.auth).toBe(`Bearer ${ORGS.B.token}`);

    const owners = await sql()<{ organization_id: string; wa_identity: string }[]>`
      select organization_id, wa_identity from contact order by organization_id, wa_identity
    `;
    expect(owners).toEqual([
      { organization_id: ORG_A, wa_identity: TEAM1 },
      { organization_id: ORG_B, wa_identity: TEAM_B },
    ]);
    expect((await broadcastRows(ORG_A)).map((r) => r.id)).toEqual([a.body.broadcastId]);
    expect((await broadcastRows(ORG_B)).map((r) => r.id)).toEqual([b.body.broadcastId]);
    expect(await legacyCheck()).toEqual({ V1: 0, V2: 0, V3: 0, V4: 0, V5: 0, V6: 0 });
  });
});
