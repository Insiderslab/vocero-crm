import { afterEach, describe, expect, it, vi } from "vitest";
import { MetaApiError, normalizeRecipient } from "@/lib/meta/client";

describe("normalizeRecipient", () => {
  it("México móvil legado: 521 + 10 dígitos → 52 + 10 dígitos", () => {
    expect(normalizeRecipient("5215512345678")).toBe("525512345678");
  });

  it("México ya normalizado queda intacto", () => {
    expect(normalizeRecipient("525512345678")).toBe("525512345678");
  });

  it("otros países quedan intactos", () => {
    expect(normalizeRecipient("14155552671")).toBe("14155552671");
    expect(normalizeRecipient("5491122334455")).toBe("5491122334455");
  });

  it("no confunde números que empiezan en 521 pero con otra longitud", () => {
    expect(normalizeRecipient("521123")).toBe("521123");
  });
});

describe("MetaApiError.isAuthError", () => {
  it("status 401 es error de auth", () => {
    expect(new MetaApiError("x", { status: 401 }).isAuthError).toBe(true);
  });

  it("code 190 es error de auth (token vencido)", () => {
    expect(new MetaApiError("x", { status: 400, code: 190 }).isAuthError).toBe(
      true
    );
  });

  it("OAuthException solo NO basta (Meta la usa en errores transitorios)", () => {
    // Incidente 2026-08-03: un 500 con type OAuthException (código 2,
    // "service temporarily unavailable") marcaba el token como vencido y
    // bloqueaba TODO envío. El type por sí solo jamás decide.
    expect(
      new MetaApiError("x", { status: 400, type: "OAuthException" }).isAuthError
    ).toBe(false);
    expect(
      new MetaApiError("x", { status: 500, code: 2, type: "OAuthException" })
        .isAuthError
    ).toBe(false);
  });

  it("OAuthException con código 190 sí es error de auth", () => {
    expect(
      new MetaApiError("x", { status: 400, code: 190, type: "OAuthException" })
        .isAuthError
    ).toBe(true);
  });

  it("un 5xx JAMÁS es error de auth, ni con código 190", () => {
    expect(new MetaApiError("x", { status: 500 }).isAuthError).toBe(false);
    expect(
      new MetaApiError("x", { status: 500, code: 190 }).isAuthError
    ).toBe(false);
  });
});

// --- Fase 4 (custom heili.cloud): adaptador Wapi en el transporte Graph ---
// getEnv() está memoizado por módulo (src/lib/env.ts:65-87): cada caso recarga
// el módulo con su propio entorno stub. Ninguna red real: fetch va mockeado.

const BASE_ENV: Record<string, string> = {
  APP_BASE_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  BETTER_AUTH_SECRET: "test-secret-de-al-menos-16",
  // 32 bytes en base64 (requisito de src/lib/env.ts:15-20)
  ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
  META_WEBHOOK_VERIFY_TOKEN: "token-de-prueba",
};

/**
 * C3: la clave Wapi es por organización y vive en `wapi_credentials`. Aquí el
 * acceso a la base se sustituye por un mapa org → clave (la consulta real se
 * prueba en wapi-credentials.test.ts). `orgKeys` = claves ACTIVAS por org.
 */
async function loadClient(
  extraEnv: Record<string, string> = {},
  orgKeys: Record<string, string> = {}
) {
  vi.resetModules();
  vi.doMock("@/server/whatsapp/wapi-credentials", () => ({
    getWapiKeyByOrg: async (org: string) => orgKeys[org] ?? null,
  }));
  for (const [k, v] of Object.entries({ ...BASE_ENV, ...extraEnv })) {
    vi.stubEnv(k, v);
  }
  return import("@/lib/meta/client");
}

