import { beforeEach, describe, expect, it, vi } from "vitest";

/** 016 (4) — Automazioni: organizzazione in ascolto saltata, un'altra invia. */

const st = vi.hoisted(() => ({
  on: new Set<string>(),
  checks: 0,
  turnOnAfter: Infinity,
  sendTemplate: vi.fn(),
  credentials: vi.fn(),
  queue: [] as unknown[][],
}));

vi.mock("@/server/listening/mode", async (orig) => ({
  ...(await orig<typeof import("@/server/listening/mode")>()),
  // `turnOnAfter`: l'ascolto si accende dopo N controlli (a giro iniziato).
  isListeningMode: async (org: string) => st.on.has(org) || ++st.checks > st.turnOnAfter,
}));
vi.mock("@/server/whatsapp/templates", () => ({ sendTemplate: st.sendTemplate }));
vi.mock("@/server/whatsapp/credentials", () => ({ getCredentialsByOrg: st.credentials }));
vi.mock("@/server/inbox/ingest", () => ({
  getOrCreateConversation: async () => ({ id: "cv_1", lastInboundAt: null }),
}));

function chain() {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where", "groupBy", "limit", "orderBy"]) c[m] = () => c;
  c.then = (res: (v: unknown) => unknown) => Promise.resolve(st.queue.shift() ?? []).then(res);
  return c;
}
vi.mock("@/lib/db", async (orig) => ({
  ...(await orig<typeof import("@/lib/db")>()),
  getDb: () => ({ select: () => chain(), insert: () => ({ values: async () => undefined }) }),
}));

import { runAutomationsForOrg } from "@/server/automations/engine";

beforeEach(() => {
  st.on = new Set(["org_a"]);
  st.checks = 0;
  st.turnOnAfter = Infinity;
  st.sendTemplate.mockReset().mockResolvedValue({ messageId: "msg_1" });
  st.credentials.mockReset().mockResolvedValue({ status: "connected" });
  st.queue = [
    [{ id: "rule_1", tagId: "tag_1", templateId: "tpl_1", intervalDays: 7, enabled: true }],
    [{ id: "tpl_1", status: "approved", body: "Hola" }],
    [{ contact: { id: "ct_1", name: "Ana" } }],
    [],
  ];
});

describe("automazioni e modalità ascolto", () => {
  it("in ascolto: nessun sendTemplate, nemmeno le credenziali; conteggiata come saltata", async () => {
    const stats = await runAutomationsForOrg("org_a");
    expect(st.sendTemplate).not.toHaveBeenCalled();
    expect(st.credentials).not.toHaveBeenCalled();
    expect(stats).toMatchObject({ orgs: 1, sent: 0, failed: 0, skippedListening: 1 });
  });

  it("negativo con due organizzazioni: B invia il suo modello", async () => {
    const stats = await runAutomationsForOrg("org_b");
    expect(st.sendTemplate).toHaveBeenCalledTimes(1);
    expect(st.sendTemplate).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org_b" }));
    expect(stats).toMatchObject({ sent: 1, skippedListening: 0 });
  });

  it("accesa a giro iniziato: si rilegge prima di ogni invio e il giro si ferma", async () => {
    // Il primo controllo (inizio giro) dice «spenta», il secondo (prima dell'invio) «accesa».
    st.turnOnAfter = 1;
    const stats = await runAutomationsForOrg("org_b");
    expect(st.sendTemplate).not.toHaveBeenCalled();
    expect(stats).toMatchObject({ sent: 0, skippedListening: 1 });
  });
});
