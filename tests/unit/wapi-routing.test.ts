import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetWapiStore, wapiStore } from "./helpers/fake-wapi-db";

/**
 * C3 — enrutamiento Wapi de punta a punta SIN mocks del código bajo prueba:
 * cliente Graph real + credenciales reales (cifradas) + doble de la tabla con
 * dos organizaciones. Solo fetch y la red están sustituidos.
 */

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  const { createFakeWapiDb } = await import("./helpers/fake-wapi-db");
  const db = createFakeWapiDb();
  return { ...actual, getDb: () => db };
});

const WAPI = "https://wapi.example.com/api/v1/graph";
const KEY_A = "hlp_live_AAAAAAAAAAAAAAAAAAAA1111";
const KEY_B = "hlp_live_BBBBBBBBBBBBBBBBBBBB2222";
const GLOBAL = "hlp_live_GLOBALGLOBALGLOBAL9999";

const BASE_ENV: Record<string, string> = {
  APP_BASE_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  BETTER_AUTH_SECRET: "test-secret-de-al-menos-16",
  ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
  META_WEBHOOK_VERIFY_TOKEN: "token-de-prueba",
};

async function load(extraEnv: Record<string, string> = {}) {
  vi.resetModules();
  for (const [k, v] of Object.entries({ ...BASE_ENV, ...extraEnv })) vi.stubEnv(k, v);
  const client = await import("@/lib/meta/client");
  const creds = await import("@/server/whatsapp/wapi-credentials");
  const media = await import("@/server/whatsapp/media");
  return { ...client, ...creds, ...media };
}

type Call = { url: string; auth: string | null };
let calls: Call[];

function stubFetch(responder: (url: string) => Response) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url: String(url), auth: headers.Authorization ?? null });
      return responder(String(url));
    })
  );
}

const json = (o: unknown) =>
  new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });

beforeEach(() => resetWapiStore());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("graphRequest con claves reales por organización", () => {
  it("A y B llaman con su propia clave; ninguna llamada lleva la clave de la otra ni la global", async () => {
    const m = await load({ WAPI_BASE_URL: WAPI, WAPI_API_KEY: GLOBAL, WAPI_ORG_IDS: "org_a,org_b" });
    await m.saveWapiKey({ organizationId: "org_a", key: KEY_A, createdBy: "u" });
    await m.saveWapiKey({ organizationId: "org_b", key: KEY_B, createdBy: "u" });
    stubFetch(() => json({ ok: true }));
    await m.graphRequest("P_A/messages", { token: "meta-A", organizationId: "org_a" });
    await m.graphRequest("P_B/messages", { token: "meta-B", organizationId: "org_b" });
    expect(calls[0]).toEqual({ url: `${WAPI}/v25.0/P_A/messages`, auth: `Bearer ${KEY_A}` });
    expect(calls[1]).toEqual({ url: `${WAPI}/v25.0/P_B/messages`, auth: `Bearer ${KEY_B}` });
  });

  it("revocada la clave de A: A no desvía con la de B ni con la global (lista ambigua → ninguna llamada)", async () => {
    const m = await load({ WAPI_BASE_URL: WAPI, WAPI_API_KEY: GLOBAL, WAPI_ORG_IDS: "org_a,org_b" });
    await m.saveWapiKey({ organizationId: "org_a", key: KEY_A, createdBy: "u" });
    await m.saveWapiKey({ organizationId: "org_b", key: KEY_B, createdBy: "u" });
    await m.revokeWapiKey("org_a");
    stubFetch(() => json({ ok: true }));
    await expect(
      m.graphRequest("P_A/messages", { token: "meta-A", organizationId: "org_a" })
    ).rejects.toMatchObject({ status: 0 });
    expect(calls).toHaveLength(0);
    // B sigue funcionando con la suya
    await m.graphRequest("P_B/messages", { token: "meta-B", organizationId: "org_b" });
    expect(calls).toEqual([{ url: `${WAPI}/v25.0/P_B/messages`, auth: `Bearer ${KEY_B}` }]);
  });

  it("revocada la clave de A sin lista: A va a Meta con SU token; ningún bearer hlp_ sale", async () => {
    const m = await load({ WAPI_BASE_URL: WAPI, WAPI_API_KEY: GLOBAL });
    await m.saveWapiKey({ organizationId: "org_a", key: KEY_A, createdBy: "u" });
    await m.saveWapiKey({ organizationId: "org_b", key: KEY_B, createdBy: "u" });
    await m.revokeWapiKey("org_a");
    stubFetch(() => json({ ok: true }));
    await m.graphRequest("P_A/messages", { token: "meta-A", organizationId: "org_a" });
    expect(calls).toEqual([{ url: "https://graph.facebook.com/v25.0/P_A/messages", auth: "Bearer meta-A" }]);
  });

  it("modo heredado (una org en WAPI_ORG_IDS) sigue funcionando con la clave global; la otra org va directa", async () => {
    const m = await load({ WAPI_BASE_URL: WAPI, WAPI_API_KEY: GLOBAL, WAPI_ORG_IDS: "org_a" });
    stubFetch(() => json({ ok: true }));
    await m.graphRequest("P_A/messages", { token: "meta-A", organizationId: "org_a" });
    await m.graphRequest("P_B/messages", { token: "meta-B", organizationId: "org_b" });
    expect(calls[0]).toEqual({ url: `${WAPI}/v25.0/P_A/messages`, auth: `Bearer ${GLOBAL}` });
    expect(calls[1]!.auth).toBe("Bearer meta-B");
  });

  it("clave propia ilegible (fila alterada): no hay llamada y no cae a ninguna otra clave", async () => {
    const m = await load({ WAPI_BASE_URL: WAPI, WAPI_API_KEY: GLOBAL, WAPI_ORG_IDS: "org_a" });
    await m.saveWapiKey({ organizationId: "org_a", key: KEY_A, createdBy: "u" });
    wapiStore().rows[0]!.keyTag = Buffer.alloc(16, 9).toString("base64");
    stubFetch(() => json({ ok: true }));
    await expect(
      m.graphRequest("P_A/messages", { token: "meta-A", organizationId: "org_a" })
    ).rejects.toMatchObject({ status: 0 });
    expect(calls).toHaveLength(0);
  });

  it("sin WAPI_BASE_URL todo va directo a Meta aunque las orgs tengan clave", async () => {
    const m = await load();
    await m.saveWapiKey({ organizationId: "org_a", key: KEY_A, createdBy: "u" });
    stubFetch(() => json({ ok: true }));
    await m.graphRequest("P_A/messages", { token: "meta-A", organizationId: "org_a" });
    expect(calls).toEqual([{ url: "https://graph.facebook.com/v25.0/P_A/messages", auth: "Bearer meta-A" }]);
  });

  it("el error de una llamada fallida no contiene la clave", async () => {
    const m = await load({ WAPI_BASE_URL: WAPI });
    await m.saveWapiKey({ organizationId: "org_a", key: KEY_A, createdBy: "u" });
    stubFetch(
      () => new Response(JSON.stringify({ error: { message: "Invalid token", code: 190 } }), { status: 401 })
    );
    const err = (await m
      .graphRequest("P_A/messages", { token: "meta-A", organizationId: "org_a" })
      .catch((e: unknown) => e)) as Error & { details?: unknown };
    expect(err.name).toBe("MetaApiError");
    expect(JSON.stringify({ message: err.message, details: err.details })).not.toContain(KEY_A.slice(9));
  });
});

