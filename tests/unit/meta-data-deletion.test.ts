import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildSignedRequest,
  parseSignedRequest,
  SIGNED_REQUEST_MAX_LENGTH,
} from "@/server/meta/signed-request";

/**
 * 015 — Callback di cancellazione dati di Meta (POST /api/meta/data-deletion)
 * e pagina di stato /cancellazione-dati?id=<codice>.
 *
 * Segreto di PROVA (finto, mai quello vero). Il database è un doppio: la
 * versione con PostgreSQL vero è tests/golden/meta-data-deletion.golden.test.ts.
 */

const TEST_SECRET = "unit-test-app-secret-not-real-0015";
const OTHER_SECRET = "another-test-secret-not-real-0015";
const VALID = { algorithm: "HMAC-SHA256", issued_at: 1_790_000_000, user_id: "10234567890" };

const db = vi.hoisted(() => ({
  rows: [] as { code: string; metaUserId: string; status: string }[],
  inserts: 0,
  lookups: [] as string[],
  status: null as null | { status: string; createdAt: Date; updatedAt: Date; completedAt: Date | null },
}));

// Doppio di `@/server/meta/data-deletion` per la rotta e la pagina: registra
// cosa si scrive e risponde allo stato. La logica pura (codice, URL) è vera.
vi.mock("@/server/meta/data-deletion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/meta/data-deletion")>();
  return {
    ...actual,
    registerDeletionRequest: async (input: { metaUserId: string }) => {
      db.inserts += 1;
      const code = `TESTcode${String(db.inserts).padStart(12, "0")}`;
      db.rows.push({ code, metaUserId: input.metaUserId, status: "received" });
      return { code, reused: false };
    },
    deletionStatusByCode: async (code: string) => {
      db.lookups.push(code);
      const s = db.status;
      return s && db.rows.some((r) => r.code === code)
        ? {
            status: s.status,
            createdAt: s.createdAt.toISOString(),
            updatedAt: s.updatedAt.toISOString(),
            completedAt: s.completedAt?.toISOString() ?? null,
          }
        : null;
    },
  };
});

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers({ "accept-language": "it" }),
}));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("APP_BASE_URL", "https://crm.heili.cloud");
  vi.stubEnv("DATABASE_URL", "postgresql://x:x@localhost:5432/x");
  vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-test-secret");
  vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32).toString("base64"));
  vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-token-test");
  vi.stubEnv("META_APP_SECRET", TEST_SECRET);
  vi.stubEnv("LEGAL_ENTITY_NAME", "InsidersLab SNC di Finoti Stefano & C.");
  vi.stubEnv("LEGAL_CONTACT_EMAIL", "info@insiderslab.it");
  vi.stubEnv("LEGAL_ENTITY_DETAILS", "Via Argentina 25, 33100 Udine, P.IVA IT03168500308");
  db.rows = [];
  db.inserts = 0;
  db.lookups = [];
  db.status = null;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/* ------------------------- signed_request (puro) ------------------------- */

