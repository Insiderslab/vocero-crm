import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Webhook público de WhatsApp `/api/webhooks/wa/[webhookToken]` con la firma
 * OBLIGATORIA (fail-closed) y la URL del webhook visible solo a owner/admin.
 *
 * El escenario de fondo: una instancia con varias organizaciones. Cualquier
 * owner/admin de la organización A ve la URL (con el segmento secreto). Antes,
 * sin META_APP_SECRET, con esa URL podía mandar un evento con el número de la
 * organización B y el CRM lo ingería en B. Ahora:
 * - sin secreto (fuera del gate de pruebas) el webhook rechaza todo con 503;
 * - con secreto, sin firma válida → 401. Firmar con lo único que conoce
 *   (el token de la URL) tampoco sirve.
 * En ningún caso rechazado se llega a la ingesta.
 *
 * `getEnv()` memoriza: cada caso fija el entorno con `vi.stubEnv` y vuelve a
 * importar las rutas tras `vi.resetModules()`.
 */

const state = vi.hoisted(() => ({
  session: { userId: "u_a", organizationId: "org_a", role: "admin" } as
    | { userId: string; organizationId: string; role: string }
    | null,
  ingested: [] as unknown[],
  pending: [] as Promise<unknown>[],
}));

vi.mock("next/server", () => ({
  // after(): en la ruta real corre tras responder; aquí se ejecuta y se espera.
  after: (fn: () => Promise<unknown>) => {
    state.pending.push(fn());
  },
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

vi.mock("@/server/inbox/ingest", () => ({
  processMessagesValue: async (value: unknown) => {
    state.ingested.push(value);
  },
  processEchoesValue: async (value: unknown) => {
    state.ingested.push(value);
  },
}));
vi.mock("@/server/whatsapp/template-events", () => ({
  processTemplateStatusValue: async (_id: unknown, value: unknown) => {
    state.ingested.push(value);
  },
}));
vi.mock("@/server/inbox/coexistence", () => ({
  processHistoryValue: async (value: unknown) => {
    state.ingested.push(value);
  },
  processStateSyncValue: async (value: unknown) => {
    state.ingested.push(value);
  },
  processAccountUpdateValue: async (_id: unknown, value: unknown) => {
    state.ingested.push(value);
  },
}));

const VERIFY_TOKEN = "segmento-secreto-de-la-url-0001";
const APP_SECRET = "app-secret-de-meta-solo-del-servidor";

/** Evento dirigido al número de la organización B. */
const payloadParaB = JSON.stringify({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "waba_b",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "5215500000002", phone_number_id: "pn_org_b" },
            contacts: [{ profile: { name: "Falso" }, wa_id: "5215512345678" }],
            messages: [
              {
                from: "5215512345678",
                id: "wamid.inyectado",
                timestamp: "1700000000",
                type: "text",
                text: { body: "mensaje inyectado" },
              },
            ],
          },
        },
      ],
    },
  ],
});

const sign = (body: string, key: string) =>
  `sha256=${createHmac("sha256", key).update(body, "utf8").digest("hex")}`;

type EnvCase = { nodeEnv: string; mocks?: boolean; secret?: string };

async function loadRoutes(env: EnvCase) {
  vi.stubEnv("NODE_ENV", env.nodeEnv);
  vi.stubEnv("WA_MOCK_ENABLED", env.mocks ? "true" : "");
  vi.stubEnv("META_APP_SECRET", env.secret ?? "");
  vi.resetModules();
  const webhook = await import("@/app/api/webhooks/wa/[webhookToken]/route");
  const settings = await import("@/app/api/settings/webhook/route");
  return { webhook, settings };
}

function post(
  routes: Awaited<ReturnType<typeof loadRoutes>>,
  opts: { token?: string; body?: string; signature?: string | null } = {}
) {
  const token = opts.token ?? VERIFY_TOKEN;
  const body = opts.body ?? payloadParaB;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.signature) headers["x-hub-signature-256"] = opts.signature;
  return routes.webhook.POST(
    new Request(`https://crm.example.com/api/webhooks/wa/${token}`, {
      method: "POST",
      headers,
      body,
    }),
    { params: Promise.resolve({ webhookToken: token }) }
  );
}

function handshake(routes: Awaited<ReturnType<typeof loadRoutes>>, token = VERIFY_TOKEN) {
  const url =
    `https://crm.example.com/api/webhooks/wa/${token}` +
    `?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=reto-123`;
  return routes.webhook.GET(new Request(url), {
    params: Promise.resolve({ webhookToken: token }),
  });
}

async function settled() {
  await Promise.all(state.pending);
}

