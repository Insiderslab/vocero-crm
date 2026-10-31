import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 016 (3) — Cervello esterno in ascolto: `/api/bot/messages` e `/api/bot/typing`
 * rispondono 409 `listening_mode` e non chiamano né l'invio né Graph.
 */

const st = vi.hoisted(() => ({
  org: "org_a",
  on: new Set<string>(),
  sendText: vi.fn(),
  markReadAndTyping: vi.fn(),
  dbCalls: 0,
}));

vi.mock("@/server/bot/auth", () => ({
  authenticateBot: async () => ({ organizationId: st.org }),
}));
vi.mock("@/server/listening/mode", async (orig) => ({
  ...(await orig<typeof import("@/server/listening/mode")>()),
  isListeningMode: async (org: string) => st.on.has(org),
}));
vi.mock("@/server/inbox/send", async (orig) => ({
  ...(await orig<typeof import("@/server/inbox/send")>()),
  sendText: st.sendText,
}));
vi.mock("@/server/channels/whatsapp/adapter", () => ({
  whatsappAdapter: { markReadAndTyping: st.markReadAndTyping },
}));
vi.mock("@/server/channels/core/accounts", async (orig) => ({
  ...(await orig<typeof import("@/server/channels/core/accounts")>()),
  accountContext: () => ({}),
  findAccountForOrg: async () => ({ id: "cha_1" }),
}));

function chain(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy"]) c[m] = () => c;
  c.limit = () => Promise.resolve(rows);
  return c;
}
vi.mock("@/lib/db", async (orig) => ({
  ...(await orig<typeof import("@/lib/db")>()),
  getDb: () => {
    st.dbCalls += 1;
    return {
      select: () =>
        chain([{ aiEnabled: true, handoffAt: null, isTest: false, id: "cv_1", externalMessageId: "wamid.1" }]),
    };
  },
}));

import { POST as botMessages } from "@/app/api/bot/messages/route";
import { POST as botTyping } from "@/app/api/bot/typing/route";

const post = (url: string, handler: (r: Request) => Promise<Response>) =>
  handler(
    new Request(`http://localhost/api/bot/${url}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId: "cv_1", text: "hola" }),
    })
  );

beforeEach(() => {
  st.org = "org_a";
  st.on = new Set(["org_a"]);
  st.dbCalls = 0;
  st.sendText.mockReset().mockResolvedValue({ messageId: "msg_1" });
  st.markReadAndTyping.mockReset().mockResolvedValue(undefined);
});

describe("/api/bot/messages", () => {
  it("in ascolto → 409 listening_mode; né sendText né database", async () => {
    const res = await post("messages", botMessages);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("listening_mode");
    expect(st.sendText).not.toHaveBeenCalled();
    expect(st.dbCalls).toBe(0);
  });

  it("difesa in profondità: se sendText lancia listening_mode → 409 listening_mode", async () => {
    st.on = new Set();
    const { SendError } = await import("@/server/channels/errors");
    st.sendText.mockRejectedValue(new SendError("listening_mode", "x"));
    const res = await post("messages", botMessages);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("listening_mode");
  });

  it("negativo con due organizzazioni: B (non in ascolto) invia", async () => {
    st.org = "org_b";
    const res = await post("messages", botMessages);
    expect(res.status).toBe(200);
    expect(st.sendText).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org_b", aiGenerated: true }));
  });
});

describe("/api/bot/typing", () => {
  it("in ascolto → 409 listening_mode e Graph mai chiamato", async () => {
    const res = await post("typing", botTyping);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("listening_mode");
    expect(st.markReadAndTyping).not.toHaveBeenCalled();
    expect(st.dbCalls).toBe(0);
  });

  it("negativo con due organizzazioni: B marca letto e «sta scrivendo»", async () => {
    st.org = "org_b";
    const res = await post("typing", botTyping);
    expect(res.status).toBe(200);
    expect(st.markReadAndTyping).toHaveBeenCalledTimes(1);
  });
});
