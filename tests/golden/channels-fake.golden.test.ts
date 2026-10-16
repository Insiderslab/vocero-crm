import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getSql } from "@/lib/db";
import { handleChannelWebhook } from "@/server/channels/core/webhook";
import { sendText } from "@/server/channels/core/send";
import { channelRegistry, type ChannelLookup } from "@/server/channels/registry";
import {
  FAKE_SIGNATURE_HEADER,
  FAKE_TOKEN,
  fakeAdapter,
  fakeSign,
  fakeTransport,
  type FakePayload,
} from "../unit/channels/fake/adapter";
import { drainAfter, outcome, recordedSse, settle } from "./harness";
import { FIXED_NOW_S } from "./normalize";
import { ORG_A, ORG_B } from "./setup";

/**
 * 005-livello-canali (M1.3, T023, US4 scenari 1–4) — Un canale nuovo si
 * aggiunge SENZA toccare il nucleo: il `FakeChannelAdapter` dei test (slug
 * `fake`) entra dal gestore unico dei webhook e dall'invio del nucleo, con un
 * PostgreSQL vero. Il registro della app non cambia: il test passa al nucleo
 * una `ChannelLookup` che conosce anche il finto.
 *
 * Asserzioni esplicite, nessuna istantanea (niente `__golden__`).
 *
 * Schema: fino a T049 (M1.6) `contact.wa_identity` è NOT NULL, quindi un
 * contatto senza identità WhatsApp non si può salvare. Qui la migrazione di
 * T049 (`DROP NOT NULL`, solo catalogo, ADR §3.9) è SIMULATA per la durata del
 * file e annullata alla fine: prova che il nucleo di R2 regge già il secondo
 * canale senza modifiche (registro M1.3, Q3). L'ultimo caso prova lo schema di
 * oggi: il messaggio non entra e non sporca nulla.
 */

const FAKE_REG = {
  adapter: fakeAdapter,
};

const lookup: ChannelLookup = {
  bySlug: (slug) => (slug === "fake" ? FAKE_REG : channelRegistry.bySlug(slug)),
  byChannel: (channel) =>
    channel === fakeAdapter.channel ? FAKE_REG : channelRegistry.byChannel(channel),
};

const sql = () => getSql();

async function post(
  payload: unknown,
  opts: { slug?: string; token?: string; signature?: string | null; raw?: string } = {}
) {
  const raw = opts.raw ?? JSON.stringify(payload);
  const headers: Record<string, string> = { "content-type": "application/json" };
  const signature = opts.signature === undefined ? fakeSign(raw) : opts.signature;
  if (signature) headers[FAKE_SIGNATURE_HEADER] = signature;
  const slug = opts.slug ?? "fake";
  const token = opts.token ?? FAKE_TOKEN;
  const res = await handleChannelWebhook(
    new Request(`http://localhost:3000/api/webhooks/${slug}/${token}`, { method: "POST", headers, body: raw }),
    { channel: slug, webhookToken: token },
    lookup
  );
  await drainAfter();
  await settle();
  return res.status;
}

const fake = (account: string, events: FakePayload["events"]): FakePayload => ({ fake: true, account, events });

async function counts() {
  const [row] = await sql()<{ contacts: number; identities: number; conversations: number; messages: number }[]>`
    select (select count(*)::int from contact) as contacts,
           (select count(*)::int from contact_identity where channel = 'messenger') as identities,
           (select count(*)::int from conversation) as conversations,
           (select count(*)::int from message) as messages
  `;
  return row!;
}

async function fakeAccounts() {
  await sql()`
    insert into channel_account (id, organization_id, channel, external_account_id, status)
    values ('cha_fake_a', ${ORG_A}, 'messenger', 'fake-acc-a', 'connected'),
           ('cha_fake_b', ${ORG_B}, 'messenger', 'fake-acc-b', 'connected')
  `;
}

