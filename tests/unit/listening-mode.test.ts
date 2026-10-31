import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Recorded } from "./helpers/proxy-db";

/**
 * 016 — La regola unica `src/server/listening/mode.ts`: nessuna riga = spento;
 * acceso per A non vale per B; tutto filtra per organizzazione.
 */

const st = vi.hoisted(() => ({ log: [] as Recorded[], on: new Set<string>() }));

vi.mock("@/lib/db", async () => {
  const h = await import("./helpers/proxy-db");
  return h.makeProxyDb(st.log, (sql, params) => h.listeningRows(st.on, sql, params) ?? []);
});

import { getListeningState, isListeningMode, setListeningMode } from "@/server/listening/mode";

beforeEach(() => {
  st.log.length = 0;
  st.on = new Set(["org_a"]);
});

describe("isListeningMode", () => {
  it("acceso per A", async () => {
    expect(await isListeningMode("org_a")).toBe(true);
  });

  it("negativo con due organizzazioni: A acceso non accende B", async () => {
    expect(await isListeningMode("org_b")).toBe(false);
    const q = st.log.at(-1)!;
    expect(q.sql).toMatch(/"listening_mode"\."organization_id" = \$1/);
    expect(q.params).toContain("org_b");
    expect(q.params).not.toContain("org_a");
  });

  it("nessuna riga = spento, con enabledAt nullo", async () => {
    st.on = new Set();
    expect(await getListeningState("org_a")).toEqual({ enabled: false, enabledAt: null });
  });

  it("senza organizzazione la query non parte (fail-closed)", async () => {
    await expect(isListeningMode("")).rejects.toThrow(/organizationId vacío/);
    expect(st.log).toEqual([]);
  });
});

describe("setListeningMode", () => {
  it("upsert per organizzazione; spegnere non riscrive enabled_at; riaccendere da acceso non lo sposta", async () => {
    st.on = new Set();
    await setListeningMode("org_a", true, "u_1");
    const q = st.log.at(-1)!;
    expect(q.sql).toMatch(/insert into "listening_mode"/);
    expect(q.sql).toMatch(/on conflict \("organization_id"\) do update/);
    expect(q.sql).toMatch(/case when "listening_mode"\."enabled" then "listening_mode"\."enabled_at"/);
    expect(q.params).toContain("org_a");
    expect(q.params).toContain("u_1");

    await setListeningMode("org_a", false, "u_2");
    const off = st.log.at(-1)!;
    expect(off.sql).not.toMatch(/"enabled_at" = case/);
    expect(off.params).toContain("u_2");
  });
});

it("strutturale: la lettura passa da scoped()", () => {
  const src = readFileSync(path.resolve(import.meta.dirname, "../../src/server/listening/mode.ts"), "utf8");
  expect(src).toMatch(/scoped\(schema\.listeningMode\.organizationId/);
});
