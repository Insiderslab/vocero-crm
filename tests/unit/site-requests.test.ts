import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimit } from "@/lib/rate-limit";
import { buildSiteSnippet, escapeHtml, jsString } from "@/lib/site-snippet";
import {
  API_KEY_SCOPES,
  authenticateApiKey,
  generateApiKey,
  type ApiKeyAuthDeps,
} from "@/server/api-keys";
import { authenticateSiteKey } from "@/server/site-requests/auth";
import {
  MAX_BODY_BYTES,
  MAX_FIELDS,
  MAX_ORIGINS,
  formatSiteRequest,
  isHoneypotFilled,
  labelLocale,
  normalizeOrigin,
  normalizeSitePhone,
  originAllowed,
  parseOrigins,
  preflightHeaders,
  readBodyCapped,
  siteRequestSchema,
  toSiteRequest,
} from "@/server/site-requests/validation";

/**
 * 008 — Solicitudes del sitio web: validación y normalización (lógica pura),
 * ámbito "site" de las claves y fragmento para el sitio. El comportamiento con
 * PostgreSQL real vive en tests/golden/site-requests.golden.test.ts.
 */

describe("normalizeSitePhone: misma forma que la identidad de WhatsApp", () => {
  it.each([
    ["+58 412 123 4567", "584121234567"],
    ["+58 (412) 123-4567", "584121234567"],
    ["0058.412.1234567", "584121234567"],
    ["+52 1 55 1234 5678", "525512345678"], // normalizeMx: 521 → 52
    ["5215512345678", "525512345678"],
    ["+39 347 123 4567", "393471234567"],
  ])("%s → %s", (raw, expected) => {
    expect(normalizeSitePhone(raw)).toEqual({ ok: true, phone: expected });
  });

  it.each([
    ["0412 1234567", "local con 0 troncal"],
    ["123456", "menos de 7 dígitos"],
    ["+1234567890123456", "más de 15 dígitos"],
    ["+58 412 abc", "letras"],
    ["+58412+1234567", "un + en medio"],
    ["", "vacío"],
  ])("%s se rechaza (%s)", (raw) => {
    expect(normalizeSitePhone(raw).ok).toBe(false);
  });
});

const valid = {
  name: "  Ana Pérez ",
  phone: "+58 412 123 4567",
  email: "  ANA@Example.COM ",
  message: "Quiero reservar el tour del sábado",
  pageUrl: "https://labambola.example/tours",
  locale: "es-VE",
  fields: { personas: "4", fecha: "2026-10-24" },
};