describe("parseSignedRequest", () => {
  it("firma valida → user_id e issued_at", () => {
    const r = parseSignedRequest(buildSignedRequest(VALID, TEST_SECRET), TEST_SECRET);
    expect(r).toEqual({
      ok: true,
      payload: { userId: "10234567890", issuedAt: new Date(1_790_000_000 * 1000) },
    });
  });

  it("formato di Meta: firma = HMAC-SHA256 della parte payload codificata, in base64 URL-safe", () => {
    const payloadPart = Buffer.from(JSON.stringify(VALID)).toString("base64url");
    const sig = createHmac("sha256", TEST_SECRET).update(payloadPart).digest("base64url");
    expect(parseSignedRequest(`${sig}.${payloadPart}`, TEST_SECRET).ok).toBe(true);
  });

  it("firmato con un altro segreto → bad_signature", () => {
    const r = parseSignedRequest(buildSignedRequest(VALID, OTHER_SECRET), TEST_SECRET);
    expect(r).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("payload alterato dopo la firma → bad_signature", () => {
    const [sig] = buildSignedRequest(VALID, TEST_SECRET).split(".");
    const forged = Buffer.from(JSON.stringify({ ...VALID, user_id: "999" })).toString("base64url");
    expect(parseSignedRequest(`${sig}.${forged}`, TEST_SECRET)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it.each([
    ["vuoto", ""],
    ["null", null],
    ["senza punto", "abc"],
    ["tre parti", "a.b.c"],
    ["caratteri non base64url", "ab+c/.payload=="],
    ["troppo lungo", "a".repeat(SIGNED_REQUEST_MAX_LENGTH) + ".b"],
  ])("malformato (%s) → malformed", (_n, value) => {
    expect(parseSignedRequest(value as string | null, TEST_SECRET)).toEqual({ ok: false, reason: "malformed" });
  });

  it("firma giusta ma payload non JSON → malformed", () => {
    const payloadPart = Buffer.from("non è json").toString("base64url");
    const sig = createHmac("sha256", TEST_SECRET).update(payloadPart).digest("base64url");
    expect(parseSignedRequest(`${sig}.${payloadPart}`, TEST_SECRET)).toEqual({ ok: false, reason: "malformed" });
  });

  it("algoritmo diverso → bad_algorithm", () => {
    const r = parseSignedRequest(buildSignedRequest({ ...VALID, algorithm: "none" }, TEST_SECRET), TEST_SECRET);
    expect(r).toEqual({ ok: false, reason: "bad_algorithm" });
  });

  it("senza user_id → no_user_id", () => {
    const r = parseSignedRequest(
      buildSignedRequest({ algorithm: "HMAC-SHA256", issued_at: 1 }, TEST_SECRET),
      TEST_SECRET
    );
    expect(r).toEqual({ ok: false, reason: "no_user_id" });
  });
});

/* ------------------------------ rotta ------------------------------ */

function post(body: string, contentType = "application/x-www-form-urlencoded") {
  return new Request("https://crm.heili.cloud/api/meta/data-deletion", {
    method: "POST",
    headers: { "content-type": contentType, "x-forwarded-for": "203.0.113.7" },
    body,
  });
}
const form = (signed: string) => `signed_request=${encodeURIComponent(signed)}`;

async function route() {
  const { resetRateLimit } = await import("@/lib/rate-limit");
  resetRateLimit();
  return (await import("@/app/api/meta/data-deletion/route")).POST;
}

describe("POST /api/meta/data-deletion", () => {
  it("firma valida → 200 { url, confirmation_code }, richiesta registrata", async () => {
    const POST = await route();
    const res = await POST(post(form(buildSignedRequest(VALID, TEST_SECRET))));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["confirmation_code", "url"]);
    expect(body.confirmation_code).toMatch(/^[A-Za-z0-9]{20}$/);
    expect(body.url).toBe(`https://crm.heili.cloud/cancellazione-dati?id=${body.confirmation_code}`);
    expect(db.rows).toEqual([{ code: body.confirmation_code, metaUserId: "10234567890", status: "received" }]);
  });

  it("anche multipart/form-data", async () => {
    const POST = await route();
    const fd = new FormData();
    fd.set("signed_request", buildSignedRequest(VALID, TEST_SECRET));
    const req = new Request("https://crm.heili.cloud/api/meta/data-deletion", { method: "POST", body: fd });
    expect((await POST(req)).status).toBe(200);
  });

  it("firma errata → 400 e niente registrato", async () => {
    const POST = await route();
    const res = await POST(post(form(buildSignedRequest(VALID, OTHER_SECRET))));
    expect(res.status).toBe(400);
    expect(db.inserts).toBe(0);
  });

  it.each([
    ["campo mancante", "altro=1"],
    ["valore malformato", form("non-un-signed-request")],
    ["corpo vuoto", ""],
  ])("payload malformato (%s) → 400 e niente registrato", async (_n, body) => {
    const POST = await route();
    expect((await POST(post(body))).status).toBe(400);
    expect(db.inserts).toBe(0);
  });

  it("JSON invece di form → 400", async () => {
    const POST = await route();
    const res = await POST(post(JSON.stringify({ signed_request: buildSignedRequest(VALID, TEST_SECRET) }), "application/json"));
    expect(res.status).toBe(400);
    expect(db.inserts).toBe(0);
  });

  it("corpo oltre 8 KB → 400", async () => {
    const POST = await route();
    expect((await POST(post(`signed_request=${"a".repeat(9000)}`))).status).toBe(400);
    expect(db.inserts).toBe(0);
  });

  it("senza META_APP_SECRET → 503 e niente registrato", async () => {
    vi.stubEnv("META_APP_SECRET", "");
    const POST = await route();
    expect((await POST(post(form(buildSignedRequest(VALID, TEST_SECRET))))).status).toBe(503);
    expect(db.inserts).toBe(0);
  });

  it("né risposte né log contengono il segreto o la firma", async () => {
    const POST = await route();
    const signed = buildSignedRequest(VALID, TEST_SECRET);
    const ok = await (await POST(post(form(signed)))).text();
    const bad = await (await POST(post(form(buildSignedRequest(VALID, OTHER_SECRET))))).text();
    const logs = [console.log, console.warn, console.error]
      .flatMap((f) => (f as unknown as { mock: { calls: unknown[][] } }).mock.calls)
      .map((c) => c.join(" "))
      .join("\n");
    for (const text of [ok, bad, logs]) {
      expect(text).not.toContain(TEST_SECRET);
      expect(text).not.toContain(signed.split(".")[0]);
      expect(text).not.toContain("10234567890");
    }
  });
});

/* ------------------------- pagina di stato ------------------------- */

/** Le pagine restituiscono <LegalPage/> (asincrono): lo si risolve prima di renderizzare. */
async function resolveAsync(el: React.ReactElement): Promise<string> {
  const type = el.type as (props: unknown) => Promise<React.ReactElement>;
  return renderToStaticMarkup(await type(el.props));
}

async function page(id?: string) {
  const Page = (await import("@/app/(public)/cancellazione-dati/page")).default;
  const el = await Page({ searchParams: Promise.resolve(id === undefined ? {} : { id }) });
  return resolveAsync(el as React.ReactElement);
}

describe("/cancellazione-dati", () => {
  it("senza id: istruzioni, contatto e titolare con il testo proposto; nessuna lettura dello stato", async () => {
    const html = await page();
    expect(html).not.toContain("data-deletion-status");
    expect(db.lookups).toEqual([]);
    expect(html).toContain(
      "Per chiedere la cancellazione dei tuoi dati scrivi a info@insiderslab.it dall&#x27;indirizzo con cui sei registrato, indicando numero WhatsApp e organizzazione. Cancelliamo i dati entro 30 giorni e confermiamo via e-mail. Titolare: InsidersLab SNC di Finoti Stefano &amp; C., Via Argentina 25, 33100 Udine, P.IVA IT03168500308."
    );
  });

  it("codice valido → stato «Richiesta ricevuta» con le date, senza ID Meta", async () => {
    db.rows.push({ code: "ABCDEFGHIJ0123456789", metaUserId: "10234567890", status: "received" });
    db.status = {
      status: "received",
      createdAt: new Date("2026-10-19T08:00:00Z"),
      updatedAt: new Date("2026-10-19T08:00:00Z"),
      completedAt: null,
    };
    const html = await page("ABCDEFGHIJ0123456789");
    expect(html).toContain('data-deletion-status="received"');
    expect(html).toContain("Richiesta ricevuta");
    expect(html).toContain("ABCDEFGHIJ0123456789");
    expect(html).not.toContain("10234567890");
  });

  it.each([
    ["in_progress", "In corso"],
    ["completed", "Completata"],
  ])("stato %s → «%s»", async (status, label) => {
    db.rows.push({ code: "ABCDEFGHIJ0123456789", metaUserId: "1", status });
    db.status = {
      status,
      createdAt: new Date("2026-10-19T08:00:00Z"),
      updatedAt: new Date("2026-10-20T08:00:00Z"),
      completedAt: status === "completed" ? new Date("2026-10-21T08:00:00Z") : null,
    };
    const html = await page("ABCDEFGHIJ0123456789");
    expect(html).toContain(`data-deletion-status="${status}"`);
    expect(html).toContain(label);
  });

  it("codice ben formato ma inesistente → «Codice non trovato»", async () => {
    const html = await page("ZZZZZZZZZZ0000000000");
    expect(html).toContain('data-deletion-status="not_found"');
    expect(html).toContain("Codice non trovato");
  });

  it("codice malformato → «Codice non trovato» senza toccare il database", async () => {
    const html = await page("<script>alert(1)</script>");
    expect(html).toContain('data-deletion-status="not_found"');
    expect(html).not.toContain("<script>alert");
    expect(db.lookups).toEqual([]);
  });

  it("anche /privacy chiude con contatto e titolare", async () => {
    const Privacy = (await import("@/app/(public)/privacy/page")).default;
    const html = await resolveAsync(Privacy() as React.ReactElement);
    expect(html).toContain("data-legal-contact");
    expect(html).toContain("P.IVA IT03168500308");
  });
});

describe("robots.txt", () => {
  it("apre le pagine legali e il callback, chiude il resto", async () => {
    const { readFileSync } = await import("node:fs");
    const txt = readFileSync("public/robots.txt", "utf8");
    for (const p of ["/privacy", "/termini", "/cancellazione-dati", "/api/meta/data-deletion"]) {
      expect(txt).toContain(`Allow: ${p}`);
    }
    expect(txt.indexOf("Allow: /privacy")).toBeLessThan(txt.indexOf("Disallow: /"));
  });
});
