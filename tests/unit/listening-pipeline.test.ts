import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 016 — `runAgentTurn` in modalità ascolto: un turno reale si ferma subito dopo
 * aver letto la conversazione (niente modello, niente scritture nel CRM). Copre
 * i turni pianificati prima dell'accensione, il secondo intento e «Riprova».
 * Il Laboratorio (`is_test`) prosegue: è sandbox e non invia mai.
 */

const st = vi.hoisted(() => ({
  on: new Set<string>(),
  selects: 0,
  writes: 0,
  conversation: {} as Record<string, unknown>,
  chatJson: vi.fn(),
}));

vi.mock("@/lib/env", async (orig) => ({
  ...(await orig<typeof import("@/lib/env")>()),
  isAiConfigured: () => true,
}));
vi.mock("@/server/listening/mode", async (orig) => ({
  ...(await orig<typeof import("@/server/listening/mode")>()),
  isListeningMode: async (org: string) => st.on.has(org),
}));
vi.mock("@/lib/ai", () => ({ chatJson: st.chatJson }));

function chain(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "leftJoin", "where", "orderBy", "limit"]) c[m] = () => c;
  c.then = (res: (v: unknown) => unknown) => Promise.resolve(rows).then(res);
  return c;
}
vi.mock("@/lib/db", async (orig) => ({
  ...(await orig<typeof import("@/lib/db")>()),
  getDb: () => ({
    // La prima select è la conversazione; dopo, il turno legge il profilo:
    // vuoto → esce senza modello. Basta contare se arriva fin lì.
    select: () => {
      st.selects++;
      return chain(st.selects === 1 ? [st.conversation] : []);
    },
    insert: () => {
      st.writes++;
      return { values: async () => undefined };
    },
    update: () => {
      st.writes++;
      return { set: () => ({ where: async () => undefined }) };
    },
  }),
}));

import { runAgentTurn } from "@/server/ai/pipeline";

beforeEach(() => {
  st.on = new Set(["org_a"]);
  st.selects = 0;
  st.writes = 0;
  st.chatJson.mockReset();
  st.conversation = {
    id: "cv_1",
    organizationId: "org_a",
    contactId: "ct_1",
    isTest: false,
    aiEnabled: true,
    handoffAt: null,
    agentRetryAt: null,
  };
});

describe("pipeline dell'agente e modalità ascolto", () => {
  it("conversazione reale in ascolto: si ferma dopo la conversazione, nessun modello né scrittura", async () => {
    await runAgentTurn("cv_1");
    expect(st.selects).toBe(1);
    expect(st.writes).toBe(0);
    expect(st.chatJson).not.toHaveBeenCalled();
  });

  it("un secondo intento pendente (agent_retry_at) non viene reclamato né eseguito", async () => {
    st.conversation.handoffAt = new Date();
    st.conversation.agentRetryAt = new Date();
    await runAgentTurn("cv_1");
    expect(st.selects).toBe(1);
    expect(st.writes).toBe(0);
  });

  it("negativo con due organizzazioni: B non è in ascolto e il turno prosegue", async () => {
    st.conversation.organizationId = "org_b";
    await runAgentTurn("cv_1");
    expect(st.selects).toBeGreaterThan(1);
  });

  it("il Laboratorio prosegue anche in ascolto", async () => {
    st.conversation.isTest = true;
    await runAgentTurn("cv_1");
    expect(st.selects).toBeGreaterThan(1);
  });
});
