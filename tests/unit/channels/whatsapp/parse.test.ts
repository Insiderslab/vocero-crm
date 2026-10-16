import { describe, expect, it } from "vitest";
import { whatsappAdapter } from "@/server/channels/whatsapp/adapter";
import type { InboundEvent } from "@/server/channels/types";
import { waFixture, type FixtureName } from "../../../golden/fixtures/whatsapp";

/**
 * 005-livello-canali (M1.3, T024) — Golden PURI del parse di WhatsApp:
 * fixture sintetiche dei golden (tests/golden/fixtures/whatsapp, T004) →
 * `InboundEvent[]` atteso, scritto a mano a partire da ciò che il codice di
 * oggi fa con lo stesso payload (`processPayload` della route `wa`,
 * `processMessagesValue`, `processEchoesValue`, `resolveIdentity`,
 * `mediaInputFrom`). L'ordine è l'ordine di elaborazione: per ogni `change`,
 * prima gli stati e poi i messaggi.
 */

const parse = (name: FixtureName): InboundEvent[] => whatsappAdapter.webhook.parse(waFixture(name));

const A = { by: "account", externalAccountId: "100000000000001" } as const;
const B = { by: "account", externalAccountId: "100000000000002" } as const;
const at = (s: number) => new Date(s * 1000);
const ANA = {
  externalId: "525512345678",
  phone: "525512345678",
  providerUserId: null,
  displayName: "Ana Golden",
};

describe("parse WhatsApp — messaggi in entrata", () => {
  it("testo da un cellulare MX con il «1» in più → identità normalizzata 52…", () => {
    expect(parse("inbound-text-mx")).toEqual([
      {
        kind: "message",
        channel: "whatsapp",
        account: A,
        externalMessageId: "wamid.golden.in.text.1",
        occurredAt: at(1893499140),
        from: ANA,
        content: { type: "text", text: "Hola, quiero información", media: null },
      },
    ]);
  });

  it("solo BSUID → identità bsuid:<id>, senza telefono", () => {
    expect(parse("inbound-bsuid-only")).toEqual([
      {
        kind: "message",
        channel: "whatsapp",
        account: A,
        externalMessageId: "wamid.golden.in.bsuid.1",
        occurredAt: at(1893499080),
        from: {
          externalId: "bsuid:MX.1000000000000000001",
          phone: null,
          providerUserId: "MX.1000000000000000001",
          displayName: "Beto BSUID",
        },
        content: { type: "text", text: "Hola desde BSUID", media: null },
      },
    ]);
  });

  it("telefono + BSUID nello stesso evento → identità per telefono, BSUID come segnale del provider", () => {
    const [event] = parse("inbound-phone-and-bsuid");
    expect(event).toMatchObject({
      kind: "message",
      from: {
        externalId: "525587654321",
        phone: "525587654321",
        providerUserId: "MX.1000000000000000001",
        displayName: "Beto Teléfono",
      },
    });
  });

  it("immagine → media per ID di Graph, con mime e didascalia", () => {
    expect(parse("inbound-image")[0]).toMatchObject({
      kind: "message",
      content: {
        type: "image",
        text: null,
        media: {
          kind: "image",
          ref: { externalMediaId: "media.golden.img.1" },
          mimeType: "image/jpeg",
          fileName: null,
          caption: "mira esto",
        },
      },
    });
  });

  it("documento con nome file", () => {
    expect(parse("inbound-document")[0]).toMatchObject({
      content: {
        type: "document",
        media: {
          kind: "document",
          ref: { externalMediaId: "media.golden.doc.1" },
          mimeType: "application/pdf",
          fileName: "cotizacion.pdf",
          caption: "la cotización",
        },
      },
    });
  });

  it("posizione e contatti → payload strutturato", () => {
    expect(parse("inbound-location")[0]).toMatchObject({
      content: {
        type: "location",
        text: null,
        media: {
          kind: "location",
          payload: { latitude: 19.4326, longitude: -99.1332, name: "Oficina", address: "Av. Sintética 1" },
        },
      },
    });
    const contacts = parse("inbound-contacts")[0];
    expect(contacts).toMatchObject({ content: { type: "contacts", media: { kind: "contacts" } } });
    expect((contacts as { content: { media: { payload: unknown[] } } }).content.media.payload).toHaveLength(1);
  });

  it("tipo non supportato → ignorato (nessun messaggio)", () => {
    expect(parse("inbound-unsupported")).toEqual([
      { kind: "ignored", channel: "whatsapp", reason: "unsupported_type", externalMessageId: "wamid.golden.in.reaction.1" },
      { kind: "ignored", channel: "whatsapp", reason: "unsupported_type", externalMessageId: "wamid.golden.in.unknown.1" },
    ]);
  });

  it("senza identità (né from né from_user_id) → ignorato", () => {
    expect(parse("inbound-no-identity")).toEqual([
      { kind: "ignored", channel: "whatsapp", reason: "no_identity", externalMessageId: "wamid.golden.in.noid.1" },
    ]);
  });

  it("più entry/changes → eventi nell'ordine del payload, ognuno col suo account", () => {
    const events = parse("inbound-multi");
    expect(events.map((e) => e.kind === "message" && [e.account, e.externalMessageId])).toEqual([
      [A, "wamid.golden.in.multi.1"],
      [A, "wamid.golden.in.multi.2"],
      [B, "wamid.golden.in.multi.3"],
    ]);
  });

  it("timestamp illeggibile → occurredAt null (il nucleo usa l'ora di ricezione)", () => {
    const payload = waFixture("inbound-text-mx") as {
      entry: { changes: { value: { messages: { timestamp: string }[] } }[] }[];
    };
    payload.entry[0]!.changes[0]!.value.messages[0]!.timestamp = "ieri";
    const [event] = whatsappAdapter.webhook.parse(payload);
    expect(event).toMatchObject({ kind: "message", occurredAt: null });
  });

  it("senza phone_number_id → nessun evento (come oggi: il change si scarta)", () => {
    const payload = waFixture("inbound-text-mx") as {
      entry: { changes: { value: { metadata?: unknown } }[] }[];
    };
    delete payload.entry[0]!.changes[0]!.value.metadata;
    expect(whatsappAdapter.webhook.parse(payload)).toEqual([]);
  });
});

