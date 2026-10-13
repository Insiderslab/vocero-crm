import { describe, expect, it } from "vitest";
import {
  maskIdentity,
  normalizeRecipientKey,
  normalizeTemplateParam,
  parseIdempotencyKey,
  TEAM_PARAM_MAX,
  teamBroadcastBodySchema,
} from "@/server/team-broadcast/validation";

/** 012 — Validazione pura di `POST /api/bot/team-broadcast`. */

const base = {
  templateName: "ronda_mattutina",
  language: "it",
  params: ["Marco", "1) a · 2) b · 3) c"],
};

const parse = (body: unknown) => teamBroadcastBodySchema.safeParse(body);

describe("normalizeTemplateParam", () => {
  it("a capo, tab e spazi multipli diventano uno spazio; estremi tolti", () => {
    expect(normalizeTemplateParam("  1) a\n2) b\r\n3)\tc  ")).toBe("1) a 2) b 3) c");
    expect(normalizeTemplateParam("a     b")).toBe("a b");
    expect(normalizeTemplateParam("a     b")).toBe("a b");
  });
  it("toglie gli altri caratteri di controllo", () => {
    expect(normalizeTemplateParam("a\u0000b\u0007c\u007f")).toBe("abc");
  });
  it("lascia intatti testo, emoji e accenti", () => {
    expect(normalizeTemplateParam("¡Buenos días! 🚀 priorità · ok")).toBe("¡Buenos días! 🚀 priorità · ok");
  });
  it("il risultato non ha mai \\n, \\t né 4+ spazi", () => {
    const out = normalizeTemplateParam("x\n\n\t\t     y    z    w");
    expect(out).not.toMatch(/[\n\t]| {4,}/);
    expect(out).toBe("x y z w");
  });
});

