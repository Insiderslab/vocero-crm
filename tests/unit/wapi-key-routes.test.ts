import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetWapiStore, wapiStore } from "./helpers/fake-wapi-db";

/**
 * C3 — /api/settings/whatsapp/wapi-key: solo owner/admin, siempre dentro de la
 * organización de la sesión, y la clave NUNCA aparece en una respuesta.
 */

const state = vi.hoisted(() => ({
  session: { userId: "u_1", organizationId: "org_a", role: "owner" },
}));

vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return { ...actual, requireSession: async () => state.session };
});

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  const { createFakeWapiDb } = await import("./helpers/fake-wapi-db");
  const db = createFakeWapiDb();
  return { ...actual, getDb: () => db };
});

const KEY_A = "hlp_live_AAAAAAAAAAAAAAAAAAAA1111";
const KEY_B = "hlp_live_BBBBBBBBBBBBBBBBBBBB2222";
const URL = "http://localhost/api/settings/whatsapp/wapi-key";

beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgresql://t:t@localhost:5432/t";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test";
});

afterEach(() => vi.unstubAllEnvs());

async function routes() {
  return import("@/app/api/settings/whatsapp/wapi-key/route");
}

function put(body: unknown): Request {
  return new Request(URL, {
    method: "PUT",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

async function seedBothOrgs() {
  const { saveWapiKey } = await import("@/server/whatsapp/wapi-credentials");
  await saveWapiKey({ organizationId: "org_a", key: KEY_A, createdBy: "u_a" });
  await saveWapiKey({ organizationId: "org_b", key: KEY_B, createdBy: "u_b" });
  wapiStore().writes = 0;
}

describe("/api/settings/whatsapp/wapi-key", () => {
  beforeEach(() => {
    state.session = { userId: "u_1", organizationId: "org_a", role: "owner" };
    resetWapiStore();
  });

  it.each(["member", "", "Owner", "viewer"])(
    "rol %j: GET, PUT y DELETE → 403 y ninguna escritura",
    async (role) => {
      await seedBothOrgs();
      state.session.role = role;
      const { GET, PUT, DELETE } = await routes();
      expect((await GET()).status).toBe(403);
      expect((await PUT(put({ key: KEY_B }))).status).toBe(403);
      expect((await DELETE()).status).toBe(403);
      expect(wapiStore().writes).toBe(0);
    }
  );

  it.each(["owner", "admin"])("%s puede gestionar la clave", async (role) => {
    state.session.role = role;
    const { GET, PUT, DELETE } = await routes();
    expect((await PUT(put({ key: KEY_A }))).status).toBe(200);
    expect((await GET()).status).toBe(200);
    expect((await DELETE()).status).toBe(200);
  });

  it("NINGUNA respuesta contiene la clave (PUT, GET, DELETE) y solo hay last4", async () => {
    const { GET, PUT, DELETE } = await routes();
    const res = await PUT(put({ key: KEY_A }));
    const text = await res.text();
    expect(text).not.toContain(KEY_A);
    expect(text).not.toContain(KEY_A.slice(9));
    expect(JSON.parse(text)).toMatchObject({ configured: true, last4: "1111" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    const get = await (await GET()).text();
    expect(get).not.toContain(KEY_A.slice(9));
    expect(get).not.toContain(wapiStore().rows[0]!.keyCipher);
    expect(JSON.parse(get)).toMatchObject({ configured: true, last4: "1111" });
    const del = await (await DELETE()).text();
    expect(del).not.toContain(KEY_A.slice(9));
    expect(JSON.parse(del)).toMatchObject({ configured: false, last4: null });
  });

  it("la respuesta solo tiene la forma pública (lista blanca de campos)", async () => {
    await seedBothOrgs();
    const { GET, PUT, DELETE } = await routes();
    const allowed = ["configured", "gatewayEnabled", "last4", "routing", "updatedAt"];
    for (const res of [await GET(), await PUT(put({ key: KEY_B })), await DELETE()]) {
      expect(Object.keys(await res.json()).sort()).toEqual(allowed);
    }
  });

  it("negativo con dos orgs: A solo ve y revoca lo suyo; B no cambia", async () => {
    await seedBothOrgs();
    const { GET, DELETE } = await routes();
    const body = await (await GET()).text();
    expect(JSON.parse(body)).toMatchObject({ last4: "1111" });
    expect(body).not.toContain("2222");
    expect(body).not.toContain(KEY_B.slice(9));
    await DELETE();
    const rowB = wapiStore().rows.find((r) => r.organizationId === "org_b")!;
    expect(rowB.revokedAt).toBeNull();
    // y B (cambiando de sesión) sigue viendo su clave
    state.session = { userId: "u_b", organizationId: "org_b", role: "admin" };
    expect(JSON.parse(await (await GET()).text())).toMatchObject({ configured: true, last4: "2222" });
  });

  it("PUT guarda en la organización de la SESIÓN (un body con organizationId ajeno no cuenta)", async () => {
    await seedBothOrgs();
    const { PUT } = await routes();
    const nueva = "hlp_live_NNNNNNNNNNNNNNNNNNNN3333";
    await PUT(put({ key: nueva, organizationId: "org_b" }));
    const { getWapiKeyByOrg } = await import("@/server/whatsapp/wapi-credentials");
    expect(await getWapiKeyByOrg("org_a")).toBe(nueva);
    expect(await getWapiKeyByOrg("org_b")).toBe(KEY_B);
  });

  it("PUT con formato inválido → 422, no escribe y el error no refleja lo enviado", async () => {
    const { PUT } = await routes();
    const malo = "EAAG-un-token-de-meta-pegado-por-error";
    const res = await PUT(put({ key: malo }));
    expect(res.status).toBe(422);
    const text = await res.text();
    expect(text).not.toContain(malo);
    expect(JSON.parse(text).error.code).toBe("invalid_wapi_key");
    expect(wapiStore().writes).toBe(0);
    expect((await PUT(put({ key: 123 }))).status).toBe(422);
    expect((await PUT(put("no es json"))).status).toBe(422);
    expect(wapiStore().writes).toBe(0);
  });

  it("la clave guardada queda cifrada y el estado informa el enrutamiento", async () => {
    vi.stubEnv("WAPI_BASE_URL", "https://wapi.example.com/api/v1/graph");
    // getEnv() está memoizado: el enrutamiento se prueba con módulos nuevos.
    vi.resetModules();
    const { GET, PUT } = await routes();
    await PUT(put({ key: KEY_A }));
    expect(JSON.stringify(wapiStore().rows[0])).not.toContain(KEY_A.slice(9));
    const body = JSON.parse(await (await GET()).text());
    expect(body).toMatchObject({ gatewayEnabled: true, routing: "own_key" });
  });
});
