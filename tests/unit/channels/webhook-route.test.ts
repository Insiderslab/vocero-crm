import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 005-livello-canali (M1.3, T025) — Route unica dei webhook per canale
 * `src/app/api/webhooks/[channel]/[webhookToken]/route.ts` (ADR §3.5).
 *
 * Ordine nel gestore: slug → adattatore (404); token del segmento a tempo
 * costante (404 SENZA leggere il body); configurazione (503, PR #9); body con
 * tetto (413); firma (401); JSON (200 senza effetti se illeggibile); 200 e
 * lavoro in `after()`. Qui si guarda solo il confine HTTP: l'elaborazione degli
 * eventi è una spia.
 */

const state = vi.hoisted(() => ({
  processed: [] as unknown[],
  pending: [] as Promise<unknown>[],
}));

vi.mock("next/server", () => ({
  after: (fn: () => Promise<unknown>) => {
    state.pending.push(fn());
  },
}));

vi.mock("@/server/channels/core/ingest", () => ({
  processInboundEvents: async (_adapter: unknown, events: unknown[]) => {
    state.processed.push(...events);
  },
}));

const VERIFY_TOKEN = "segmento-secreto-de-la-url-0001";
const APP_SECRET = "app-secret-de-meta-solo-del-servidor";

const payload = JSON.stringify({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "waba_a",
      changes: [
        {
          field: "messages",
          value: {
            metadata: { phone_number_id: "pn_a" },
            contacts: [{ profile: { name: "Ana" }, wa_id: "5215512345678" }],
            messages: [
              { from: "5215512345678", id: "wamid.1", timestamp: "1700000000", type: "text", text: { body: "hola" } },
            ],
          },
        },
      ],
    },
  ],
});

const sign = (body: string, key: string) =>
  `sha256=${createHmac("sha256", key).update(body, "utf8").digest("hex")}`;

async function loadRoute() {
  vi.resetModules();
  return import("@/app/api/webhooks/[channel]/[webhookToken]/route");
}

/** Un body che registra se qualcuno lo ha letto. */
function trackedBody(text: string) {
  const track = { pulled: false };
  // highWaterMark 0: el stream no se pre-carga; `pull` solo corre si alguien lee.
  const body = new ReadableStream<Uint8Array>(
    {
      pull(c) {
        track.pulled = true;
        c.enqueue(new TextEncoder().encode(text));
        c.close();
      },
    },
    { highWaterMark: 0 }
  );
  return { body, track };
}

async function post(
  route: Awaited<ReturnType<typeof loadRoute>>,
  opts: { channel?: string; token?: string; body?: string; signature?: string | null }
) {
  const channel = opts.channel ?? "wa";
  const token = opts.token ?? VERIFY_TOKEN;
  const { body, track } = trackedBody(opts.body ?? payload);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.signature) headers["x-hub-signature-256"] = opts.signature;
  const req = new Request(`https://crm.example.com/api/webhooks/${channel}/${token}`, {
    method: "POST",
    headers,
    body,
    duplex: "half",
  } as RequestInit);
  const res = await route.POST(req, { params: Promise.resolve({ channel, webhookToken: token }) });
  await Promise.all(state.pending);
  return { res, bodyRead: track.pulled || req.bodyUsed };
}

