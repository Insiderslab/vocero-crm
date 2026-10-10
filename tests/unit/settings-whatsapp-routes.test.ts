import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Conexión de WhatsApp (`/api/settings/whatsapp`, `/test`, `/api/settings/webhook`):
 * solo owner/admin, y siempre dentro de la organización de la sesión. Un
 * member no puede leer ni sustituir las credenciales ni ver el token de
 * verificación del webhook. Dos organizaciones: ninguna ve ni toca la otra.
 */

const state = vi.hoisted(() => ({
  session: { userId: "u_1", organizationId: "org_a", role: "owner" } as
    | { userId: string; organizationId: string; role: string }
    | null,
  // Conexiones guardadas, por organización.
  connections: {} as Record<string, Record<string, unknown>>,
  lookups: [] as string[],
  saves: [] as Record<string, unknown>[],
  tests: [] as { phoneNumberId: string; token: string }[],
  subscribes: 0,
}));

vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return {
    ...actual,
    requireSession: async () => {
      if (!state.session) throw new actual.UnauthorizedError();
      return state.session;
    },
  };
});

vi.mock("@/server/whatsapp/credentials", () => ({
  getCredentialsByOrg: async (organizationId: string) => {
    state.lookups.push(organizationId);
    return state.connections[organizationId] ?? null;
  },
  saveCredentials: async (input: Record<string, unknown>) => {
    state.saves.push(input);
  },
  tokenLast4: (token: string) => token.slice(-4),
}));

vi.mock("@/server/whatsapp/connect", () => ({
  testConnection: async (phoneNumberId: string, token: string) => {
    state.tests.push({ phoneNumberId, token });
    return { ok: true, displayPhoneNumber: "+52 55 0000 0000", verifiedName: "Demo" };
  },
  subscribeAppToWaba: async () => {
    state.subscribes += 1;
  },
}));

vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    APP_BASE_URL: "https://crm.example.com",
    META_WEBHOOK_VERIFY_TOKEN: "SECRETO-DE-VERIFICACION",
    META_APP_SECRET: undefined,
  }),
}));

import { GET as getConnection, PUT as putConnection } from "@/app/api/settings/whatsapp/route";
import { POST as testRoute } from "@/app/api/settings/whatsapp/test/route";
import { GET as getWebhook } from "@/app/api/settings/webhook/route";

