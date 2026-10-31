import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Recorded } from "./helpers/proxy-db";

/** 016 (1) — Con l'ascolto acceso il turno dell'agente NON si pianifica. */

const st = vi.hoisted(() => ({
  log: [] as Recorded[],
  on: new Set<string>(),
  orgOf: {} as Record<string, string>,
  schedule: vi.fn(),
  configured: true,
}));

vi.mock("@/server/ai/pipeline", () => ({ scheduleAgentTurn: st.schedule }));
vi.mock("@/lib/env", () => ({ isAiConfigured: () => st.configured }));
vi.mock("@/lib/db", async () => {
  const h = await import("./helpers/proxy-db");
  return h.makeProxyDb(st.log, (sql, params) => {
    const l = h.listeningRows(st.on, sql, params);
    if (l) return l;
    if (/from "conversation"/.test(sql)) {
      const org = st.orgOf[String(params[0])];
      return org ? [[org]] : [];
    }
    return [];
  });
});

import { maybeRunAgentTurn } from "@/server/ai/trigger";

beforeEach(() => {
  st.log.length = 0;
  st.schedule.mockReset();
  st.configured = true;
  st.on = new Set(["org_a"]);
  st.orgOf = { cv_a: "org_a", cv_b: "org_b" };
});

describe("maybeRunAgentTurn e la modalità ascolto", () => {
  it("organizzazione in ascolto: nessun turno pianificato", async () => {
    await maybeRunAgentTurn("cv_a");
    expect(st.schedule).not.toHaveBeenCalled();
  });

  it("negativo con due organizzazioni: B non in ascolto pianifica il turno", async () => {
    await maybeRunAgentTurn("cv_b");
    expect(st.schedule).toHaveBeenCalledWith("cv_b");
  });

  it("spenta (nessuna riga): il turno si pianifica come prima", async () => {
    st.on = new Set();
    await maybeRunAgentTurn("cv_a");
    expect(st.schedule).toHaveBeenCalledWith("cv_a");
  });

  it("conversazione inesistente: niente turno", async () => {
    await maybeRunAgentTurn("cv_x");
    expect(st.schedule).not.toHaveBeenCalled();
  });

  it("IA non configurata: niente turno e nemmeno una query", async () => {
    st.configured = false;
    await maybeRunAgentTurn("cv_b");
    expect(st.schedule).not.toHaveBeenCalled();
    expect(st.log).toEqual([]);
  });
});