describe("canale finto attraverso il nucleo (US4)", () => {
  beforeAll(async () => {
    // Simulazione di T049 (M1.6): solo catalogo.
    await sql()`alter table contact alter column wa_identity drop not null`;
  });

  afterAll(async () => {
    await sql()`delete from contact where wa_identity is null`;
    await sql()`alter table contact alter column wa_identity set not null`;
  });

  beforeEach(async () => {
    fakeTransport.reset();
    await fakeAccounts();
  });

  it("scenario 1: POST firmato su /api/webhooks/fake/<token> → contatto, identità, conversazione e messaggio con channel del canale; idempotente", async () => {
    const before = await counts();
    const payload = fake("fake-acc-a", [
      { type: "message", id: "f.in.1", from: "u-1", name: "Uno Finto", text: "ciao", at: FIXED_NOW_S - 60 },
    ]);
    expect(await post(payload)).toBe(200);
    expect(await post(payload)).toBe(200); // stessa consegna due volte

    const messages = await sql()`
      select m.organization_id, m.channel, m.external_message_id, m.wa_message_id, m.direction, m.text,
             cv.channel_account_id, c.wa_identity, c.name
        from message m join conversation cv on cv.id = m.conversation_id join contact c on c.id = cv.contact_id
       where m.external_message_id = 'f.in.1'
    `;
    expect(messages).toEqual([
      {
        organization_id: ORG_A,
        channel: "messenger",
        external_message_id: "f.in.1",
        wa_message_id: null,
        direction: "in",
        text: "ciao",
        channel_account_id: "cha_fake_a",
        wa_identity: null,
        name: "Uno Finto",
      },
    ]);
    // Identità con ambito di account (capacità identityScope = "account").
    const identities = await sql()`
      select organization_id, channel, external_id, channel_account_id from contact_identity where channel = 'messenger'
    `;
    expect(identities).toEqual([
      { organization_id: ORG_A, channel: "messenger", external_id: "u-1", channel_account_id: "cha_fake_a" },
    ]);
    const after = await counts();
    expect(after.messages - before.messages).toBe(1);
    expect(after.contacts - before.contacts).toBe(1);
    const sse = recordedSse().filter((e) => e.type === "message.new");
    expect(sse).toHaveLength(1);
    expect(sse[0]).toMatchObject({ org: ORG_A, data: { message: { channel: "messenger", direction: "in" } } });
  });

  it("scenario 1 (isolamento): evento per l'account di B non scrive in A; stesso ID utente in A e B = due contatti", async () => {
    await post(fake("fake-acc-a", [{ type: "message", id: "f.iso.1", from: "u-same", text: "A" }]));
    await post(fake("fake-acc-b", [{ type: "message", id: "f.iso.2", from: "u-same", text: "B" }]));
    const rows = await sql()<{ organization_id: string; text: string }[]>`
      select m.organization_id, m.text from message m where m.channel = 'messenger' order by m.text
    `;
    expect(rows).toEqual([
      { organization_id: ORG_A, text: "A" },
      { organization_id: ORG_B, text: "B" },
    ]);
    const contacts = await sql()<{ n: number }[]>`
      select count(distinct contact_id)::int as n from contact_identity where external_id = 'u-same'
    `;
    expect(contacts[0]?.n).toBe(2);
  });

  it("account sconosciuto → scartato senza scritture", async () => {
    const before = await counts();
    expect(await post(fake("fake-acc-zzz", [{ type: "message", id: "f.x", from: "u-9", text: "?" }]))).toBe(200);
    expect(await counts()).toEqual(before);
  });

  it("eco e stato: l'eco pausa l'AI senza aprire la finestra; lo stato è monotono e filtrato per organizzazione", async () => {
    await post(fake("fake-acc-a", [{ type: "message", id: "f.in.2", from: "u-2", text: "hola", at: FIXED_NOW_S - 120 }]));
    const [conv] = await sql()<{ id: string; last_inbound_at: unknown }[]>`
      select id, last_inbound_at from conversation where channel_account_id = 'cha_fake_a'
    `;
    await post(fake("fake-acc-a", [{ type: "echo", id: "f.echo.1", to: "u-2", text: "dal telefono", at: FIXED_NOW_S - 30 }]));
    const [afterEcho] = await sql()<{ handoff_reason: string | null; ai_enabled: boolean; last_inbound_at: unknown }[]>`
      select handoff_reason, ai_enabled, last_inbound_at from conversation where id = ${conv!.id}
    `;
    expect(afterEcho).toMatchObject({ handoff_reason: "manual_reply", ai_enabled: false });
    expect(afterEcho!.last_inbound_at).toEqual(conv!.last_inbound_at);
    expect(conv!.last_inbound_at).not.toBeNull();

    // Stato: read, poi un delivered tardivo (resta read); lo stesso ID
    // sull'account di B non tocca il messaggio di A.
    await post(fake("fake-acc-b", [{ type: "status", id: "f.echo.1", status: "failed" }]));
    await post(fake("fake-acc-a", [{ type: "status", id: "f.echo.1", status: "read" }]));
    await post(fake("fake-acc-a", [{ type: "status", id: "f.echo.1", status: "delivered" }]));
    const [echo] = await sql()<{ status: string; origin: string; direction: string }[]>`
      select status, origin, direction from message where external_message_id = 'f.echo.1'
    `;
    expect(echo).toEqual({ status: "read", origin: "manual", direction: "out" });
  });

  it("scenario 2: slug non registrato → 404 senza scritture", async () => {
    const before = await counts();
    expect(await post(fake("fake-acc-a", [{ type: "message", id: "f.404", from: "u-3" }]), { slug: "nope" })).toBe(404);
    expect(await post(fake("fake-acc-a", [{ type: "message", id: "f.404", from: "u-3" }]), { token: "otro" })).toBe(404);
    expect(await counts()).toEqual(before);
  });

  it("scenario 3: firma non valida o assente → 401 senza scritture", async () => {
    const before = await counts();
    const payload = fake("fake-acc-a", [{ type: "message", id: "f.401", from: "u-4", text: "x" }]);
    expect(await post(payload, { signature: fakeSign("{}") })).toBe(401);
    expect(await post(payload, { signature: null })).toBe(401);
    expect(await counts()).toEqual(before);
  });

  it("scenario 4: conversazione del Laboratorio → sandbox nel nucleo, l'adattatore non viene chiamato", async () => {
    await post(fake("fake-acc-a", [{ type: "message", id: "f.lab", from: "u-5", text: "ciao" }]));
    const [conv] = await sql()<{ id: string; contact_id: string }[]>`
      select id, contact_id from conversation where channel_account_id = 'cha_fake_a'
    `;
    await sql()`update conversation set is_test = true where id = ${conv!.id}`;
    const result = await outcome(() =>
      sendText({ conversationId: conv!.id, organizationId: ORG_A, text: "risposta" }, lookup)
    );
    expect(result).toMatchObject({ error: { code: "sandbox_violation" } });
    expect(fakeTransport.sent).toEqual([]);
  });

  it("invio: il nucleo usa l'adattatore del canale della conversazione e la finestra delle SUE capacità (48 h)", async () => {
    // Ultimo messaggio entrante 30 h fa: chiusa per WhatsApp (24 h), aperta per il finto (48 h).
    await post(fake("fake-acc-a", [{ type: "message", id: "f.win", from: "u-6", text: "ciao", at: FIXED_NOW_S - 30 * 3600 }]));
    const [conv] = await sql()<{ id: string }[]>`
      select id from conversation where channel_account_id = 'cha_fake_a'
    `;
    const result = await outcome(() =>
      sendText({ conversationId: conv!.id, organizationId: ORG_A, text: "eccomi" }, lookup)
    );
    expect(result).toMatchObject({ ok: { messageId: expect.any(String) } });
    expect(fakeTransport.sent).toEqual([
      { account: "fake-acc-a", to: "u-6", message: { kind: "text", text: "eccomi" } },
    ]);
    const [out] = await sql()`
      select channel, external_message_id, wa_message_id, status, origin from message where direction = 'out'
    `;
    expect(out).toEqual({
      channel: "messenger",
      external_message_id: "fake.out.1",
      wa_message_id: null,
      status: "pending",
      origin: "operator",
    });

    // Token scaduto: SendError reconnect_required e l'account (senza riga
    // vecchia) viene marcato dal nucleo.
    fakeTransport.fail = "auth";
    const expired = await outcome(() =>
      sendText({ conversationId: conv!.id, organizationId: ORG_A, text: "di nuovo" }, lookup)
    );
    expect(expired).toMatchObject({ error: { code: "reconnect_required" } });
    const [acc] = await sql()<{ status: string }[]>`select status from channel_account where id = 'cha_fake_a'`;
    expect(acc?.status).toBe("reconnect_required");
  });
});

describe("canale finto con lo schema di R2 (wa_identity NOT NULL)", () => {
  beforeEach(async () => {
    fakeTransport.reset();
    await fakeAccounts();
  });

  it("un contatto senza identità WhatsApp non entra (fino a T049): nessuna scrittura parziale, errore nel log", async () => {
    const before = await counts();
    expect(
      await post(fake("fake-acc-a", [{ type: "message", id: "f.r2", from: "u-7", text: "ciao" }]))
    ).toBe(200);
    expect(await counts()).toEqual(before);
  });
});
