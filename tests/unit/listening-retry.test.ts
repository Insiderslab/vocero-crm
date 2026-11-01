import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 016 — Il secondo intento (`fireAgentRetry`) e «Riprova» (`prepareManualRetry`)
 * in modalità ascolto. Prima della guardia di `runAgentTurn` reclamavano la
 * conversazione: toglievano il passaggio a una persona (`handoff_reason =
 * 'error'`) e «Riprova» riaccendeva l'IA, poi il turno usciva senza fare nulla.
 * La conversazione smetteva di risultare «da prendere in mano». In ascolto il
 * passaggio a una persona deve restare com'è.
 */

const st = vi.hoisted(() => ({
  on: new Set<string>(),
  selectRows: [] as unknown[][],
  sets: [] as Record<string, unknown>[],
  conversation: {} as Record<string, unknown>,
}));

vi.mock("@/lib/env", async (orig) => ({
  ...(await orig<typeof import("@/lib/env")>()),
  isAiConfigured: () => true,
}));
vi.mock("@/server/listening/mode", async (orig) => ({
  ...(await orig<typeof import("@/server/listening/mode")>()),
  isListeningMode: async (org: string) => st.on.has(org),
}));
vi.mock("@/lib/ai", () => ({ chatJson: vi.fn() }));
vi.mock("@/server/events/bus", () => ({ publish: () => undefined }));
vi.mock("@/server/inbox/queries", async (orig) => ({
  ...(await orig<typeof import("@/server/inbox/queries")>()),
  getConversation: async () => ({ conversation: st.conversation, contact: { id: "ct_1" } }),
  serializeConversation: () => ({ id: "cv_1" }),
}));

function chain(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "leftJoin", "where", "orderBy", "limit"]) c[m] = () => c;
  c.then = (res: (v: unknown) => unknown) => Promise.resolve(rows).then(res);
  return c;
}
vi.mock("@/lib/db", async (orig) => ({
  ...(await orig<typeof import("@/lib/db")>()),
  getDb: () => ({
    select: () => chain(st.selectRows.shift() ?? []),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        st.sets.push(values);
        // `.where(...).returning()`: nessuna riga → il reclamo non riesce e
        // il test non arriva mai al turno.
        return { where: () => ({ returning: async () => [] }) };
      },
    }),
  }),
}));

import { fireAgentRetry } from "@/server/ai/pipeline";
import { prepareManualRetry } from "@/server/ai/manual-retry";

/** Una scrittura che toglie il passaggio a una persona o riaccende l'IA. */
const releasesHandoff = (v: Record<string, unknown>) =>
  "handoffReason" in v || "handoffAt" in v || v.aiEnabled === true;

beforeEach(() => {
  st.on = new Set(["org_a"]);
  st.sets = [];
  st.conversation = {
    id: "cv_1",
    organizationId: "org_a",
    contactId: "ct_1",
    isTest: false,
    aiEnabled: true,
    handoffAt: new Date(),
    handoffReason: "error",
    agentRetryAt: new Date(),
  };
});

describe("secondo intento in modalità ascolto", () => {
  beforeEach(() => {
    // conversazione · ultimo messaggio (entrante: il secondo intento vale) · profilo
    st.selectRows = [[st.conversation], [{ id: "msg_1", direction: "in" }], [{ enabled: true }]];
  });

  it("in ascolto non toglie il passaggio a una persona: agent_off", async () => {
    const out = await fireAgentRetry("cv_1", "msg_1");
    expect(out).toBe("agent_off");
    expect(st.sets.some(releasesHandoff)).toBe(false);
  });

  it("negativo con due organizzazioni: B non è in ascolto e reclama la conversazione", async () => {
    st.conversation.organizationId = "org_b";
    await fireAgentRetry("cv_1", "msg_1");
    expect(st.sets.some(releasesHandoff)).toBe(true);
  });

  it("in ascolto, con un entrante più nuovo dell'atteso, toglie la marca e il passaggio a una persona resta", async () => {
    // Fuori ascolto quell'entrante lo risponde il suo turno; in ascolto il
    // turno non parte, quindi la marca scaduta non deve restare.
    st.selectRows[1] = [{ id: "msg_2", direction: "in" }];
    const out = await fireAgentRetry("cv_1", "msg_1");
    expect(out).toBe("agent_off");
    expect(st.sets.some(releasesHandoff)).toBe(false);
    expect(st.sets).toContainEqual(expect.objectContaining({ agentRetryAt: null }));
  });

  it("il Laboratorio prosegue anche in ascolto, come in runAgentTurn", async () => {
    st.conversation.isTest = true;
    await fireAgentRetry("cv_1", "msg_1");
    expect(st.sets.some(releasesHandoff)).toBe(true);
  });
});

describe("«Riprova» in modalità ascolto", () => {
  beforeEach(() => {
    // profilo · messaggi recenti (solo l'entrante: nessuno ha risposto)
    st.selectRows = [[{ enabled: true, errorReply: null }], [{ direction: "in", text: "ciao" }]];
  });

  it("in ascolto rifiuta con listening_mode e non scrive nulla", async () => {
    const out = await prepareManualRetry("org_a", "cv_1");
    expect(out).toEqual({ status: "listening_mode" });
    expect(st.sets).toHaveLength(0);
  });

  it("negativo con due organizzazioni: B non è in ascolto e tenta il reclamo", async () => {
    st.conversation.organizationId = "org_b";
    await prepareManualRetry("org_b", "cv_1");
    expect(st.sets.some(releasesHandoff)).toBe(true);
  });
});
