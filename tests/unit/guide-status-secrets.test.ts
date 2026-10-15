import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 013 — Lo stato della pagina guidata (GET /api/settings/whatsapp/status) non
 * porta MAI segreti: né il token di WhatsApp né le sue ultime 4 cifre, né
 * l'App Secret, né il verify token del webhook. Due controlli indipendenti:
 * (1) nessuna CHIAVE sospetta a qualunque profondità; (2) nessun VALORE
 * segreto della fixture nel JSON serializzato. DB e credenziali sono doppi;
 * la versione con PostgreSQL vero è in tests/golden/platform-meta.golden.test.ts.
 */

const TOKEN = "EAAGUnitFixtureTokenGuideQz7X";
const APP_SECRET = "unit-app-secret-guide-0042";
const VERIFY_TOKEN = "unit-verify-token-guide-0042";

const fixture = vi.hoisted(() => ({
  creds: null as null | Record<string, unknown>,
}));

vi.mock("@/server/whatsapp/credentials", () => ({
  getCredentialsByOrg: async () => fixture.creds,
}));
vi.mock("@/server/whatsapp/embedded-signup", () => ({
  getEmbeddedSignupConfig: async () => ({
    enabled: true,
    appId: "609974691965875",
    configId: "998877665544",
    graphVersion: "v25.0",
  }),
}));
vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  const chain = { from: () => chain, where: async () => [{ at: new Date("2026-10-15T10:00:00Z") }] };
  return { ...actual, getDb: () => ({ select: () => chain }) };
});

/** Chiavi che non devono esistere in nessun punto della risposta. */
const FORBIDDEN_KEY = /token|secret|verify|last4|cipher|password/i;

function keysDeep(value: unknown, path = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => keysDeep(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => [`${path}.${k}`, ...keysDeep(v, `${path}.${k}`)]);
  }
  return [];
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("APP_BASE_URL", "https://crm.heili.cloud");
  vi.stubEnv("DATABASE_URL", "postgresql://x:x@localhost:5432/x");
  vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-test-secret");
  vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32).toString("base64"));
  vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", VERIFY_TOKEN);
  vi.stubEnv("META_APP_SECRET", APP_SECRET);
  fixture.creds = {
    id: "mc_1",
    organizationId: "org_a",
    wabaId: "200000000000001",
    phoneNumberId: "100000000000001",
    displayPhoneNumber: "+39 347 718 5235",
    verifiedName: "InsidersLab",
    status: "connected",
    onboardingMode: "coexistence",
    appDisconnectedAt: null,
    token: TOKEN,
  };
});

async function payload(): Promise<unknown> {
  const { getWhatsappGuideStatus } = await import("@/server/whatsapp/guide-status");
  // Come la rotta: serializzato in JSON.
  return JSON.parse(JSON.stringify(await getWhatsappGuideStatus("org_a")));
}

describe("stato della guida: nessun segreto", () => {
  it.each(["connected", "reconnect_required"] as const)("connessione %s", async (status) => {
    fixture.creds!.status = status;
    const body = await payload();

    // (1) scansione ricorsiva delle chiavi
    expect(keysDeep(body).filter((k) => FORBIDDEN_KEY.test(k.split(".").pop()!))).toEqual([]);

    // (2) scansione dei valori: il token della fixture, le sue ultime 4, App Secret, verify token
    const raw = JSON.stringify(body);
    for (const secret of [TOKEN, TOKEN.slice(-4), APP_SECRET, VERIFY_TOKEN]) {
      expect(raw).not.toContain(secret);
    }

    // …e la risposta non è vuota (lo scan non è decorativo).
    expect(body).toMatchObject({
      connection: { phoneNumberId: "100000000000001", status },
      signature: { configured: true },
      lastInboundAt: "2026-10-15T10:00:00.000Z",
    });
  });

  it("senza connessione: idem", async () => {
    fixture.creds = null;
    const body = await payload();
    expect(keysDeep(body).filter((k) => FORBIDDEN_KEY.test(k.split(".").pop()!))).toEqual([]);
    expect(JSON.stringify(body)).not.toContain(APP_SECRET);
  });

  it("l'helper vede le chiavi annidate (controllo dello scan)", () => {
    expect(keysDeep({ a: { b: [{ tokenLast4: "x" }] } })).toContain(".a.b[0].tokenLast4");
  });
});
