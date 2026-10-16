import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  classifyWebhookRoute,
  expectedWebhookUrl,
  isUnusuallyQuiet,
  webhookRouteAlarming,
  type WebhookRouteCheckResponse,
} from "@/lib/webhook-route";

/**
 * 014 — Guardia del webhook: Meta manda gli eventi WhatsApp al CRM?
 * Caso reale del 16/10: un flusso n8n («WhatsApp Trigger») si era preso il
 * callback dell'app e i messaggi non arrivavano più, senza nessun avviso.
 * Qui: classificazione pura, silenzio insolito, controllo con Meta (doppio di
 * fetch), cache, ripristino del callback e nessun segreto in uscita.
 */

const VERIFY_TOKEN = "unit-verify-token-route-0042";
const APP_SECRET = "unit-app-secret-route-00000042";
const APP_ID = "609974691965875";
const WA_TOKEN = "EAAGUnitFixtureTokenRouteQz7X";
const EXPECTED = `https://crm.heili.cloud/api/webhooks/wa/${VERIFY_TOKEN}`;
const N8N = "https://insiderslab.app.n8n.cloud/webhook/942f3c9d-2c77-47d2-9031-5b232f4430d3/webhook";
const NOW = new Date("2026-10-16T21:00:00Z");

const fixture = vi.hoisted(() => ({
  creds: null as null | Record<string, unknown>,
}));

vi.mock("@/server/whatsapp/credentials", () => ({
  getCredentialsByOrg: async () => fixture.creds,
}));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("APP_BASE_URL", "https://crm.heili.cloud");
  vi.stubEnv("DATABASE_URL", "postgresql://x:x@localhost:5432/x");
  vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-test-secret");
  vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32).toString("base64"));
  vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", VERIFY_TOKEN);
  vi.stubEnv("META_APP_SECRET", APP_SECRET);
  vi.stubEnv("META_APP_ID", APP_ID);
  vi.stubEnv("META_ES_CONFIG_ID", "998877665544");
  vi.stubEnv("META_GRAPH_BASE_URL", "https://graph.facebook.com");
  vi.stubEnv("WAPI_BASE_URL", "");
  fixture.creds = {
    id: "mc_1",
    organizationId: "org_a",
    wabaId: "1027272492350148",
    phoneNumberId: "671133866076775",
    displayPhoneNumber: "+1 555-779-6249",
    verifiedName: "Insiderlabs",
    status: "connected",
    onboardingMode: "manual",
    appDisconnectedAt: null,
    token: WA_TOKEN,
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ----------------------------- pura ----------------------------- */

describe("classifyWebhookRoute", () => {
  it("callback dell'app = CRM → ok", () => {
    const r = classifyWebhookRoute({ application: EXPECTED }, EXPECTED, NOW);
    expect(r).toMatchObject({ state: "ok", level: "application", foreignHost: null });
    expect(webhookRouteAlarming(r)).toBe(false);
  });

  it("maiuscole nell'host e barra finale non contano", () => {
    const r = classifyWebhookRoute({ application: `https://CRM.heili.cloud/api/webhooks/wa/${VERIFY_TOKEN}/` }, EXPECTED);
    expect(r.state).toBe("ok");
  });

  it("caso del 16/10: callback su n8n → elsewhere, solo l'host (mai il percorso)", () => {
    const r = classifyWebhookRoute({ application: N8N }, EXPECTED, NOW);
    expect(r).toMatchObject({
      state: "elsewhere",
      level: "application",
      foreignHost: "insiderslab.app.n8n.cloud",
      sameHost: false,
    });
    expect(webhookRouteAlarming(r)).toBe(true);
    const json = JSON.stringify(r);
    expect(json).not.toContain("942f3c9d");
    expect(json).not.toContain(VERIFY_TOKEN);
  });

  it("stesso host ma token vecchio → elsewhere con sameHost, senza il token", () => {
    const r = classifyWebhookRoute({ application: "https://crm.heili.cloud/api/webhooks/wa/vecchio-token-123" }, EXPECTED);
    expect(r).toMatchObject({ state: "elsewhere", sameHost: true, foreignHost: "crm.heili.cloud" });
    expect(JSON.stringify(r)).not.toContain("vecchio-token-123");
  });

  it("override sul WABA vince sull'app", () => {
    const r = classifyWebhookRoute(
      { application: EXPECTED, whatsapp_business_account: "https://agenzia.example.com/hook" },
      EXPECTED
    );
    expect(r).toMatchObject({ state: "override", level: "whatsapp_business_account", foreignHost: "agenzia.example.com" });
  });

  it("override sul numero vince su tutto (anche se è il CRM)", () => {
    const r = classifyWebhookRoute(
      { application: N8N, whatsapp_business_account: N8N, phone_number: EXPECTED },
      EXPECTED
    );
    expect(r).toMatchObject({ state: "ok", level: "phone_number" });
  });

  it("nessun indirizzo → missing (allarme)", () => {
    const r = classifyWebhookRoute({}, EXPECTED);
    expect(r.state).toBe("missing");
    expect(webhookRouteAlarming(r)).toBe(true);
  });

  it("campo assente nella risposta → unknown, nessun allarme", () => {
    const r = classifyWebhookRoute(undefined, EXPECTED);
    expect(r).toMatchObject({ state: "unknown", reason: "no_field" });
    expect(webhookRouteAlarming(r)).toBe(false);
  });

  it("indirizzo atteso: base senza barra finale + token", () => {
    expect(expectedWebhookUrl("https://crm.heili.cloud/", "abc12345")).toBe(
      "https://crm.heili.cloud/api/webhooks/wa/abc12345"
    );
  });
});

describe("isUnusuallyQuiet", () => {
  const now = NOW.getTime();
  const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString();

  it("numero trafficato (≥ 3 al giorno) e 25 ore di silenzio → sì", () => {
    expect(isUnusuallyQuiet({ lastInboundAt: hoursAgo(25), inbound14d: 60, now })).toBe(true);
  });
  it("numero trafficato ma ultimo messaggio 2 ore fa → no", () => {
    expect(isUnusuallyQuiet({ lastInboundAt: hoursAgo(2), inbound14d: 60, now })).toBe(false);
  });
  it("poco traffico (1 al giorno) → mai, anche dopo giorni", () => {
    expect(isUnusuallyQuiet({ lastInboundAt: hoursAgo(72), inbound14d: 14, now })).toBe(false);
  });
  it("nessun messaggio mai → no (numero nuovo)", () => {
    expect(isUnusuallyQuiet({ lastInboundAt: null, inbound14d: 0, now })).toBe(false);
  });
});

/* ------------------------ controllo con Meta ------------------------ */

type FetchCall = { url: string; init?: RequestInit };

function stubFetch(handler: (url: string, init?: RequestInit) => unknown, status = 200) {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const body = handler(String(url), init);
      return new Response(JSON.stringify(body), { status });
    })
  );
  return calls;
}

