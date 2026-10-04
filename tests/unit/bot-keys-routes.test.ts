import { beforeEach, describe, expect, it, vi } from "vitest";

/** Gestión de claves de bot: solo owner/admin y siempre dentro de su organización. */

const state = vi.hoisted(() => ({
  session: { userId: "u_1", organizationId: "org_a", role: "owner" },
  queue: [] as unknown[][],
  inserts: [] as unknown[],
  updates: 0,
}));

vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return { ...actual, requireSession: async () => state.session };
});

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "from", "where", "limit", "orderBy", "set"]) {
    builder[m] = () => builder;
  }
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

import { GET, POST } from "@/app/api/settings/bot-keys/route";
import { DELETE } from "@/app/api/settings/bot-keys/[id]/route";

function post(body: unknown): Request {
  return new Request("http://localhost/api/settings/bot-keys", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("/api/settings/bot-keys", () => {
  beforeEach(() => {
    state.session = { userId: "u_1", organizationId: "org_a", role: "owner" };
    state.queue = [];
    state.inserts = [];
    state.updates = 0;
  });

  it("un member no lista, no crea y no revoca claves (403)", async () => {
    state.session.role = "member";
    expect((await GET()).status).toBe(403);
    expect((await POST(post({ label: "bot" }))).status).toBe(403);
    expect((await DELETE(new Request("http://localhost"), ctx("bk_1"))).status).toBe(403);
    expect(state.inserts).toHaveLength(0);
    expect(state.updates).toBe(0);
  });

  it("crear: la clave nace en la organización de la sesión y el texto plano sale una vez", async () => {
    const res = await POST(post({ label: "cerebro externo" }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { key: string; keyPrefix: string };
    expect(body.key.startsWith("vbk_")).toBe(true);
    const row = state.inserts[0] as { organizationId: string; keyHash: string };
    expect(row.organizationId).toBe("org_a");
    expect(row.keyHash).not.toContain(body.key);
    expect(JSON.stringify(row)).not.toContain(body.key);
  });

  it("revocar una clave de otra organización → 404 y ninguna escritura", async () => {
    state.queue = [[]]; // la búsqueda acotada a org_a no la encuentra
    const res = await DELETE(new Request("http://localhost"), ctx("bk_de_org_b"));
    expect(res.status).toBe(404);
    expect(state.updates).toBe(0);
  });

  it("revocar una clave propia → 204", async () => {
    state.queue = [[{ id: "bk_1" }], []];
    const res = await DELETE(new Request("http://localhost"), ctx("bk_1"));
    expect(res.status).toBe(204);
    expect(state.updates).toBe(1);
  });
});
