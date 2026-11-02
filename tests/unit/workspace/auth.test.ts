import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireSession: vi.fn(), subscribe: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  requireSession: mocks.requireSession,
  UnauthorizedError: class UnauthorizedError extends Error {},
}));
vi.mock("@/server/events/bus", () => ({ subscribe: mocks.subscribe }));
import { withAuth } from "@/lib/api";
import { GET as getEvents } from "@/app/api/events/route";

describe("marine CRM API guard", () => {
  beforeEach(() => {
    vi.stubEnv("APP_WORKSPACE", "marine");
    mocks.requireSession.mockReset();
    mocks.subscribe.mockReset();
    mocks.subscribe.mockReturnValue(vi.fn());
  });
  afterEach(() => vi.unstubAllEnvs());
  it("rejects a member before calling the route handler", async () => {
    mocks.requireSession.mockResolvedValue({ userId: "u", organizationId: "o", role: "member" });
    const handler = vi.fn(async () => Response.json({ ok: true }));
    const response = await withAuth(handler)();
    expect(response.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });
  it.each(["owner", "admin"])("allows marine %s", async (role) => {
    mocks.requireSession.mockResolvedValue({ userId: "u", organizationId: "o", role });
    const response = await withAuth(async () => Response.json({ ok: true }))();
    expect(response.status).toBe(200);
  });
  it("rejects unknown marine roles and anonymous sessions", async () => {
    mocks.requireSession.mockResolvedValue({ userId: "u", organizationId: "o", role: "unknown" });
    expect((await withAuth(async () => Response.json({ ok: true }))()).status).toBe(403);
    mocks.requireSession.mockRejectedValue(new (await import("@/lib/auth/session")).UnauthorizedError());
    expect((await withAuth(async () => Response.json({ ok: true }))()).status).toBe(401);
  });
  it("keeps standard member API access", async () => {
    vi.stubEnv("APP_WORKSPACE", "standard");
    mocks.requireSession.mockResolvedValue({ userId: "u", organizationId: "o", role: "member" });
    expect((await withAuth(async () => Response.json({ ok: true }))()).status).toBe(200);
  });
  it("denies member SSE before subscribe and permits owner subscription until abort", async () => {
    const req = (signal: AbortSignal) => new Request("http://localhost/api/events", { signal });
    mocks.requireSession.mockResolvedValue({ userId: "u", organizationId: "o", role: "member" });
    expect((await getEvents(req(new AbortController().signal))).status).toBe(403);
    expect(mocks.subscribe).not.toHaveBeenCalled();

    mocks.requireSession.mockResolvedValue({ userId: "u", organizationId: "o", role: "owner" });
    const controller = new AbortController();
    const response = await getEvents(req(controller.signal));
    expect(response.status).toBe(200);
    expect(mocks.subscribe).toHaveBeenCalledOnce();
    controller.abort();
    await response.body?.cancel();
    expect(mocks.subscribe.mock.results[0]?.value).toHaveBeenCalledOnce();
  });
});