beforeEach(() => {
  state.session = { userId: "u_a", organizationId: "org_a", role: "admin" };
  state.ingested = [];
  state.pending = [];
  vi.stubEnv("APP_BASE_URL", "https://crm.example.com");
  vi.stubEnv("DATABASE_URL", "postgresql://u:p@localhost:5432/db");
  vi.stubEnv("BETTER_AUTH_SECRET", "secreto-de-auth-de-prueba-0001");
  vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 1).toString("base64"));
  vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", VERIFY_TOKEN);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("producción SIN META_APP_SECRET: fail-closed", () => {
  it("POST con la URL correcta → 503 y nada se ingiere", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const routes = await loadRoutes({ nodeEnv: "production" });
    const res = await post(routes);
    await settled();
    expect(res.status).toBe(503);
    expect(state.ingested).toEqual([]);
  });

  it("el handshake GET de Meta también se rechaza (503): el fallo se ve al configurar", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const routes = await loadRoutes({ nodeEnv: "production" });
    const res = await handshake(routes);
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain("reto-123");
  });

  it("lo registra claramente, sin imprimir el token de la URL, y como mucho una vez por minuto", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const routes = await loadRoutes({ nodeEnv: "production" });
    await post(routes);
    await post(routes);
    await handshake(routes);
    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0]?.[0]);
    expect(line).toContain("META_APP_SECRET");
    expect(line).toContain("503");
    expect(line).not.toContain(VERIFY_TOKEN);
  });

  it("el gate de mocks NO se abre en producción: WA_MOCK_ENABLED=true sigue dando 503", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const routes = await loadRoutes({ nodeEnv: "production", mocks: true });
    const res = await post(routes);
    await settled();
    expect(res.status).toBe(503);
    expect(state.ingested).toEqual([]);
  });

  it("desarrollo sin mocks tampoco acepta eventos sin firma", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const routes = await loadRoutes({ nodeEnv: "development" });
    const res = await post(routes);
    await settled();
    expect(res.status).toBe(503);
    expect(state.ingested).toEqual([]);
  });

  it("token de URL equivocado → 404 antes de mirar la configuración (no revela nada)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const routes = await loadRoutes({ nodeEnv: "production" });
    const res = await post(routes, { token: "otro-token-cualquiera" });
    expect(res.status).toBe(404);
    expect(log).not.toHaveBeenCalled();
  });
});

describe("producción CON META_APP_SECRET: la firma decide", () => {
  it("URL correcta sin firma → 401 y nada se ingiere", async () => {
    const routes = await loadRoutes({ nodeEnv: "production", secret: APP_SECRET });
    const res = await post(routes, { signature: null });
    await settled();
    expect(res.status).toBe(401);
    expect(state.ingested).toEqual([]);
  });

  it("firmar con el token de la URL (lo único que conoce un usuario) → 401", async () => {
    const routes = await loadRoutes({ nodeEnv: "production", secret: APP_SECRET });
    const res = await post(routes, { signature: sign(payloadParaB, VERIFY_TOKEN) });
    await settled();
    expect(res.status).toBe(401);
    expect(state.ingested).toEqual([]);
  });

  it("firma de otro cuerpo → 401", async () => {
    const routes = await loadRoutes({ nodeEnv: "production", secret: APP_SECRET });
    const res = await post(routes, { signature: sign("{}", APP_SECRET) });
    await settled();
    expect(res.status).toBe(401);
    expect(state.ingested).toEqual([]);
  });

  it("firma válida de Meta → 200 y el evento se procesa", async () => {
    const routes = await loadRoutes({ nodeEnv: "production", secret: APP_SECRET });
    const res = await post(routes, { signature: sign(payloadParaB, APP_SECRET) });
    await settled();
    expect(res.status).toBe(200);
    expect(state.ingested).toHaveLength(1);
  });

  it("handshake GET correcto → 200 con el challenge", async () => {
    const routes = await loadRoutes({ nodeEnv: "production", secret: APP_SECRET });
    const res = await handshake(routes);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("reto-123");
  });
});

describe("gate de pruebas (WA_MOCK_ENABLED=true fuera de producción)", () => {
  it("sin secreto acepta eventos sin firma (self-test con mocks)", async () => {
    const routes = await loadRoutes({ nodeEnv: "test", mocks: true });
    const res = await post(routes, { signature: null });
    await settled();
    expect(res.status).toBe(200);
    expect(state.ingested).toHaveLength(1);
  });

  it("con secreto la firma se verifica igual: firma errónea → 401", async () => {
    const routes = await loadRoutes({ nodeEnv: "development", mocks: true, secret: APP_SECRET });
    const res = await post(routes, { signature: sign(payloadParaB, "otro") });
    await settled();
    expect(res.status).toBe(401);
    expect(state.ingested).toEqual([]);
  });
});

describe("URL del webhook: solo owner/admin, y aun así no basta para inyectar", () => {
  it("un member no recibe la URL ni el token (403)", async () => {
    state.session = { userId: "u_m", organizationId: "org_a", role: "member" };
    const routes = await loadRoutes({ nodeEnv: "production", secret: APP_SECRET });
    const res = await routes.settings.GET();
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain(VERIFY_TOKEN);
  });

  it("sin sesión → 401 sin URL", async () => {
    state.session = null;
    const routes = await loadRoutes({ nodeEnv: "production", secret: APP_SECRET });
    const res = await routes.settings.GET();
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain(VERIFY_TOKEN);
  });

  it.each([
    ["sin secreto", 503, undefined],
    ["con secreto", 401, APP_SECRET],
  ] as const)(
    "%s: el admin de A usa la URL que ve para mandar un evento al número de B → %i, nada en B",
    async (_label, expected, secret) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const routes = await loadRoutes({ nodeEnv: "production", secret });
      const info = (await (await routes.settings.GET()).json()) as {
        url: string;
        signatureLayer: boolean;
        signatureRequired: boolean;
      };
      expect(info.url).toBe(`https://crm.example.com/api/webhooks/wa/${VERIFY_TOKEN}`);
      expect(info.signatureRequired).toBe(true);
      expect(info.signatureLayer).toBe(Boolean(secret));
      expect(JSON.stringify(info)).not.toContain(APP_SECRET);

      const token = new URL(info.url).pathname.split("/").pop()!;
      const res = await post(routes, { token, signature: sign(payloadParaB, token) });
      await settled();
      expect(res.status).toBe(expected);
      expect(state.ingested).toEqual([]);
    }
  );

  it("en el gate de pruebas la UI sabe que la firma no es obligatoria", async () => {
    const routes = await loadRoutes({ nodeEnv: "test", mocks: true });
    const info = (await (await routes.settings.GET()).json()) as { signatureRequired: boolean };
    expect(info.signatureRequired).toBe(false);
  });
});