const json = (method: string, body: unknown) =>
  new Request("http://localhost/api/settings/whatsapp", {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

const valid = { wabaId: "waba_1", phoneNumberId: "pn_1", token: "EAAB-token-completo-1234" };

/** Las cuatro operaciones protegidas, con el cuerpo válido que necesitan. */
const operaciones: [string, () => Promise<Response>][] = [
  ["GET /api/settings/whatsapp", () => getConnection()],
  ["PUT /api/settings/whatsapp", () => putConnection(json("PUT", valid))],
  [
    "POST /api/settings/whatsapp/test",
    () => testRoute(json("POST", { phoneNumberId: "pn_1", token: valid.token })),
  ],
  ["GET /api/settings/webhook", () => getWebhook()],
];

function sinEfectos() {
  expect(state.lookups).toHaveLength(0);
  expect(state.saves).toHaveLength(0);
  expect(state.tests).toHaveLength(0);
  expect(state.subscribes).toBe(0);
}

describe("conexión de WhatsApp: solo owner/admin", () => {
  beforeEach(() => {
    state.session = { userId: "u_1", organizationId: "org_a", role: "owner" };
    state.connections = {
      org_a: {
        wabaId: "waba_A",
        phoneNumberId: "pn_A",
        displayPhoneNumber: "+52 55 1111 1111",
        verifiedName: "Negocio A",
        status: "connected",
        token: "TOKEN-DE-A-9999",
      },
    };
    state.lookups = [];
    state.saves = [];
    state.tests = [];
    state.subscribes = 0;
  });

  it.each(operaciones)("%s: un member recibe 403, sin leer, probar ni guardar nada", async (_n, run) => {
    state.session = { userId: "u_m", organizationId: "org_a", role: "member" };
    const res = await run();
    expect(res.status).toBe(403);
    const text = await res.text();
    expect(text).not.toContain("SECRETO-DE-VERIFICACION");
    expect(text).not.toContain("waba_A");
    expect(text).not.toContain("9999");
    sinEfectos();
  });

  it.each(["", "Owner", "ADMIN", "viewer", "superadmin"])(
    "rol desconocido %j: fail-closed, 403 en todas",
    async (role) => {
      state.session = { userId: "u_x", organizationId: "org_a", role };
      for (const [, run] of operaciones) expect((await run()).status).toBe(403);
      sinEfectos();
    }
  );

  it.each(operaciones)("%s: sin sesión → 401", async (_n, run) => {
    state.session = null;
    expect((await run()).status).toBe(401);
    sinEfectos();
  });

  it.each(["owner", "admin"])("%s lee, prueba, guarda y ve los datos del webhook", async (role) => {
    state.session = { userId: "u_1", organizationId: "org_a", role };

    const get = await getConnection();
    expect(get.status).toBe(200);
    const conn = ((await get.json()) as { connection: Record<string, unknown> }).connection;
    expect(conn.wabaId).toBe("waba_A");
    // Del token solo salen los últimos 4.
    expect(conn.tokenLast4).toBe("9999");
    expect(JSON.stringify(conn)).not.toContain("TOKEN-DE-A");

    const test = await testRoute(json("POST", { phoneNumberId: "pn_1", token: valid.token }));
    expect(test.status).toBe(200);
    expect(state.tests).toHaveLength(1);

    const put = await putConnection(json("PUT", valid));
    expect(put.status).toBe(200);
    expect(state.saves).toHaveLength(1);
    expect(state.subscribes).toBe(1);

    const hook = await getWebhook();
    expect(hook.status).toBe(200);
    const h = (await hook.json()) as { url: string; verifyToken: string };
    expect(h.verifyToken).toBe("SECRETO-DE-VERIFICACION");
    expect(h.url).toContain("SECRETO-DE-VERIFICACION");
  });

  it("el rol que cuenta es el de la organización de la sesión: owner en B no abre A", async () => {
    // El mismo usuario es owner de org_b y member de org_a. La sesión activa
    // es org_a con rol member: 403, aunque en otra organización mande.
    state.session = { userId: "u_dual", organizationId: "org_a", role: "member" };
    for (const [, run] of operaciones) expect((await run()).status).toBe(403);
    sinEfectos();
  });
});

describe("conexión de WhatsApp: aislamiento entre organizaciones", () => {
  beforeEach(() => {
    state.connections = {
      org_a: { wabaId: "waba_A", phoneNumberId: "pn_A", status: "connected", token: "TOKEN-DE-A-9999" },
      org_b: { wabaId: "waba_B", phoneNumberId: "pn_B", status: "connected", token: "TOKEN-DE-B-7777" },
    };
    state.lookups = [];
    state.saves = [];
    state.tests = [];
    state.subscribes = 0;
  });

  it("el owner de B lee solo la conexión de B, nunca la de A", async () => {
    state.session = { userId: "u_b", organizationId: "org_b", role: "owner" };
    const res = await getConnection();
    const text = JSON.stringify(await res.json());
    expect(state.lookups).toEqual(["org_b"]);
    expect(text).toContain("waba_B");
    expect(text).not.toContain("waba_A");
    expect(text).not.toContain("pn_A");
    expect(text).not.toContain("9999");
  });

  it("una organización sin conexión no recibe la de otra", async () => {
    state.session = { userId: "u_c", organizationId: "org_c", role: "admin" };
    const res = await getConnection();
    expect(await res.json()).toEqual({ connection: null });
    expect(state.lookups).toEqual(["org_c"]);
  });

  it("guardar como B escribe en B aunque el cuerpo nombre a A", async () => {
    state.session = { userId: "u_b", organizationId: "org_b", role: "admin" };
    const res = await putConnection(json("PUT", { ...valid, organizationId: "org_a" }));
    expect(res.status).toBe(200);
    expect(state.saves).toHaveLength(1);
    expect(state.saves[0]?.organizationId).toBe("org_b");
    expect(JSON.stringify(state.saves)).not.toContain("org_a");
  });

  it("un member de A, aunque conozca el wabaId de A, no sustituye nada de A", async () => {
    state.session = { userId: "u_m", organizationId: "org_a", role: "member" };
    const res = await putConnection(json("PUT", { ...valid, wabaId: "waba_A" }));
    expect(res.status).toBe(403);
    expect(state.saves).toHaveLength(0);
  });
});