describe("parse WhatsApp — stati", () => {
  it("sent → delivered → read nell'ordine del payload", () => {
    const events = parse("status-sent-delivered-read");
    expect(events.every((e) => e.kind === "status")).toBe(true);
    expect(events.map((e) => e.kind === "status" && e.status)).toEqual(["sent", "delivered", "read"]);
  });

  it("failed con codice e messaggio", () => {
    expect(parse("status-failed")).toEqual([
      {
        kind: "status",
        channel: "whatsapp",
        account: A,
        externalMessageId: "wamid.golden.out.1",
        status: "failed",
        error: {
          code: 131049,
          message: "This message was not delivered to maintain healthy ecosystem engagement.",
        },
      },
    ]);
  });

  it("stati PRIMA dei messaggi nello stesso change (ordine di oggi)", () => {
    expect(parse("status-and-message").map((e) => e.kind)).toEqual(["status", "message"]);
  });

  it("wamid di A sul numero di B → l'evento porta l'account di B (il nucleo filtra per organizzazione)", () => {
    const [event] = parse("status-a-wamid-on-b");
    expect(event).toMatchObject({ kind: "status", account: B });
  });
});

describe("parse WhatsApp — eco della coexistence", () => {
  it("testo dal telefono del titolare → echo verso il cliente normalizzato", () => {
    expect(parse("echo-text")).toEqual([
      {
        kind: "echo",
        channel: "whatsapp",
        account: A,
        externalMessageId: "wamid.golden.echo.1",
        occurredAt: at(1893499170),
        to: { externalId: "525512345678", phone: "525512345678", providerUserId: null, displayName: null },
        content: { type: "text", text: "Te respondo desde el teléfono", media: null },
      },
    ]);
  });

  it("immagine in eco", () => {
    expect(parse("echo-image")[0]).toMatchObject({
      kind: "echo",
      content: { type: "image", media: { kind: "image", ref: { externalMediaId: "media.golden.echo.img.1" } } },
    });
  });

  it("variante con la chiave `messages`", () => {
    expect(parse("echo-messages-key")[0]).toMatchObject({ kind: "echo", externalMessageId: "wamid.golden.echo.2" });
  });

  it("senza `to` → ignorato", () => {
    expect(parse("echo-no-to")).toEqual([
      { kind: "ignored", channel: "whatsapp", reason: "no_recipient", externalMessageId: "wamid.golden.echo.noto.1" },
    ]);
  });
});

describe("parse WhatsApp — modelli, coexistence e campi sconosciuti", () => {
  it("stato del modello → evento a livello WABA (entry.id)", () => {
    expect(parse("template-status-approved")).toEqual([
      {
        kind: "template_status",
        channel: "whatsapp",
        account: { by: "parent", externalParentId: "200000000000001" },
        event: "APPROVED",
        templateExternalId: "7000000000001",
        name: "promo_golden",
        language: "es_MX",
        reason: null,
      },
    ]);
  });

  it("history, smb_app_state_sync e account_update → eventi `provider` col value intatto", () => {
    for (const [name, field] of [
      ["history-two-threads", "history"],
      ["history-declined", "history"],
      ["state-sync", "smb_app_state_sync"],
      ["account-update-partner-removed-a", "account_update"],
      ["account-update-other-event", "account_update"],
    ] as const) {
      const payload = waFixture(name) as { entry: { id: string; changes: { value: unknown }[] }[] };
      expect(parse(name), name).toEqual([
        {
          kind: "provider",
          channel: "whatsapp",
          name: field,
          parentId: payload.entry[0]!.id,
          payload: payload.entry[0]!.changes[0]!.value,
        },
      ]);
    }
  });

  it("campo sconosciuto → nessun evento", () => {
    expect(parse("unknown-field")).toEqual([]);
  });
});
