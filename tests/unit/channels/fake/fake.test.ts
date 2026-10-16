import { vi } from "vitest";
import { runContractSuite } from "../contract";
import { FAKE_SIGNATURE_HEADER, fakeAdapter, fakeSign, fakeTransport, type FakePayload } from "./adapter";

/**
 * 005-livello-canali (M1.3, T023) — Il `FakeChannelAdapter` passa la STESSA
 * suite di contratto di WhatsApp. Gli scenari 1–4 di US4 che hanno bisogno del
 * nucleo con un PostgreSQL vero (ingesta, idempotenza, 404/401 senza
 * scritture, sandbox) stanno in `tests/golden/channels-fake.golden.test.ts`.
 */

const dbAccess = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ getDb: dbAccess, getSql: dbAccess, schema: {} }));

const payload = (events: FakePayload["events"]): FakePayload => ({ fake: true, account: "fake-acc-1", events });
const raw = JSON.stringify(payload([{ type: "message", id: "f.1", from: "u-1", text: "ciao" }]));

runContractSuite(fakeAdapter, {
  dbAccess,
  payloads: [
    { name: "messaggio", payload: payload([{ type: "message", id: "f.1", from: "u-1", text: "ciao", at: 1893499140 }]) },
    { name: "eco", payload: payload([{ type: "echo", id: "f.2", to: "u-1", text: "dal telefono" }]) },
    { name: "stato", payload: payload([{ type: "status", id: "fake.out.1", status: "read" }]) },
  ],
  ordered: {
    payload: payload([
      { type: "status", id: "fake.out.1", status: "delivered" },
      { type: "message", id: "f.3", from: "u-2" },
      { type: "echo", id: "f.4", to: "u-2" },
    ]),
    kinds: ["status", "message", "echo"],
  },
  signature: {
    rawBody: raw,
    valid: { [FAKE_SIGNATURE_HEADER]: fakeSign(raw) },
    invalid: { [FAKE_SIGNATURE_HEADER]: fakeSign("{}") },
  },
  send: {
    ctx: () => ({
      organizationId: "org_fake",
      account: {
        id: "cha_fake",
        organizationId: "org_fake",
        channel: "messenger",
        externalAccountId: "fake-acc-1",
        externalParentId: null,
        status: "connected",
      },
      secret: null,
      markReconnectRequired: vi.fn(async () => {}),
      recipient: { externalId: "u-1", phone: null, providerUserId: "u-1" },
    }),
    message: { kind: "text", text: "hola" },
    arrangeOk: () => fakeTransport.reset(),
    externalMessageId: "fake.out.1",
    failures: [
      { name: "token scaduto", arrange: () => (fakeTransport.fail = "auth"), code: "reconnect_required" },
      { name: "provider giù", arrange: () => (fakeTransport.fail = "down"), code: "meta_unavailable" },
      { name: "richiesta rifiutata", arrange: () => (fakeTransport.fail = "bad"), code: "meta_error" },
    ],
  },
});