describe("teamBroadcastBodySchema", () => {
  it("accetta il body minimo e normalizza i parametri", () => {
    const r = parse({ ...base, params: ["Marco\n", "1) a\t2) b"] });
    expect(r.success && r.data.params).toEqual(["Marco", "1) a 2) b"]);
    expect(r.success && r.data.perRecipient).toBeUndefined();
  });
  it("strict: un campo sconosciuto è un errore (niente organizationId o recipients nel body)", () => {
    expect(parse({ ...base, organizationId: "org_x" }).success).toBe(false);
    expect(parse({ ...base, recipients: ["393471110001"] }).success).toBe(false);
  });
  it("params: 1–10 voci", () => {
    expect(parse({ ...base, params: [] }).success).toBe(false);
    expect(parse({ ...base, params: Array(10).fill("x") }).success).toBe(true);
    expect(parse({ ...base, params: Array(11).fill("x") }).success).toBe(false);
  });
  it("un parametro vuoto dopo la normalizzazione si rifiuta", () => {
    expect(parse({ ...base, params: ["Marco", " \n\t "] }).success).toBe(false);
  });
  it(`massimo ${TEAM_PARAM_MAX} caratteri DOPO la normalizzazione`, () => {
    expect(parse({ ...base, params: ["x".repeat(TEAM_PARAM_MAX)] }).success).toBe(true);
    expect(parse({ ...base, params: ["x".repeat(TEAM_PARAM_MAX + 1)] }).success).toBe(false);
    // 1024 caratteri utili + spazi da comprimere: conta la versione normalizzata.
    expect(parse({ ...base, params: [`${"x".repeat(TEAM_PARAM_MAX - 2)}\n\n\n\nyy`] }).success).toBe(false);
    expect(parse({ ...base, params: [`${"x".repeat(TEAM_PARAM_MAX - 3)}\n\n\n\nyy`] }).success).toBe(true);
  });
  it("tipi sbagliati", () => {
    expect(parse({ ...base, params: "Marco" }).success).toBe(false);
    expect(parse({ ...base, params: [1, 2] }).success).toBe(false);
    expect(parse({ ...base, dryRun: "true" }).success).toBe(false);
    expect(parse({ ...base, templateName: "" }).success).toBe(false);
  });
  it("lingua: codice di Meta", () => {
    for (const ok of ["it", "es", "es_MX", "en_US", "pt_BR"]) {
      expect(parse({ ...base, language: ok }).success).toBe(true);
    }
    for (const bad of ["", "italiano", "IT", "it-IT", "es_"]) {
      expect(parse({ ...base, language: bad }).success).toBe(false);
    }
  });
  it("perRecipient: chiavi normalizzate come la lista del team, parametri normalizzati", () => {
    const r = parse({
      ...base,
      perRecipient: { "+39 347 111 0001": ["Marco\n", "1) a"], "393471110002": ["Giulia", "2) b"] },
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect([...r.data.perRecipient!.entries()]).toEqual([
      ["393471110001", ["Marco", "1) a"]],
      ["393471110002", ["Giulia", "2) b"]],
    ]);
  });
  it("perRecipient: chiave senza «+» con spazi, o duplicata dopo la normalizzazione → errore", () => {
    expect(parse({ ...base, perRecipient: { "347 111 0001": ["a", "b"] } }).success).toBe(false);
    expect(parse({ ...base, perRecipient: { ciao: ["a", "b"] } }).success).toBe(false);
    expect(
      parse({ ...base, perRecipient: { "+393471110001": ["a", "b"], "+39 347 111 0001": ["c", "d"] } }).success
    ).toBe(false);
    // La forma messicana 521… e 52… sono lo stesso numero (normalizeMx).
    expect(
      parse({ ...base, perRecipient: { "+5215512345678": ["a", "b"], "+525512345678": ["c", "d"] } }).success
    ).toBe(false);
  });
  it("perRecipient: l'errore non riporta il numero intero", () => {
    const r = parse({ ...base, perRecipient: { "347 111 0001": ["a", "b"] } });
    expect(r.success).toBe(false);
    if (r.success) return;
    const text = JSON.stringify(r.error.issues);
    expect(text).toContain("…001");
    expect(text).not.toContain("347 111 0001");
  });
  it("perRecipient: massimo 50 voci, ciascuna con 1–10 parametri", () => {
    const many = Object.fromEntries(
      Array.from({ length: 51 }, (_, i) => [`+3934700${String(i).padStart(5, "0")}`, ["a"]])
    );
    expect(parse({ ...base, perRecipient: many }).success).toBe(false);
    expect(parse({ ...base, perRecipient: { "+393471110001": [] } }).success).toBe(false);
  });
});

describe("normalizeRecipientKey", () => {
  it("come la lista del team", () => {
    expect(normalizeRecipientKey("+39 347-111.0001")).toBe("393471110001");
    expect(normalizeRecipientKey("393471110001")).toBe("393471110001");
    expect(normalizeRecipientKey("+52 1 55 1234 5678")).toBe("525512345678");
    expect(normalizeRecipientKey("0039 347 111 0001")).toBeNull();
    expect(normalizeRecipientKey("bsuid:abc")).toBeNull();
    expect(normalizeRecipientKey("")).toBeNull();
  });
});

describe("parseIdempotencyKey", () => {
  it("accetta chiavi semplici, rifiuta vuote, lunghe o con caratteri strani", () => {
    expect(parseIdempotencyKey("ronda-2026-10-13")).toBe("ronda-2026-10-13");
    expect(parseIdempotencyKey("  ronda:2026.10.13_a  ")).toBe("ronda:2026.10.13_a");
    expect(parseIdempotencyKey(null)).toBeNull();
    expect(parseIdempotencyKey("")).toBeNull();
    expect(parseIdempotencyKey("con spazi")).toBeNull();
    expect(parseIdempotencyKey("x".repeat(129))).toBeNull();
    expect(parseIdempotencyKey("x".repeat(128))).toBe("x".repeat(128));
    expect(parseIdempotencyKey("ronda/2026")).toBeNull();
  });
});

describe("maskIdentity", () => {
  it("solo le ultime 3 cifre", () => {
    expect(maskIdentity("393471110001")).toBe("…001");
    expect(maskIdentity("+39 347 111 0001")).toBe("…001");
    expect(maskIdentity("12")).toBe("…12");
    expect(maskIdentity("ciao")).toBe("…");
  });
});
