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
  // Contadores de firma por proceso (globalThis): cada caso empieza de cero.
  (globalThis as { __webhookSignatureStats?: unknown }).__webhookSignatureStats = undefined;
  vi.spyOn(console, "warn").mockImplementation(() => {});
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

describe("META_APP_SECRET normalizado una sola vez (env)", () => {
  it.each([
    ["espacio final", `${APP_SECRET} `],
    ["salto de línea final", `${APP_SECRET}\n`],
    ["espacios y CRLF alrededor", `  ${APP_SECRET}\r\n`],
  ])("con %s la firma de Meta (hecha con el secreto limpio) verifica → 200", async (_l, raw) => {
    const routes = await loadRoutes({ nodeEnv: "production", secret: raw });
    const res = await post(routes, { signature: sign(payloadParaB, APP_SECRET) });
    await settled();
    expect(res.status).toBe(200);
    expect(state.ingested).toHaveLength(1);
  });

  it("solo espacios cuenta como ausente: 503 y la UI no dice «firma activa»", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const routes = await loadRoutes({ nodeEnv: "production", secret: "   \n" });
    const res = await post(routes, { signature: sign(payloadParaB, "   \n") });
    await settled();
    expect(res.status).toBe(503);
    expect(state.ingested).toEqual([]);
    const info = (await (await routes.settings.GET()).json()) as { signatureLayer: boolean };
    expect(info.signatureLayer).toBe(false);
  });
});

describe("handshake GET: verify token comparado en tiempo constante", () => {
  function handshakeWith(routes: Awaited<ReturnType<typeof loadRoutes>>, verify: string | null) {
    const q = new URLSearchParams({ "hub.mode": "subscribe", "hub.challenge": "reto-123" });
    if (verify !== null) q.set("hub.verify_token", verify);
    return routes.webhook.GET(
      new Request(`https://crm.example.com/api/webhooks/wa/${VERIFY_TOKEN}?${q}`),
      { params: Promise.resolve({ webhookToken: VERIFY_TOKEN }) }
    );
  }

  it.each([
    ["equivocado", "otro-token-cualquiera"],
    ["prefijo del bueno", VERIFY_TOKEN.slice(0, -1)],
    ["vacío", ""],
    ["ausente", null],
  ] as const)("hub.verify_token %s → 403 sin challenge", async (_l, verify) => {
    const routes = await loadRoutes({ nodeEnv: "production", secret: APP_SECRET });
    const res = await handshakeWith(routes, verify);
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain("reto-123");
  });

  it("estructural: el GET compara hub.verify_token con safeEqual, nunca con ===", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/app/api/webhooks/wa/[webhookToken]/route.ts", "utf8");
    const get = src.slice(src.indexOf("export async function GET"), src.indexOf("export async function POST"));
    expect(get).toMatch(/safeEqual\(\s*token\s*,\s*env\.META_WEBHOOK_VERIFY_TOKEN\s*\)/);
    expect(get).not.toMatch(/token\s*[!=]==?\s*env\.META_WEBHOOK_VERIFY_TOKEN/);
    expect(get).not.toMatch(/env\.META_WEBHOOK_VERIFY_TOKEN\s*[!=]==?\s*token/);
  });
});

