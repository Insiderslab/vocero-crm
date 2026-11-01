import { beforeEach, describe, expect, it, vi } from "vitest";

/** 016 (6) — `/api/settings/listening`: solo owner/admin; il corpo accetta solo `enabled`. */

const st = vi.hoisted(() => ({
  session: null as { userId: string; organizationId: string; role: string } | null,
  set: vi.fn(),
  get: vi.fn(),
}));

vi.mock("@/lib/auth/session", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth/session")>();
  return {
    ...actual,
    requireSession: async () => {
      if (!st.session) throw new actual.UnauthorizedError();
      return st.session;
    },
  };
});
vi.mock("@/server/listening/mode", () => ({
  getListeningState: st.get,
  setListeningMode: st.set,
}));

import { GET, PUT } from "@/app/api/settings/listening/route";

const put = (body: unknown) =>
  PUT(
    new Request("http://localhost/api/settings/listening", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
const as = (role: string, org = "org_a") => (st.session = { userId: "u_1", organizationId: org, role });

beforeEach(() => {
  st.session = null;
  st.set.mockReset().mockResolvedValue({ enabled: true, enabledAt: new Date("2026-10-31T10:00:00Z") });
  st.get.mockReset().mockResolvedValue({ enabled: false, enabledAt: null });
});

describe("PUT /api/settings/listening", () => {
  it.each(["member", "", "Owner", "viewer"])("rol %j → 403 e nessuna scrittura", async (role) => {
    as(role);
    const res = await put({ enabled: true });
    expect(res.status).toBe(403);
    expect(st.set).not.toHaveBeenCalled();
  });

  it("senza sessione → 401", async () => {
    expect((await put({ enabled: true })).status).toBe(401);
    expect(st.set).not.toHaveBeenCalled();
  });

  it.each([{ enabled: true, extra: 1 }, { enabled: "true" }, {}, { enabled: true, organizationId: "org_b" }])(
    "corpo %j → 422 e nessuna scrittura",
    async (body) => {
      as("admin");
      const res = await put(body);
      expect(res.status).toBe(422);
      expect(st.set).not.toHaveBeenCalled();
    }
  );

  it.each(["owner", "admin"])("%s: accende per la PROPRIA organizzazione, con l'utente della sessione", async (role) => {
    as(role, "org_b");
    const res = await put({ enabled: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: true, enabledAt: "2026-10-31T10:00:00.000Z" });
    expect(st.set).toHaveBeenCalledWith("org_b", true, "u_1");
  });
});

describe("GET /api/settings/listening", () => {
  it("member → 403 senza leggere", async () => {
    as("member");
    expect((await GET()).status).toBe(403);
    expect(st.get).not.toHaveBeenCalled();
  });

  it("admin: legge l'organizzazione della sessione", async () => {
    as("admin", "org_b");
    const res = await GET();
    expect(await res.json()).toEqual({ enabled: false, enabledAt: null });
    expect(st.get).toHaveBeenCalledWith("org_b");
  });
});