describe("checkWebhookRoute", () => {
  it("chiede a Meta webhook_configuration del numero, con il token dell'organizzazione", async () => {
    const calls = stubFetch(() => ({ webhook_configuration: { application: N8N }, id: "671133866076775" }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { checkWebhookRoute, clearWebhookRouteCache } = await import("@/server/whatsapp/webhook-route");
    clearWebhookRouteCache();
    const r = await checkWebhookRoute("org_a");
    expect(r).toMatchObject({ state: "elsewhere", foreignHost: "insiderslab.app.n8n.cloud" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("/671133866076775?fields=webhook_configuration");
    expect((calls[0]!.init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${WA_TOKEN}`);
    // Il log dice l'host, mai il percorso né il token.
    const logged = warn.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain("insiderslab.app.n8n.cloud");
    expect(logged).not.toContain("942f3c9d");
    expect(logged).not.toContain(WA_TOKEN);
  });

  it("cache: la seconda lettura non richiama Meta; maxAgeMs 0 sì", async () => {
    const calls = stubFetch(() => ({ webhook_configuration: { application: EXPECTED } }));
    const { checkWebhookRoute, clearWebhookRouteCache } = await import("@/server/whatsapp/webhook-route");
    clearWebhookRouteCache();
    await checkWebhookRoute("org_a");
    await checkWebhookRoute("org_a");
    expect(calls).toHaveLength(1);
    await checkWebhookRoute("org_a", { maxAgeMs: 0 });
    expect(calls).toHaveLength(2);
  });

  it("numero cambiato: la cache del numero vecchio non vale, si ricontrolla", async () => {
    const calls = stubFetch(() => ({ webhook_configuration: { application: EXPECTED } }));
    const { checkWebhookRoute, clearWebhookRouteCache } = await import("@/server/whatsapp/webhook-route");
    clearWebhookRouteCache();
    await checkWebhookRoute("org_a");
    fixture.creds = { ...fixture.creds, phoneNumberId: "999999999999999" };
    await checkWebhookRoute("org_a");
    expect(calls).toHaveLength(2);
    expect(calls[1]!.url).toContain("/999999999999999?fields=webhook_configuration");
  });

  it("due richieste contemporanee: una sola chiamata a Meta", async () => {
    const calls = stubFetch(() => ({ webhook_configuration: { application: EXPECTED } }));
    const { checkWebhookRoute, clearWebhookRouteCache } = await import("@/server/whatsapp/webhook-route");
    clearWebhookRouteCache();
    const [a, b] = await Promise.all([checkWebhookRoute("org_a"), checkWebhookRoute("org_a")]);
    expect(a?.state).toBe("ok");
    expect(b?.state).toBe("ok");
    expect(calls).toHaveLength(1);
  });

  it("Meta in errore → unknown (meta_error), nessun allarme", async () => {
    stubFetch(() => ({ error: { message: "boom", code: 2 } }), 500);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { checkWebhookRoute, clearWebhookRouteCache } = await import("@/server/whatsapp/webhook-route");
    clearWebhookRouteCache();
    const r = await checkWebhookRoute("org_a");
    expect(r).toMatchObject({ state: "unknown", reason: "meta_error" });
  });

  it("senza numero collegato → null, nessuna chiamata", async () => {
    fixture.creds = null;
    const calls = stubFetch(() => ({}));
    const { checkWebhookRoute, clearWebhookRouteCache } = await import("@/server/whatsapp/webhook-route");
    clearWebhookRouteCache();
    expect(await checkWebhookRoute("org_a")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("con il gateway Wapi non si giudica (unknown, nessuna chiamata)", async () => {
    vi.stubEnv("WAPI_BASE_URL", "https://wapi.example.com");
    const calls = stubFetch(() => ({}));
    const { checkWebhookRoute, clearWebhookRouteCache } = await import("@/server/whatsapp/webhook-route");
    clearWebhookRouteCache();
    expect(await checkWebhookRoute("org_a")).toMatchObject({ state: "unknown", reason: "wapi_gateway" });
    expect(calls).toHaveLength(0);
  });
});

/* --------------------------- ripristino --------------------------- */

describe("restoreAppWebhook", () => {
  it("POST {app-id}/subscriptions con il token dell'app, il nostro indirizzo e i 6 campi", async () => {
    const calls = stubFetch(() => ({ success: true }));
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { restoreAppWebhook } = await import("@/server/whatsapp/webhook-route");
    expect(await restoreAppWebhook()).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    const c = calls[0]!;
    expect(c.url).toBe(`https://graph.facebook.com/v25.0/${APP_ID}/subscriptions`);
    expect(c.init?.method).toBe("POST");
    expect((c.init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${APP_ID}|${APP_SECRET}`);
    const body = JSON.parse(String(c.init?.body));
    expect(body).toEqual({
      object: "whatsapp_business_account",
      callback_url: EXPECTED,
      verify_token: VERIFY_TOKEN,
      fields: "messages,message_template_status_update,smb_message_echoes,history,smb_app_state_sync,account_update",
    });
    // Il segreto non va mai nella URL (finirebbe nei log dei proxy).
    expect(c.url).not.toContain(APP_SECRET);
  });

  it("dopo il ripristino la cache si svuota: il prossimo controllo va da Meta", async () => {
    let answer: unknown = { webhook_configuration: { application: N8N } };
    const calls = stubFetch(() => answer);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { checkWebhookRoute, clearWebhookRouteCache, restoreAppWebhook } = await import(
      "@/server/whatsapp/webhook-route"
    );
    clearWebhookRouteCache();
    expect((await checkWebhookRoute("org_a"))?.state).toBe("elsewhere");
    answer = { success: true };
    await restoreAppWebhook();
    answer = { webhook_configuration: { application: EXPECTED } };
    expect((await checkWebhookRoute("org_a"))?.state).toBe("ok");
    expect(calls).toHaveLength(3);
  });

  it("senza App Secret → no_app_secret, nessuna chiamata", async () => {
    vi.stubEnv("META_APP_SECRET", "");
    const calls = stubFetch(() => ({}));
    const { restoreAppWebhook } = await import("@/server/whatsapp/webhook-route");
    expect(await restoreAppWebhook()).toEqual({ ok: false, code: "no_app_secret" });
    expect(calls).toHaveLength(0);
  });

  it("Meta rifiuta: il messaggio torna senza segreti", async () => {
    stubFetch(
      () => ({
        error: {
          message: `(#2200) Callback verification failed for ${EXPECTED} with secret ${APP_SECRET}`,
          code: 2200,
        },
      }),
      400
    );
    const { restoreAppWebhook } = await import("@/server/whatsapp/webhook-route");
    const r = await restoreAppWebhook();
    expect(r).toMatchObject({ ok: false, code: "meta_rejected" });
    const msg = (r as { message?: string }).message ?? "";
    expect(msg).toContain("2200");
    expect(msg).not.toContain(APP_SECRET);
    expect(msg).not.toContain(VERIFY_TOKEN);
  });
});

/* ------------------------------ vista ------------------------------ */

describe("WebhookRouteAlertView", () => {
  const t = (key: string, vars?: Record<string, string | number>) =>
    vars ? `${key}(${Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(",")})` : key;

  async function render(data: WebhookRouteCheckResponse): Promise<string> {
    const { WebhookRouteAlertView } = await import("@/components/settings/webhook-route-alert");
    return renderToStaticMarkup(
      WebhookRouteAlertView({
        data,
        number: "+1 555-779-6249",
        t,
        locale: "it",
        now: NOW.getTime(),
        onCheckNow: () => {},
        onRestore: () => {},
      })
    );
  }

  const elsewhere = classifyWebhookRoute({ application: N8N }, EXPECTED, NOW);

  it("n8n + super-admin: avviso rosso con host, nota su n8n e pulsante di ripristino", async () => {
    const out = await render({ route: elsewhere, quiet: false, lastInboundAt: null, canRestore: true });
    expect(out).toContain('role="alert"');
    expect(out).toContain("host=insiderslab.app.n8n.cloud");
    expect(out).toContain("settings.whatsapp.route.restoreNote");
    expect(out).toContain('data-testid="webhook-route-restore"');
    expect(out).not.toContain("942f3c9d");
  });

  it("n8n + owner che non è super-admin: niente pulsante, «avvisa il super-admin»", async () => {
    const out = await render({ route: elsewhere, quiet: false, lastInboundAt: null, canRestore: false });
    expect(out).toContain("settings.whatsapp.route.askSuperadmin");
    expect(out).not.toContain("webhook-route-restore");
  });

  it("override: niente pulsante (il ripristino dell'app non lo toglie)", async () => {
    const route = classifyWebhookRoute({ application: EXPECTED, whatsapp_business_account: N8N }, EXPECTED, NOW);
    const out = await render({ route, quiet: false, lastInboundAt: null, canRestore: true });
    expect(out).toContain("settings.whatsapp.route.overrideTitle");
    expect(out).not.toContain("webhook-route-restore");
  });

  it("tutto ok: riga verde, nessun avviso", async () => {
    const route = classifyWebhookRoute({ application: EXPECTED }, EXPECTED, NOW);
    const out = await render({ route, quiet: false, lastInboundAt: null, canRestore: true });
    expect(out).toContain('data-testid="webhook-route-ok"');
    expect(out).not.toContain('role="alert"');
  });

  it("ok ma silenzio insolito: avviso giallo con «Controlla adesso»", async () => {
    const route = classifyWebhookRoute({ application: EXPECTED }, EXPECTED, NOW);
    const out = await render({
      route,
      quiet: true,
      lastInboundAt: new Date(NOW.getTime() - 30 * 3_600_000).toISOString(),
      canRestore: false,
    });
    expect(out).toContain('data-testid="webhook-route-quiet"');
    expect(out).toContain("settings.whatsapp.route.checkNow");
  });

  it("ripristino fallito senza App Secret: testo proprio, non «Meta ha rifiutato»", async () => {
    const { WebhookRouteAlertView } = await import("@/components/settings/webhook-route-alert");
    const out = renderToStaticMarkup(
      WebhookRouteAlertView({
        data: { route: elsewhere, quiet: false, lastInboundAt: null, canRestore: true },
        number: "+1 555-779-6249",
        t,
        locale: "it",
        now: NOW.getTime(),
        restore: { kind: "failed", code: "no_app_secret", message: "" },
        onCheckNow: () => {},
        onRestore: () => {},
      })
    );
    expect(out).toContain("settings.whatsapp.route.restoreFailed_no_app_secret");
    expect(out).not.toContain("settings.whatsapp.route.restoreFailed(");
  });

  it("unknown (Meta non risponde): non mostra niente di allarmante", async () => {
    const route = { ...classifyWebhookRoute(undefined, EXPECTED, NOW), reason: "meta_error" as const };
    const out = await render({ route, quiet: false, lastInboundAt: null, canRestore: true });
    expect(out).not.toContain('role="alert"');
    expect(out).not.toContain("webhook-route-ok");
  });
});