describe("siteRequestSchema", () => {
  it("acepta un formulario completo y normaliza", () => {
    const r = siteRequestSchema.safeParse(valid);
    expect(r.success).toBe(true);
    const req = toSiteRequest(r.success ? r.data : (undefined as never));
    expect(req).toEqual({
      name: "Ana Pérez",
      phone: "584121234567",
      email: "ana@example.com",
      message: "Quiero reservar el tour del sábado",
      pageUrl: "https://labambola.example/tours",
      locale: "es-VE",
      fields: { personas: "4", fecha: "2026-10-24" },
    });
  });

  it("solo teléfono o solo email bastan", () => {
    expect(siteRequestSchema.safeParse({ ...valid, email: undefined }).success).toBe(true);
    expect(siteRequestSchema.safeParse({ ...valid, phone: undefined }).success).toBe(true);
  });

  it("sin teléfono ni email (o vacíos) → error en phone", () => {
    for (const body of [
      { ...valid, phone: undefined, email: undefined },
      { ...valid, phone: "  ", email: "" },
    ]) {
      const r = siteRequestSchema.safeParse(body);
      expect(r.success).toBe(false);
      expect(r.error?.issues.map((i) => i.path.join("."))).toContain("phone");
    }
  });

  it("campos vacíos del formulario cuentan como ausentes", () => {
    const r = siteRequestSchema.safeParse({ ...valid, email: "", pageUrl: "", locale: "" });
    expect(r.success).toBe(true);
    expect(r.success && toSiteRequest(r.data)).toMatchObject({ email: null, pageUrl: null, locale: null });
  });

  it("teléfono local → error con el motivo", () => {
    const r = siteRequestSchema.safeParse({ ...valid, phone: "0412 1234567" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toMatch(/código de país/);
  });

  it.each([
    ["name vacío", { name: "   " }],
    ["name > 120", { name: "x".repeat(121) }],
    ["message vacío", { message: "" }],
    ["message > 4000", { message: "x".repeat(4001) }],
    ["email inválido", { email: "no-es-email" }],
    ["pageUrl no http", { pageUrl: "javascript:alert(1)" }],
    ["locale raro", { locale: "es_VE;<script>" }],
    ["clave desconocida (strict)", { organizationId: "org_b" }],
    ["fields con valor no texto", { fields: { a: 1 } }],
    ["fields: clave > 40", { fields: { ["k".repeat(41)]: "v" } }],
    ["fields: valor > 500", { fields: { a: "v".repeat(501) } }],
    [
      `fields: más de ${MAX_FIELDS}`,
      { fields: Object.fromEntries(Array.from({ length: MAX_FIELDS + 1 }, (_, i) => [`k${i}`, "v"])) },
    ],
  ])("rechaza: %s", (_label, patch) => {
    expect(siteRequestSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });

  it("caracteres de control fuera; saltos de línea se conservan", () => {
    const r = siteRequestSchema.safeParse({ ...valid, message: "hola\u0000\u0007\nadiós" });
    expect(r.success && r.data.message).toBe("hola\nadiós");
  });

  it("honeypot: vacío = humano; con texto = bot", () => {
    const human = siteRequestSchema.parse({ ...valid, website: "" });
    const bot = siteRequestSchema.parse({ ...valid, website: "http://spam.example" });
    expect(isHoneypotFilled(human)).toBe(false);
    expect(isHoneypotFilled(bot)).toBe(true);
  });
});

describe("formatSiteRequest", () => {
  const req = toSiteRequest(siteRequestSchema.parse(valid));

  it("etiquetas en el idioma de la solicitud (es)", () => {
    expect(formatSiteRequest(req)).toBe(
      [
        "Solicitud desde el sitio web",
        "Nombre: Ana Pérez",
        "Teléfono: +584121234567",
        "Email: ana@example.com",
        "",
        "Quiero reservar el tour del sábado",
        "",
        "personas: 4",
        "fecha: 2026-10-24",
        "",
        "Página: https://labambola.example/tours",
      ].join("\n")
    );
  });

  it("idioma desconocido o ausente → el de la instancia", () => {
    expect(labelLocale("de-DE")).toBe(labelLocale(null));
    expect(labelLocale("IT")).toBe("it");
    expect(formatSiteRequest({ ...req, locale: "en-GB" })).toMatch(/^Request from the website\nName: Ana/);
  });

  it("sin teléfono, email, campos ni página: solo lo que hay", () => {
    expect(
      formatSiteRequest({ ...req, phone: null, email: "a@b.co", fields: {}, pageUrl: null, locale: "it" })
    ).toBe(["Richiesta dal sito web", "Nome: Ana Pérez", "Email: a@b.co", "", req.message].join("\n"));
  });
});

describe("orígenes autorizados", () => {
  it.each([
    ["https://LaBambola.example", "https://labambola.example"],
    ["https://labambola.example/", "https://labambola.example"],
    ["https://labambola.example:443", "https://labambola.example"],
    ["http://localhost:8080", "http://localhost:8080"],
  ])("%s → %s", (raw, expected) => {
    expect(normalizeOrigin(raw)).toBe(expected);
  });

  it.each([
    "https://*.labambola.example",
    "*",
    "labambola.example",
    "https://labambola.example/contatti",
    "https://labambola.example?x=1",
    "https://user:pw@labambola.example",
    "ftp://labambola.example",
    "null",
  ])("rechaza %s", (raw) => {
    expect(normalizeOrigin(raw)).toBeNull();
  });

  it("lista: líneas vacías fuera, duplicados (tras normalizar) fuera; inválidas → todas listadas", () => {
    expect(parseOrigins("https://a.example\n\nhttps://A.example/\nhttp://b.example:8080")).toEqual({
      ok: true,
      origins: ["https://a.example", "http://b.example:8080"],
    });
    expect(parseOrigins(["https://a.example", "*", "nope"])).toEqual({ ok: false, invalid: ["*", "nope"] });
    const many = Array.from({ length: MAX_ORIGINS + 1 }, (_, i) => `https://s${i}.example`);
    expect(parseOrigins(many)).toEqual({ ok: false, tooMany: true });
  });

  it("originAllowed compara en forma canónica; null/ausente no pasa", () => {
    const allowed = ["https://labambola.example"];
    expect(originAllowed("https://labambola.example", allowed)).toBe(true);
    expect(originAllowed("https://evil.example", allowed)).toBe(false);
    expect(originAllowed("null", allowed)).toBe(false);
    expect(originAllowed(null, allowed)).toBe(false);
    expect(originAllowed("https://labambola.example", [])).toBe(false);
  });

  it("cabeceras del preflight: solo POST y las dos cabeceras del formulario", () => {
    expect(preflightHeaders("https://labambola.example")).toEqual({
      "access-control-allow-origin": "https://labambola.example",
      vary: "Origin",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type, x-site-key",
      "access-control-max-age": "600",
    });
  });
});

describe("readBodyCapped", () => {
  const post = (body: BodyInit) => new Request("http://x/", { method: "POST", body });

  it("lee hasta el tope", async () => {
    expect(await readBodyCapped(post("x".repeat(MAX_BODY_BYTES)))).toHaveLength(MAX_BODY_BYTES);
  });

  it("pasado el tope → null, aunque no haya Content-Length (stream)", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < 5; i++) c.enqueue(new Uint8Array(MAX_BODY_BYTES / 4));
        c.close();
      },
    });
    const req = new Request("http://x/", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    expect(await readBodyCapped(req)).toBeNull();
  });
});