describe("media por Wapi (subida y descarga)", () => {
  const creds = (org: string, phone: string) => ({
    id: "c",
    organizationId: org,
    wabaId: "w",
    phoneNumberId: phone,
    displayPhoneNumber: null,
    verifiedName: null,
    status: "connected" as const,
    token: `meta-${org}`,
  });

  it("subida: bearer = clave de la org emisora", async () => {
    const m = await load({ WAPI_BASE_URL: WAPI });
    await m.saveWapiKey({ organizationId: "org_a", key: KEY_A, createdBy: "u" });
    await m.saveWapiKey({ organizationId: "org_b", key: KEY_B, createdBy: "u" });
    stubFetch(() => json({ id: "media_1" }));
    const id = await m.uploadGraphMedia(creds("org_b", "P_B"), {
      data: Buffer.from("x"),
      mimeType: "image/png",
    });
    expect(id).toBe("media_1");
    expect(calls).toEqual([{ url: `${WAPI}/v25.0/P_B/media`, auth: `Bearer ${KEY_B}` }]);
  });

  it("descarga: la URL del propio gateway recibe la clave de la org", async () => {
    const m = await load({ WAPI_BASE_URL: WAPI });
    await m.saveWapiKey({ organizationId: "org_a", key: KEY_A, createdBy: "u" });
    stubFetch((url) =>
      url.includes("/v25.0/MID")
        ? json({ url: "https://wapi.example.com/api/v1/graph/_media/P_A/MID", mime_type: "image/png" })
        : new Response(Buffer.from("png"), { status: 200 })
    );
    const out = await m.downloadGraphMedia("meta-A", "MID", { organizationId: "org_a" });
    expect(out.fileSize).toBe(3);
    expect(calls[1]).toEqual({
      url: "https://wapi.example.com/api/v1/graph/_media/P_A/MID",
      auth: `Bearer ${KEY_A}`,
    });
  });

  it("descarga: una URL de OTRO origen jamás recibe la clave de Wapi (se aborta)", async () => {
    const m = await load({ WAPI_BASE_URL: WAPI });
    await m.saveWapiKey({ organizationId: "org_a", key: KEY_A, createdBy: "u" });
    stubFetch(() => json({ url: "https://atacante.example.net/captura", mime_type: "image/png" }));
    await expect(
      m.downloadGraphMedia("meta-A", "MID", { organizationId: "org_a" })
    ).rejects.toMatchObject({ name: "MediaFetchError" });
    expect(calls).toHaveLength(1); // solo la metadata; la URL ajena no se contactó
    expect(JSON.stringify(calls)).not.toContain("atacante");
  });

  it("descarga sin clave propia (va a Meta): una URL que apunta al gateway NO recibe el token Meta", async () => {
    const m = await load({ WAPI_BASE_URL: WAPI });
    await m.saveWapiKey({ organizationId: "org_b", key: KEY_B, createdBy: "u" });
    stubFetch(() => json({ url: "https://wapi.example.com/api/v1/graph/_media/P/MID" }));
    await expect(
      m.downloadGraphMedia("meta-A", "MID", { organizationId: "org_a" })
    ).rejects.toMatchObject({ name: "MediaFetchError" });
    expect(calls).toHaveLength(1);
  });

  it("descarga directa a Meta (sin Wapi): sigue funcionando con el token Meta", async () => {
    const m = await load();
    stubFetch((url) =>
      url.includes("/v25.0/MID")
        ? json({ url: "https://lookaside.fbsbx.com/x", mime_type: "image/png" })
        : new Response(Buffer.from("png"), { status: 200 })
    );
    await m.downloadGraphMedia("meta-A", "MID", { organizationId: "org_a" });
    expect(calls[1]).toEqual({ url: "https://lookaside.fbsbx.com/x", auth: "Bearer meta-A" });
  });
});