describe("cuerpo: tope de 5 MB antes del HMAC y firma sobre los bytes crudos", () => {
  const MB = 1024 * 1024;

  function postStream(
    routes: Awaited<ReturnType<typeof loadRoutes>>,
    body: ReadableStream<Uint8Array>,
    headers: Record<string, string> = {}
  ) {
    return routes.webhook.POST(
      new Request(`https://crm.example.com/api/webhooks/wa/${VERIFY_TOKEN}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body,
        duplex: "half",
      } as RequestInit),
      { params: Promise.resolve({ webhookToken: VERIFY_TOKEN }) }
    );
  }

  it("content-length declarado > 5 MB → 413 sin leer ni un byte", async () => {
    const routes = await loadRoutes({ nodeEnv: "production", secret: APP_SECRET });
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        pulls++;
        c.enqueue(new TextEncoder().encode(payloadParaB));
        c.close();
      },
    });
    const res = await postStream(routes, body, {
      "content-length": String(5 * MB + 1),
      "x-hub-signature-256": sign(payloadParaB, APP_SECRET),
    });
    await settled();
    expect(res.status).toBe(413);
    expect(pulls).toBeLessThanOrEqual(1); // el stream puede pre-cargar un trozo, nunca leerse entero
    expect(state.ingested).toEqual([]);
  });

  it("sin content-length (chunked) se corta al pasar los 5 MB: un stream infinito no cuelga → 413", async () => {
    const routes = await loadRoutes({ nodeEnv: "production", secret: APP_SECRET });
    let pulled = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled += MB;
        c.enqueue(new Uint8Array(MB).fill(0x20));
      },
      cancel() {
        cancelled = true;
      },
    });
    const res = await postStream(routes, body, { "x-hub-signature-256": "sha256=00" });
    await settled();
    expect(res.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThanOrEqual(8 * MB);
    expect(state.ingested).toEqual([]);
  });

  it("BOM al inicio: la firma de Meta sobre los bytes crudos verifica y el JSON se lee → 200", async () => {
    const routes = await loadRoutes({ nodeEnv: "production", secret: APP_SECRET });
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(payloadParaB, "utf8")]);
    const signature = `sha256=${createHmac("sha256", APP_SECRET).update(bytes).digest("hex")}`;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(bytes));
        c.close();
      },
    });
    const res = await postStream(routes, body, { "x-hub-signature-256": signature });
    await settled();
    expect(res.status).toBe(200);
    expect(state.ingested).toHaveLength(1);
  });

  it("BOM al inicio firmado sobre el texto SIN BOM (no lo que llegó) → 401", async () => {
    const routes = await loadRoutes({ nodeEnv: "production", secret: APP_SECRET });
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(payloadParaB, "utf8")]);
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(bytes));
        c.close();
      },
    });
    const res = await postStream(routes, body, { "x-hub-signature-256": sign(payloadParaB, APP_SECRET) });
    await settled();
    expect(res.status).toBe(401);
    expect(state.ingested).toEqual([]);
  });
});

describe("firma inválida: ya no es un 401 mudo (log limitado + contadores en Configuración)", () => {
  type Stats = { lastVerifiedAt: string | null; lastInvalidAt: string | null; invalidSinceBoot: number };
  async function stats(routes: Awaited<ReturnType<typeof loadRoutes>>): Promise<Stats> {
    const info = (await (await routes.settings.GET()).json()) as { signatureStats: Stats };
    return info.signatureStats;
  }

  it("secreto equivocado: una línea clara por minuto, sin la cabecera, el secreto ni el token", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const now = vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    const routes = await loadRoutes({ nodeEnv: "production", secret: APP_SECRET });
    const wrong = sign(payloadParaB, "secreto-de-OTRA-app");
    expect((await post(routes, { signature: wrong })).status).toBe(401);
    expect((await post(routes, { signature: wrong })).status).toBe(401);
    expect((await post(routes, { signature: null })).status).toBe(401);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).toContain("[webhook] firma inválida (401)");
    expect(line).toContain("cabecera presente=sí");
    expect(line).toContain(`${Buffer.byteLength(payloadParaB)} bytes`);
    expect(line).toContain("META_APP_SECRET no coincide con la app que firma");
    for (const secret of [APP_SECRET, "secreto-de-OTRA-app", wrong, wrong.slice(7), VERIFY_TOKEN]) {
      expect(line).not.toContain(secret);
    }

    // pasado un minuto vuelve a registrar (y dice que esta vez no había cabecera)
    now.mockReturnValue(1_800_000_000_000 + 60_000);
    await post(routes, { signature: null });
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[1]?.[0])).toContain("cabecera presente=no");
    expect(String(warn.mock.calls[1]?.[0])).toContain("4 desde el arranque");
    expect(state.ingested).toEqual([]);
  });

  it("GET /api/settings/webhook (owner/admin) devuelve última verificada, última inválida y rechazos", async () => {
    const routes = await loadRoutes({ nodeEnv: "production", secret: APP_SECRET });
    expect(await stats(routes)).toEqual({ lastVerifiedAt: null, lastInvalidAt: null, invalidSinceBoot: 0 });

    expect((await post(routes, { signature: sign(payloadParaB, APP_SECRET) })).status).toBe(200);
    await settled();
    const s1 = await stats(routes);
    expect(s1.lastVerifiedAt).not.toBeNull();
    expect(s1.invalidSinceBoot).toBe(0);

    await post(routes, { signature: sign(payloadParaB, "otro") });
    await post(routes, { signature: null });
    const s2 = await stats(routes);
    expect(s2.invalidSinceBoot).toBe(2);
    expect(s2.lastInvalidAt).not.toBeNull();
    expect(s2.lastVerifiedAt).toBe(s1.lastVerifiedAt);

    const raw = await (await routes.settings.GET()).text();
    expect(raw).not.toContain(APP_SECRET);
  });

  it("un member no ve los contadores (403)", async () => {
    state.session = { userId: "u_m", organizationId: "org_a", role: "member" };
    const routes = await loadRoutes({ nodeEnv: "production", secret: APP_SECRET });
    const res = await routes.settings.GET();
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain("signatureStats");
  });

  it("el gate de pruebas sin secreto NO cuenta como firma verificada", async () => {
    const routes = await loadRoutes({ nodeEnv: "test", mocks: true });
    expect((await post(routes, { signature: null })).status).toBe(200);
    await settled();
    expect((await stats(routes)).lastVerifiedAt).toBeNull();
  });

  it("el 503 por falta de secreto no cuenta como firma inválida", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const noSecret = await loadRoutes({ nodeEnv: "production" });
    expect((await post(noSecret, { signature: null })).status).toBe(503);
    expect((await stats(noSecret)).invalidSinceBoot).toBe(0);
  });
});
