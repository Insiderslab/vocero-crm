import { createHmac } from "node:crypto";
import { vi } from "vitest";
import { runContractSuite } from "../contract";
import { waFixture } from "../../../golden/fixtures/whatsapp";

/**
 * 005-livello-canali (M1.3, T022) — L'adattatore WhatsApp passa la suite di
 * contratto comune. Il DB è sostituito da una spia: né `parse` né `send`
 * devono toccarlo (l'account lo marca il nucleo, via contesto).
 */

const h = vi.hoisted(() => {
  Object.assign(process.env, {
    APP_BASE_URL: "http://localhost:3000",
    DATABASE_URL: "postgres://contract.invalid/db",
    BETTER_AUTH_SECRET: "contract-auth-secret-0001",
    ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
    META_WEBHOOK_VERIFY_TOKEN: "contract-verify-token-0001",
    META_APP_SECRET: "contract-app-secret-0001",
    META_GRAPH_BASE_URL: "https://graph.contract.test",
  });
  delete process.env.WAPI_BASE_URL;
  delete process.env.WA_MOCK_ENABLED;
  return { dbAccess: vi.fn(() => {
    throw new Error("acceso al DB desde el adaptador");
  }) };
});

vi.mock("@/lib/db", () => ({
  getDb: h.dbAccess,
  getSql: h.dbAccess,
  schema: {},
}));

const { whatsappAdapter } = await import("@/server/channels/whatsapp/adapter");

const SECRET = "contract-app-secret-0001";
const raw = JSON.stringify(waFixture("inbound-text-mx"));
const sign = (body: string, key: string) =>
  `sha256=${createHmac("sha256", key).update(body, "utf8").digest("hex")}`;

function graphReplies(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      })
    )
  );
}

runContractSuite(whatsappAdapter, {
  dbAccess: h.dbAccess,
  payloads: (
    [
      "inbound-text-mx",
      "inbound-bsuid-only",
      "inbound-phone-and-bsuid",
      "inbound-image",
      "inbound-document",
      "inbound-location",
      "inbound-contacts",
      "inbound-multi",
      "status-sent-delivered-read",
      "status-failed",
      "status-and-message",
      "echo-text",
      "echo-image",
      "echo-messages-key",
      "template-status-approved",
      "history-two-threads",
      "state-sync",
      "account-update-partner-removed-a",
    ] as const
  ).map((name) => ({ name, payload: waFixture(name) })),
  ordered: { payload: waFixture("status-and-message"), kinds: ["status", "message"] },
  signature: {
    rawBody: raw,
    valid: { "x-hub-signature-256": sign(raw, SECRET) },
    invalid: { "x-hub-signature-256": sign(raw, "otro-secreto") },
  },
  send: {
    ctx: () => ({
      organizationId: "org_contract",
      account: {
        id: "cha_contract",
        organizationId: "org_contract",
        channel: "whatsapp",
        externalAccountId: "100000000000009",
        externalParentId: "200000000000009",
        status: "connected",
      },
      secret: "EAAContractToken",
      markReconnectRequired: vi.fn(async () => {}),
      recipient: { externalId: "525512345678", phone: "525512345678", providerUserId: null },
    }),
    message: { kind: "text", text: "hola" },
    arrangeOk: () =>
      graphReplies(200, { messaging_product: "whatsapp", messages: [{ id: "wamid.contract.1" }] }),
    externalMessageId: "wamid.contract.1",
    failures: [
      {
        name: "token vencido (190)",
        arrange: () => graphReplies(400, { error: { message: "expired", code: 190 } }),
        code: "reconnect_required",
      },
      {
        name: "401",
        arrange: () => graphReplies(401, { error: { message: "nope" } }),
        code: "reconnect_required",
      },
      {
        name: "Meta 5xx",
        arrange: () => graphReplies(503, { error: { message: "down", code: 2 } }),
        code: "meta_unavailable",
      },
      {
        name: "red caída",
        arrange: () =>
          vi.stubGlobal(
            "fetch",
            vi.fn(async () => {
              throw new TypeError("fetch failed");
            })
          ),
        code: "meta_unavailable",
      },
      {
        name: "error de Meta (400)",
        arrange: () => graphReplies(400, { error: { message: "bad param", code: 100 } }),
        code: "meta_error",
      },
      {
        name: "Meta sin ID de mensaje",
        arrange: () => graphReplies(200, { messages: [] }),
        code: "meta_error",
      },
    ],
  },
});
