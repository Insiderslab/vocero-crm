import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

/** Gestión de claves de export (C2): solo owner/admin, en su organización y en su ámbito. */

const state = vi.hoisted(() => ({
  session: { userId: "u_1", organizationId: "org_a", role: "owner" },
  queue: [] as unknown[][],
  inserts: [] as unknown[],
  wheres: [] as unknown[],
  updates: 0,
}));

vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return { ...actual, requireSession: async () => state.session };
});

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "from", "limit", "orderBy", "set"]) {
    builder[m] = () => builder;
  }
  builder.where = (w: unknown) => {
    state.wheres.push(w);
    return builder;
  };
  builder.insert = () => ({
    values: async (v: unknown) => {
      state.inserts.push(v);
    },
  });
  builder.update = () => {
    state.updates += 1;
    return builder;
  };
  (builder as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    resolve(state.queue.shift() ?? []);
  return { ...actual, getDb: () => builder };
});

import { GET, POST } from "@/app/api/settings/export-keys/route";
import { DELETE } from "@/app/api/settings/export-keys/[id]/route";

const dialect = new PgDialect();
const render = (w: unknown) => dialect.sqlToQuery(w as SQL);

function post(body: unknown): Request {
  return new Request("http://localhost/api/settings/export-keys", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("/api/settings/export-keys", () => {
  beforeEach(() => {
    state.session = { userId: "u_1", organizationId: "org_a", role: "owner" };
    state.queue = [];
    state.inserts = [];
    state.wheres = [];
    state.updates = 0;
  });

  it("un member no lista, no crea y no revoca claves (403)", async () => {
    state.session.role = "member";
    expect((await GET()).status).toBe(403);
    expect((await POST(post({ label: "n8n" }))).status).toBe(403);
    expect((await DELETE(new Request("http://localhost"), ctx("bk_1"))).status).toBe(403);
    expect(state.inserts).toHaveLength(0);
    expect(state.updates).toBe(0);
  });

  it("crear: clave vex_ de ámbito export en la organización de la sesión; el texto plano no se guarda", async () => {
    const res = await POST(post({ label: "n8n" }));
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { key: string };
    expect(body.key.startsWith("vex_")).toBe(true);
    const row = state.inserts[0] as { organizationId: string; scope: string };
    expect(row.organizationId).toBe("org_a");
    expect(row.scope).toBe("export");
    expect(JSON.stringify(row)).not.toContain(body.key);
  });

  it("listar filtra por organización Y por ámbito export", async () => {
    state.queue = [[]];
    expect((await GET()).status).toBe(200);
    const q = render(state.wheres[0]);
    expect(q.sql).toContain('"organization_id" = $1');
    expect(q.sql).toContain('"scope" = $2');
    expect(q.params).toEqual(["org_a", "export"]);
  });

  it("revocar una clave de otra organización u otro ámbito → 404 sin escrituras", async () => {
    state.queue = [[]]; // la búsqueda acotada a org_a + export no la encuentra
    const res = await DELETE(new Request("http://localhost"), ctx("bk_de_bot"));
    expect(res.status).toBe(404);
    expect(state.updates).toBe(0);
    const q = render(state.wheres[0]);
    expect(q.params).toEqual(["org_a", "bk_de_bot", "export"]);
  });

  it("revocar una clave propia → 204, el UPDATE también va acotado al ámbito", async () => {
    state.queue = [[{ id: "bk_1" }], []];
    const res = await DELETE(new Request("http://localhost"), ctx("bk_1"));
    expect(res.status).toBe(204);
    expect(state.updates).toBe(1);
    expect(render(state.wheres[1]).params).toEqual(["org_a", "bk_1", "export"]);
  });
});
