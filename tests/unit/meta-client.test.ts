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

async function loadClient(extraEnv: Record<string, string> = {}) {
  vi.resetModules();
  for (const [k, v] of Object.entries({ ...BASE_ENV, ...extraEnv })) {
    vi.stubEnv(k, v);
  }
  return import("@/lib/meta/client");
}

function mockFetchOk(json: unknown = { ok: true }) {
  const fetchMock = vi.fn().mockResolvedValue(
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
});

describe("resolveGraphTransport (Fase 4: desvío a Wapi)", () => {
  it("sin WAPI_BASE_URL → Meta directo (META_GRAPH_BASE_URL default)", async () => {
    const { resolveGraphTransport } = await loadClient();
    const t = resolveGraphTransport("token-meta", "org_1");
    expect(t).toEqual({
      baseUrl: "https://graph.facebook.com",
      token: "token-meta",
    });
  });

  it("string vacía cuenta como ausente (los compose inyectan VAR=\"\")", async () => {
    const { resolveGraphTransport } = await loadClient({
      WAPI_BASE_URL: "",
      WAPI_API_KEY: "",
    });
    const t = resolveGraphTransport("token-meta", "org_1");
    expect(t.baseUrl).toBe("https://graph.facebook.com");
    expect(t.token).toBe("token-meta");
  });

  it("con WAPI_BASE_URL + WAPI_API_KEY + org → Wapi con bearer = API key", async () => {
    const { resolveGraphTransport } = await loadClient({
      WAPI_BASE_URL: "https://wapi.example.com/api/v1/graph",
      WAPI_API_KEY: "hlp_live_test",
    });
    const t = resolveGraphTransport("token-meta-inerte", "org_1");
    expect(t).toEqual({
      baseUrl: "https://wapi.example.com/api/v1/graph",
      token: "hlp_live_test",
    });
  });

  it("sin organizationId (wizard connect.ts) → Meta directo SIEMPRE", async () => {
    const { resolveGraphTransport } = await loadClient({
      WAPI_BASE_URL: "https://wapi.example.com/api/v1/graph",
      WAPI_API_KEY: "hlp_live_test",
    });
    const t = resolveGraphTransport("token-meta");
    expect(t.baseUrl).toBe("https://graph.facebook.com");
    expect(t.token).toBe("token-meta");
  });

  it("WAPI_ORG_IDS: org incluida → Wapi; org fuera de la lista → Meta", async () => {
    const { resolveGraphTransport } = await loadClient({
      WAPI_BASE_URL: "https://wapi.example.com/api/v1/graph",
      WAPI_API_KEY: "hlp_live_test",
      WAPI_ORG_IDS: "org_1, org_2",
    });
    expect(resolveGraphTransport("t", "org_1").baseUrl).toBe(
      "https://wapi.example.com/api/v1/graph"
    );
    expect(resolveGraphTransport("t", "org_2").baseUrl).toBe(
      "https://wapi.example.com/api/v1/graph"
    );
    const fuera = resolveGraphTransport("token-meta", "org_3");
    expect(fuera.baseUrl).toBe("https://graph.facebook.com");
    expect(fuera.token).toBe("token-meta");
  });

  it("WAPI_BASE_URL sin WAPI_API_KEY → Meta directo (desvío incompleto, no a medias)", async () => {
    const { resolveGraphTransport } = await loadClient({
      WAPI_BASE_URL: "https://wapi.example.com/api/v1/graph",
    });
    const t = resolveGraphTransport("token-meta", "org_1");
    expect(t.baseUrl).toBe("https://graph.facebook.com");
  });
});

describe("graphRequest (Fase 4: URL y bearer según transport)", () => {
  it("modo Wapi: pega a {WAPI_BASE_URL}/{version}/{path} con Bearer = API key", async () => {
    const { graphRequest } = await loadClient({
      WAPI_BASE_URL: "https://wapi.example.com/api/v1/graph",
      WAPI_API_KEY: "hlp_live_test",
    });
    const fetchMock = mockFetchOk({ id: "123" });
    await graphRequest("PHN_ID/messages", {
      method: "POST",
      token: "token-meta-inerte",
      organizationId: "org_1",
      body: { messaging_product: "whatsapp" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      "https://wapi.example.com/api/v1/graph/v25.0/PHN_ID/messages"
    );
    expect(init.headers.Authorization).toBe("Bearer hlp_live_test");
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
    expect(url).toBe("https://graph.facebook.com/v25.0/PHN_ID/messages");
    expect(init.headers.Authorization).toBe("Bearer token-meta");
  });

  it("el wizard (testConnection de connect.ts) va a Meta directo aun con Wapi configurado", async () => {
    await loadClient({
      WAPI_BASE_URL: "https://wapi.example.com/api/v1/graph",
      WAPI_API_KEY: "hlp_live_test",
    });
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