beforeEach(() => {
  (globalThis as { __webhookSignatureStats?: unknown }).__webhookSignatureStats = undefined;
  state.processed = [];
  state.pending = [];
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("WA_MOCK_ENABLED", "");
  vi.stubEnv("APP_BASE_URL", "https://crm.example.com");
  vi.stubEnv("DATABASE_URL", "postgresql://u:p@localhost:5432/db");
  vi.stubEnv("BETTER_AUTH_SECRET", "secreto-de-auth-de-prueba-0001");
  vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 1).toString("base64"));
  vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", VERIFY_TOKEN);
  vi.stubEnv("META_APP_SECRET", APP_SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("route /api/webhooks/[channel]/[webhookToken]", () => {
  it("slug sconosciuto → 404 senza leggere il body (POST e GET)", async () => {
    const route = await loadRoute();
    for (const channel of ["instagram", "WA", "wa ", "fake", "..", ""]) {
      const { res, bodyRead } = await post(route, { channel, signature: sign(payload, APP_SECRET) });
      expect(res.status, channel).toBe(404);
      expect(bodyRead, channel).toBe(false);
      const get = await route.GET(
        new Request(`https://crm.example.com/api/webhooks/${channel}/${VERIFY_TOKEN}?hub.mode=subscribe`),
        { params: Promise.resolve({ channel, webhookToken: VERIFY_TOKEN }) }
      );
      expect(get.status, channel).toBe(404);
    }
    expect(state.processed).toEqual([]);
  });

  it("token errato → 404 senza leggere il body", async () => {
    const route = await loadRoute();
    for (const token of ["otro-token", VERIFY_TOKEN.slice(0, -1), `${VERIFY_TOKEN}x`]) {
      const { res, bodyRead } = await post(route, { token, signature: sign(payload, APP_SECRET) });
      expect(res.status, token).toBe(404);
      expect(bodyRead, token).toBe(false);
    }
    expect(state.processed).toEqual([]);
  });

  it("firma errata o assente → 401, nessun evento elaborato", async () => {
    const route = await loadRoute();
    for (const signature of [sign(payload, "otro-secreto"), sign("{}", APP_SECRET), null]) {
      const { res } = await post(route, { signature });
      expect(res.status).toBe(401);
    }
    expect(state.processed).toEqual([]);
  });

  it("stesso URL di oggi: /api/webhooks/wa/<token> con firma valida → 200 {received:true} e gli eventi parsati", async () => {
    const route = await loadRoute();
    const { res, bodyRead } = await post(route, { signature: sign(payload, APP_SECRET) });
    expect(res.status).toBe(200);
    expect(bodyRead).toBe(true); // control: la sonda del body funciona
    expect(await res.json()).toEqual({ received: true });
    expect(state.processed).toMatchObject([
      { kind: "message", channel: "whatsapp", externalMessageId: "wamid.1" },
    ]);
  });

  it("body illeggibile (firmato) → 200 senza effetti", async () => {
    const route = await loadRoute();
    const { res } = await post(route, { body: "{no-json", signature: sign("{no-json", APP_SECRET) });
    expect(res.status).toBe(200);
    expect(state.processed).toEqual([]);
  });

  it("la firma viene PRIMA del JSON: body illeggibile senza firma valida → 401, non 200", async () => {
    const route = await loadRoute();
    expect((await post(route, { body: "{no-json", signature: null })).res.status).toBe(401);
    expect((await post(route, { body: "{no-json", signature: sign("{no-json", "otro") })).res.status).toBe(401);
    expect(state.processed).toEqual([]);
  });

  it("senza META_APP_SECRET in produzione → 503 prima di leggere il body", async () => {
    vi.stubEnv("META_APP_SECRET", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const route = await loadRoute();
    const { res, bodyRead } = await post(route, { signature: sign(payload, APP_SECRET) });
    expect(res.status).toBe(503);
    expect(bodyRead).toBe(false);
    expect(state.processed).toEqual([]);
  });

  it("GET di verifica sullo slug wa: challenge con il token giusto, 403 con quello sbagliato", async () => {
    const route = await loadRoute();
    const get = (verify: string) =>
      route.GET(
        new Request(
          `https://crm.example.com/api/webhooks/wa/${VERIFY_TOKEN}?hub.mode=subscribe&hub.verify_token=${verify}&hub.challenge=reto-9`
        ),
        { params: Promise.resolve({ channel: "wa", webhookToken: VERIFY_TOKEN }) }
      );
    const ok = await get(VERIFY_TOKEN);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("reto-9");
    expect((await get("otro")).status).toBe(403);
  });

  it("la cartella statica /api/webhooks/wa/ non esiste più (una sola route per lo stesso URL)", async () => {
    const { existsSync } = await import("node:fs");
    expect(existsSync("src/app/api/webhooks/wa")).toBe(false);
    expect(existsSync("src/app/api/webhooks/[channel]/[webhookToken]/route.ts")).toBe(true);
  });
});
