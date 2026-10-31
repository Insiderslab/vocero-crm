import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 016 (2, 5) — `sendText` con `aiGenerated` in ascolto → `listening_mode`:
 * l'adattatore non è mai chiamato e nessun messaggio si salva. L'invio di una
 * PERSONA (testo, posizione) resta permesso.
 */

const st = vi.hoisted(() => ({
  on: new Set<string>(),
  rows: [] as unknown[][],
  inserts: 0,
}));

vi.mock("@/server/listening/mode", async (orig) => ({
  ...(await orig<typeof import("@/server/listening/mode")>()),
  isListeningMode: async (org: string) => st.on.has(org),
}));
vi.mock("@/server/events/bus", () => ({ publish: vi.fn() }));
vi.mock("@/server/channels/core/accounts", async (orig) => ({
  ...(await orig<typeof import("@/server/channels/core/accounts")>()),
  accountContext: () => ({}),
  findAccountForOrg: async () => ({ id: "cha_1", status: "connected" }),
}));

function chain(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "leftJoin", "where", "orderBy"]) c[m] = () => c;
  c.limit = () => Promise.resolve(rows);
  return c;
}

vi.mock("@/lib/db", () => {
  const msg = { id: "msg_1", organizationId: "o", conversationId: "c", direction: "out", type: "text", text: "x", status: "pending", createdAt: new Date() };
  return {
    getDb: () => ({
      select: () => chain(st.rows.shift() ?? []),
      insert: () => ({
        values: () => {
          st.inserts += 1;
          return { returning: () => Promise.resolve([msg]) };
        },
      }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    }),
    schema: {
      conversation: { contactId: "", id: "", channelAccountId: "", organizationId: "" },
      channelAccount: { id: "", organizationId: "", channel: "" },
      contact: { id: "" },
      message: {},
      mediaAsset: {},
    },
  };
});

import { sendStructured, sendText } from "@/server/channels/core/send";

const send = vi.fn(async () => ({ externalMessageId: "wamid.1" }));
const lookup = {
  bySlug: () => null,
  byChannel: () => ({
    adapter: {
      channel: "whatsapp",
      capabilities: { replyWindow: { kind: "unbounded" } },
      recipientFor: () => "5215511111111",
      send,
    },
  }),
} as never;

function conv(org: string) {
  st.rows.push([
    {
      conversation: { id: "cv_1", organizationId: org, isTest: false, lastInboundAt: new Date() },
      contact: { id: "ct_1", phone: "5215511111111", waIdentity: "5215511111111", waUserId: null },
      accountChannel: "whatsapp",
    },
  ]);
}

beforeEach(() => {
  send.mockClear();
  st.rows.length = 0;
  st.inserts = 0;
  st.on = new Set(["org_a"]);
});

describe("invio automatico in modalità ascolto", () => {
  it("aiGenerated in ascolto → SendError listening_mode, adattatore mai chiamato, nessun messaggio salvato", async () => {
    conv("org_a");
    await expect(
      sendText({ conversationId: "cv_1", organizationId: "org_a", text: "ciao", aiGenerated: true }, lookup)
    ).rejects.toMatchObject({ name: "SendError", code: "listening_mode" });
    expect(send).not.toHaveBeenCalled();
    expect(st.inserts).toBe(0);
  });

  it("negativo con due organizzazioni: aiGenerated per B (non in ascolto) parte", async () => {
    conv("org_b");
    await sendText({ conversationId: "cv_1", organizationId: "org_b", text: "ciao", aiGenerated: true }, lookup);
    expect(send).toHaveBeenCalledTimes(1);
    expect(st.inserts).toBe(1);
  });
});

describe("invio di una persona in modalità ascolto (permesso)", () => {
  it("testo senza aiGenerated: parte e si salva", async () => {
    conv("org_a");
    const r = await sendText({ conversationId: "cv_1", organizationId: "org_a", text: "ciao" }, lookup);
    expect(r.messageId).toBe("msg_1");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("posizione: parte", async () => {
    conv("org_a");
    await sendStructured(
      { conversationId: "cv_1", organizationId: "org_a", kind: "location", location: { latitude: 1, longitude: 2 } },
      lookup
    );
    expect(send).toHaveBeenCalledTimes(1);
  });
});