function mockFetchOk(json: unknown = { ok: true }) {
  const fetchMock = vi.fn().mockImplementation(
    async () =>
      new Response(JSON.stringify(json), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.doUnmock("@/server/whatsapp/wapi-credentials");
});

const WAPI = "https://wapi.example.com/api/v1/graph";
const META = "https://graph.facebook.com";

describe("decideGraphRoute (C3: decisión pura de enrutamiento)", () => {
  const base = { wapiBaseUrl: WAPI, organizationId: "org_a", orgKey: null, allowlist: [] as string[] };

  it("sin WAPI_BASE_URL → Meta, aunque haya clave propia o global", async () => {
    const { decideGraphRoute } = await loadClient();
    expect(
      decideGraphRoute({ ...base, wapiBaseUrl: undefined, orgKey: "hlp_live_a", globalKey: "hlp_live_g" })
    ).toEqual({ kind: "meta" });
  });

  it("sin organizationId → Meta siempre", async () => {
    const { decideGraphRoute } = await loadClient();
    expect(
      decideGraphRoute({ ...base, organizationId: undefined, orgKey: "hlp_live_a" })
    ).toEqual({ kind: "meta" });
  });

  it("clave propia → Wapi con ESA clave, por encima de la global y la lista", async () => {
    const { decideGraphRoute } = await loadClient();
    expect(
      decideGraphRoute({ ...base, orgKey: "hlp_live_a", globalKey: "hlp_live_g", allowlist: ["org_a", "org_b"] })
    ).toEqual({ kind: "wapi", apiKey: "hlp_live_a", source: "org" });
  });

  it("heredado: la global solo vale con EXACTAMENTE una org en WAPI_ORG_IDS y es esta", async () => {
    const { decideGraphRoute } = await loadClient();
    expect(
      decideGraphRoute({ ...base, globalKey: "hlp_live_g", allowlist: ["org_a"] })
    ).toEqual({ kind: "wapi", apiKey: "hlp_live_g", source: "legacy_global" });
  });

  it("lista con varias orgs y sin clave propia → bloqueada (jamás la global)", async () => {
    const { decideGraphRoute } = await loadClient();
    expect(
      decideGraphRoute({ ...base, globalKey: "hlp_live_g", allowlist: ["org_a", "org_b"] })
    ).toEqual({ kind: "blocked", reason: "ambiguous_legacy" });
  });

  it("lista vacía + global: la global NO se usa para nadie → Meta directo", async () => {
    const { decideGraphRoute } = await loadClient();
    expect(decideGraphRoute({ ...base, globalKey: "hlp_live_g", allowlist: [] })).toEqual({
      kind: "meta",
    });
  });

  it("org fuera de la lista (otra org es la heredada) → Meta, no la clave de la otra", async () => {
    const { decideGraphRoute } = await loadClient();
    expect(
      decideGraphRoute({ ...base, globalKey: "hlp_live_g", allowlist: ["org_b"] })
    ).toEqual({ kind: "meta" });
  });

  it("lista de una org pero sin clave global → Meta", async () => {
    const { decideGraphRoute } = await loadClient();
    expect(decideGraphRoute({ ...base, allowlist: ["org_a"] })).toEqual({ kind: "meta" });
  });
});

describe("resolveGraphTransport (C3: clave Wapi por organización)", () => {
  it("sin WAPI_BASE_URL → Meta directo (META_GRAPH_BASE_URL default), aun con clave propia", async () => {
    const { resolveGraphTransport } = await loadClient({}, { org_1: "hlp_live_propia_org1" });
    expect(await resolveGraphTransport("token-meta", "org_1")).toEqual({
      baseUrl: META,
      token: "token-meta",
      via: "meta",
    });
  });

  it("string vacía cuenta como ausente (los compose inyectan VAR=\"\")", async () => {
    const { resolveGraphTransport } = await loadClient({
      WAPI_BASE_URL: "",
      WAPI_API_KEY: "",
    });
    const t = await resolveGraphTransport("token-meta", "org_1");
    expect(t.baseUrl).toBe(META);
    expect(t.token).toBe("token-meta");
  });

  it("clave propia → Wapi con bearer = esa clave", async () => {
    const { resolveGraphTransport } = await loadClient(
      { WAPI_BASE_URL: WAPI },
      { org_1: "hlp_live_propia_org1" }
    );
    expect(await resolveGraphTransport("token-meta-inerte", "org_1")).toEqual({
      baseUrl: WAPI,
      token: "hlp_live_propia_org1",
      via: "wapi",
    });
  });

  it("org A jamás usa la clave de org B (cada una la suya)", async () => {
    const { resolveGraphTransport } = await loadClient(
      { WAPI_BASE_URL: WAPI },
      { org_a: "hlp_live_clave_de_A_xxxx", org_b: "hlp_live_clave_de_B_yyyy" }
    );
    expect((await resolveGraphTransport("t", "org_a")).token).toBe("hlp_live_clave_de_A_xxxx");
    expect((await resolveGraphTransport("t", "org_b")).token).toBe("hlp_live_clave_de_B_yyyy");
  });

  it("org sin clave propia (revocada/ausente) mientras B tiene la suya → Meta con SU token, sin la clave de B", async () => {
    const { resolveGraphTransport } = await loadClient(
      { WAPI_BASE_URL: WAPI },
      { org_b: "hlp_live_clave_de_B_yyyy" }
    );
    expect(await resolveGraphTransport("token-meta-de-A", "org_a")).toEqual({
      baseUrl: META,
      token: "token-meta-de-A",
      via: "meta",
    });
  });

  it("sin organizationId (wizard connect.ts) → Meta directo SIEMPRE", async () => {
    const { resolveGraphTransport } = await loadClient(
      { WAPI_BASE_URL: WAPI, WAPI_API_KEY: "hlp_live_global", WAPI_ORG_IDS: "org_1" },
      { org_1: "hlp_live_propia_org1" }
    );
    const t = await resolveGraphTransport("token-meta");
    expect(t.baseUrl).toBe(META);
    expect(t.token).toBe("token-meta");
  });

  it("modo heredado: WAPI_ORG_IDS=una org + clave global → Wapi con la global", async () => {
    const { resolveGraphTransport } = await loadClient({
      WAPI_BASE_URL: WAPI,
      WAPI_API_KEY: "hlp_live_global",
      WAPI_ORG_IDS: "org_1",
    });
    expect(await resolveGraphTransport("t", "org_1")).toEqual({
      baseUrl: WAPI,
      token: "hlp_live_global",
      via: "wapi",
    });
    // otra org: la clave global NO es suya
    const otra = await resolveGraphTransport("token-meta", "org_2");
    expect(otra.baseUrl).toBe(META);
    expect(otra.token).toBe("token-meta");
  });

  it("WAPI_ORG_IDS ambigua (varias orgs) sin clave propia → bloqueada: lanza y NO usa la global", async () => {
    const { resolveGraphTransport, MetaApiError } = await loadClient({
      WAPI_BASE_URL: WAPI,
      WAPI_API_KEY: "hlp_live_global_secreta",
      WAPI_ORG_IDS: "org_1, org_2",
    });
    const err = await resolveGraphTransport("t", "org_1").catch((e) => e);
    expect(err).toBeInstanceOf(MetaApiError);
    expect(err.status).toBe(0);
    expect(err.isAuthError).toBe(false);
    expect(String(err.message)).not.toContain("hlp_live_global_secreta");
    // fuera de la lista → directo a Meta con su token
    expect((await resolveGraphTransport("token-meta", "org_3")).via).toBe("meta");
  });

  it("WAPI_ORG_IDS ambigua pero con clave propia → Wapi con la propia", async () => {
    const { resolveGraphTransport } = await loadClient(
      { WAPI_BASE_URL: WAPI, WAPI_API_KEY: "hlp_live_global", WAPI_ORG_IDS: "org_1,org_2" },
      { org_1: "hlp_live_propia_org1" }
    );
    expect((await resolveGraphTransport("t", "org_1")).token).toBe("hlp_live_propia_org1");
  });

  it("WAPI_ORG_IDS vacía + clave global: la global no se usa para nadie (antes: todas las orgs)", async () => {
    const { resolveGraphTransport } = await loadClient({
      WAPI_BASE_URL: WAPI,
      WAPI_API_KEY: "hlp_live_global",
    });
    const t = await resolveGraphTransport("token-meta", "org_1");
    expect(t).toEqual({ baseUrl: META, token: "token-meta", via: "meta" });
  });

  it("la lectura de la clave falla (descifrado/BD) → lanza MetaApiError(0), sin llamar y sin caer a otra clave", async () => {
    vi.resetModules();
    vi.doMock("@/server/whatsapp/wapi-credentials", () => ({
      getWapiKeyByOrg: async () => {
        throw new Error("Unsupported state or unable to authenticate data");
      },
    }));
    for (const [k, v] of Object.entries({ ...BASE_ENV, WAPI_BASE_URL: WAPI, WAPI_API_KEY: "hlp_live_global", WAPI_ORG_IDS: "org_1" })) {
      vi.stubEnv(k, v);
    }
    const { resolveGraphTransport, MetaApiError } = await import("@/lib/meta/client");
    const err = await resolveGraphTransport("t", "org_1").catch((e) => e);
    expect(err).toBeInstanceOf(MetaApiError);
    expect(err.status).toBe(0);
  });
});

describe("describeGraphRouting (estado para la UI)", () => {
  it("etiquetas: own_key / legacy_global / blocked / direct", async () => {
    const own = await loadClient({ WAPI_BASE_URL: WAPI });
    expect(own.describeGraphRouting("org_1", true)).toBe("own_key");
    expect(own.describeGraphRouting("org_1", false)).toBe("direct");
    vi.unstubAllEnvs();
    const legacy = await loadClient({
      WAPI_BASE_URL: WAPI,
      WAPI_API_KEY: "hlp_live_global",
      WAPI_ORG_IDS: "org_1",
    });
    expect(legacy.describeGraphRouting("org_1", false)).toBe("legacy_global");
    vi.unstubAllEnvs();
    const amb = await loadClient({
      WAPI_BASE_URL: WAPI,
      WAPI_API_KEY: "hlp_live_global",
      WAPI_ORG_IDS: "org_1,org_2",
    });
    expect(amb.describeGraphRouting("org_1", false)).toBe("blocked");
    vi.unstubAllEnvs();
    const off = await loadClient();
    expect(off.describeGraphRouting("org_1", true)).toBe("direct");
  });
});

describe("graphRequest (URL y bearer según transport)", () => {
  it("modo Wapi: pega a {WAPI_BASE_URL}/{version}/{path} con Bearer = clave propia de la org", async () => {
    const { graphRequest } = await loadClient(
      { WAPI_BASE_URL: WAPI },
      { org_1: "hlp_live_propia_org1" }
    );
    const fetchMock = mockFetchOk({ id: "123" });
    await graphRequest("PHN_ID/messages", {
      method: "POST",
      token: "token-meta-inerte",
      organizationId: "org_1",
      body: { messaging_product: "whatsapp" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${WAPI}/v25.0/PHN_ID/messages`);
    expect(init.headers.Authorization).toBe("Bearer hlp_live_propia_org1");
  });

  it("dos orgs con clave: cada llamada lleva SOLO la clave de su org", async () => {
    const { graphRequest } = await loadClient(
      { WAPI_BASE_URL: WAPI, WAPI_API_KEY: "hlp_live_global", WAPI_ORG_IDS: "org_a,org_b" },
      { org_a: "hlp_live_clave_de_A_xxxx", org_b: "hlp_live_clave_de_B_yyyy" }
    );
    const fetchMock = mockFetchOk();
    await graphRequest("P/messages", { token: "t", organizationId: "org_a" });
    await graphRequest("P/messages", { token: "t", organizationId: "org_b" });
    expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe("Bearer hlp_live_clave_de_A_xxxx");
    expect(fetchMock.mock.calls[1]![1].headers.Authorization).toBe("Bearer hlp_live_clave_de_B_yyyy");
  });

  it("clave revocada/ausente de A mientras B tiene la suya: A no recibe la de B ni la global", async () => {
    const { graphRequest } = await loadClient(
      { WAPI_BASE_URL: WAPI, WAPI_API_KEY: "hlp_live_global", WAPI_ORG_IDS: "org_a,org_b" },
      { org_b: "hlp_live_clave_de_B_yyyy" }
    );
    const fetchMock = mockFetchOk();
    await expect(
      graphRequest("P/messages", { token: "meta-A", organizationId: "org_a" })
    ).rejects.toMatchObject({ name: "MetaApiError", status: 0 });
    expect(fetchMock).not.toHaveBeenCalled(); // bloqueada: ninguna llamada
  });

  it("revocada/ausente fuera de la lista: va a Meta con SU token y ningún bearer hlp_", async () => {
    const { graphRequest } = await loadClient(
      { WAPI_BASE_URL: WAPI, WAPI_API_KEY: "hlp_live_global" },
      { org_b: "hlp_live_clave_de_B_yyyy" }
    );
    const fetchMock = mockFetchOk();
    await graphRequest("P/messages", { token: "meta-A", organizationId: "org_a" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url).startsWith(META)).toBe(true);
    expect(init.headers.Authorization).toBe("Bearer meta-A");
  });

  it("modo directo: pega a graph.facebook.com con el token de la org", async () => {
    const { graphRequest } = await loadClient();
    const fetchMock = mockFetchOk({ id: "123" });
    await graphRequest("PHN_ID/messages", {
      method: "POST",
      token: "token-meta",
      organizationId: "org_1",
      body: {},
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${META}/v25.0/PHN_ID/messages`);
    expect(init.headers.Authorization).toBe("Bearer token-meta");
  });

  it("el wizard (testConnection de connect.ts) va a Meta directo aun con Wapi y clave propia", async () => {
    await loadClient({ WAPI_BASE_URL: WAPI }, { org_1: "hlp_live_propia_org1" });
    const fetchMock = mockFetchOk({
      id: "PHN_ID",
      display_phone_number: "+52 55 1234 5678",
    });
    const { testConnection } = await import("@/server/whatsapp/connect");
    const res = await testConnection("PHN_ID", "token-wizard");
    expect(res.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("https://graph.facebook.com/");
    expect(init.headers.Authorization).toBe("Bearer token-wizard");
  });
});