describe("ámbito site de las claves (vsk_, X-Site-Key, sin clave de instancia)", () => {
  beforeEach(() => resetRateLimit());

  const site = generateApiKey("site");
  const bot = generateApiKey("bot");
  const rows: Record<string, { id: string; organizationId: string; scope: string }> = {
    [site.hash]: { id: "k_site", organizationId: "org_a", scope: "site" },
    [bot.hash]: { id: "k_bot", organizationId: "org_a", scope: "bot" },
  };
  const deps = (): ApiKeyAuthDeps => ({
    findActiveKey: vi.fn(async (h: string) => rows[h] ?? null),
    touchKey: vi.fn(async () => {}),
    listOrganizationIds: vi.fn(async () => ["org_a"]),
  });
  const status = async (headers: Record<string, string>, d = deps()) => {
    const r = await authenticateSiteKey(new Request("http://x/", { headers }), d);
    return r instanceof Response ? r.status : r;
  };

  it("prefijo vsk_ y cabecera x-site-key", () => {
    expect(site.plain.startsWith("vsk_")).toBe(true);
    expect(API_KEY_SCOPES.site.header).toBe("x-site-key");
    expect(API_KEY_SCOPES.site.instanceEnv).toBeNull();
  });

  it("clave del sitio válida → su organización", async () => {
    expect(await status({ "x-site-key": site.plain })).toEqual({ organizationId: "org_a", keyId: "k_site" });
  });

  it("la clave en X-Api-Key no cuenta", async () => {
    expect(await status({ "x-api-key": site.plain })).toBe(401);
  });

  it("una clave de bot no vale en el sitio, ni la del sitio en el bot", async () => {
    expect(await status({ "x-site-key": bot.plain })).toBe(401);
    const r = await authenticateApiKey(
      new Request("http://x/", { headers: { "x-api-key": site.plain } }),
      "bot",
      deps()
    );
    expect(r instanceof Response && r.status).toBe(401);
  });

  it("sin clave de instancia: ni con BOT_API_KEY/EXPORT_API_KEY ni con una cadena cualquiera, y no lista organizaciones", async () => {
    vi.stubEnv("BOT_API_KEY", "una-clave-de-instancia-larga");
    const d = deps();
    expect(await status({ "x-site-key": "una-clave-de-instancia-larga" }, d)).toBe(401);
    expect(await status({}, d)).toBe(401);
    expect(d.listOrganizationIds).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("límite por organización de la clave: 30/min → 429", async () => {
    const d = deps();
    const { max } = API_KEY_SCOPES.site.rateLimit;
    expect(max).toBe(30);
    for (let i = 0; i < max; i++) expect(await status({ "x-site-key": site.plain }, d)).toMatchObject({ organizationId: "org_a" });
    expect(await status({ "x-site-key": site.plain }, d)).toBe(429);
  });
});

describe("fragmento para el sitio", () => {
  const labels = {
    name: "Nombre",
    phone: "Teléfono",
    email: "Email",
    message: "Mensaje",
    submit: "Enviar",
    thanks: "¡Gracias!",
    error: "Error",
  };
  const snippet = buildSiteSnippet({
    endpoint: "https://crm.example/api/public/site-requests",
    siteKey: "vsk_abc",
    labels,
  });

  it("lleva endpoint, cabecera X-Site-Key, clave, honeypot oculto y pageUrl/locale", () => {
    expect(snippet).toContain('var ENDPOINT = "https://crm.example/api/public/site-requests";');
    expect(snippet).toContain('var KEY = "vsk_abc";');
    expect(snippet).toContain('"X-Site-Key": KEY');
    expect(snippet).toMatch(/<input name="website" tabindex="-1" autocomplete="off">/);
    expect(snippet).toContain('aria-hidden="true"');
    expect(snippet).toContain("body.pageUrl = location.href");
    expect(snippet).toContain("document.documentElement.lang");
    expect(snippet).toContain('name="phone" type="tel" required');
  });

  it("los campos fields[x] van dentro de `fields`", () => {
    expect(snippet).toContain("/^fields\\[(.+)\\]$/");
  });

  it("escapa etiquetas y cadenas (no se puede cerrar el <script>)", () => {
    const evil = buildSiteSnippet({
      endpoint: "https://crm.example/x",
      siteKey: '</script><script>alert(1)</script>"',
      labels: { ...labels, name: '<img src=x onerror="a">' },
    });
    expect(evil).not.toContain("</script><script>");
    expect(evil).toContain("&lt;img src=x onerror=&quot;a&quot;&gt;");
    expect(jsString("</script>")).toBe('"\\u003c/script\\u003e"');
    expect(escapeHtml(`<"'&>`)).toBe("&lt;&quot;&#39;&amp;&gt;");
  });

  it("el JS del fragmento es sintácticamente válido", () => {
    const js = snippet.slice(snippet.indexOf("<script>") + 8, snippet.indexOf("</script>"));
    expect(() => new Function(js)).not.toThrow();
  });
});
