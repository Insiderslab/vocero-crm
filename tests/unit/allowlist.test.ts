import { describe, expect, it } from "vitest";
import {
  ALLOWLIST_MAX,
  comparableIdentity,
  comparablePhone,
  isAllowedIdentity,
  normalizeAllowlistEntry,
  parseAllowlist,
} from "@/server/ai/allowlist";

/** 007 — Acceso reservado: normalización de la lista y decisión pura. */

describe("normalizeAllowlistEntry", () => {
  it.each([
    ["+39 347 123 4567", "393471234567"],
    ["+39-347-123-4567", "393471234567"],
    ["+(39) 347.123.4567", "393471234567"],
    ["  +393471234567  ", "393471234567"],
    // 521 → 52 como wa_identity (normalizeMx)
    ["+52 1 55 1234 5678", "525512345678"],
    ["+5215512345678", "525512345678"],
    ["+525512345678", "525512345678"],
  ])("%j → %s", (raw, expected) => {
    expect(normalizeAllowlistEntry(raw)).toBe(expected);
  });

  it.each([
    "",
    "   ",
    "abc",
    "+39 347 ABC 4567",
    "bsuid:12345678",
    "+123456", // 6 dígitos: corto
    "+1234567890123456", // 16 dígitos: largo
    "+0039 347 123 4567", // ningún código de país empieza por 0
    "+39 347 123 4567; drop",
    // Sin «+»: formato local o ambiguo, no coincidiría nunca → se rechaza.
    "347 123 4567",
    "393471234567",
    "5215512345678",
    "0039 347 123 4567",
    "(39) 347.123.4567",
    "++39 347 123 4567",
    "39 +347 123 4567",
  ])("rechaza %j", (raw) => {
    expect(normalizeAllowlistEntry(raw)).toBeNull();
  });
});

describe("parseAllowlist", () => {
  it("ignora líneas vacías, normaliza y quita duplicados (también tras normalizar)", () => {
    const parsed = parseAllowlist(
      "+39 347 123 4567\n\n+393471234567\r\n+52 1 55 1234 5678\n+525512345678\n"
    );
    expect(parsed).toEqual({ ok: true, identities: ["393471234567", "525512345678"] });
  });

  it("acepta una lista además del texto", () => {
    expect(parseAllowlist(["+39 347 123 4567", " "])).toEqual({
      ok: true,
      identities: ["393471234567"],
    });
  });

  it("una línea inválida invalida todo y se informan TODAS las inválidas", () => {
    expect(parseAllowlist("+39 347 123 4567\nhola\n347 123 4567\n+12")).toEqual({
      ok: false,
      invalid: ["hola", "347 123 4567", "+12"],
    });
  });

  it("vacío → lista vacía (válida)", () => {
    expect(parseAllowlist("")).toEqual({ ok: true, identities: [] });
  });

  it("lo guardado, mostrado con «+» delante, vuelve a validar igual (ida y vuelta de la pantalla)", () => {
    const saved = ["393471234567", "525512345678"];
    expect(parseAllowlist(saved.map((id) => `+${id}`).join("\n"))).toEqual({ ok: true, identities: saved });
  });

  it(`más de ${ALLOWLIST_MAX} números → rechazo`, () => {
    const many = Array.from({ length: ALLOWLIST_MAX + 1 }, (_, i) => `+${390000000000 + i}`);
    expect(parseAllowlist(many)).toMatchObject({ ok: false, tooMany: true });
    expect(parseAllowlist(many.slice(0, ALLOWLIST_MAX))).toMatchObject({ ok: true });
  });
});

describe("comparableIdentity", () => {
  it("teléfono normalizado como wa_identity", () => {
    expect(comparableIdentity("5215512345678")).toBe("525512345678");
    expect(comparableIdentity("393471234567")).toBe("393471234567");
  });

  it("BSUID u otra forma → null (jamás coincide)", () => {
    expect(comparableIdentity("bsuid:393471234567")).toBeNull();
    expect(comparableIdentity("39 347")).toBeNull();
    expect(comparableIdentity("")).toBeNull();
  });
});

describe("comparablePhone", () => {
  it("dígitos + 521→52; vacío → null", () => {
    expect(comparablePhone("+52 1 55 1234 5678")).toBe("525512345678");
    expect(comparablePhone("393471234567")).toBe("393471234567");
    expect(comparablePhone(null)).toBeNull();
    expect(comparablePhone("")).toBeNull();
  });
});

describe("isAllowedIdentity", () => {
  const team = { restrictToAllowlist: true, allowedIdentities: ["393471234567", "525512345678"] };

  it("restricción apagada → todos pasan (comportamiento de siempre)", () => {
    const off = { restrictToAllowlist: false, allowedIdentities: [] };
    expect(isAllowedIdentity(off, "5215599999999")).toBe(true);
    expect(isAllowedIdentity(off, "bsuid:xyz")).toBe(true);
  });

  it("número de la lista → pasa (también en forma 521)", () => {
    expect(isAllowedIdentity(team, "393471234567")).toBe(true);
    expect(isAllowedIdentity(team, "5215512345678")).toBe(true);
  });

  it("número fuera de la lista → no pasa", () => {
    expect(isAllowedIdentity(team, "393479999999")).toBe(false);
    // prefijo/sufijo de uno permitido no basta
    expect(isAllowedIdentity(team, "3934712345678")).toBe(false);
    expect(isAllowedIdentity(team, "39347123456")).toBe(false);
  });

  it("BSUID nunca pasa, aunque sus dígitos coincidan con la lista", () => {
    expect(isAllowedIdentity(team, "bsuid:393471234567")).toBe(false);
  });

  it("contacto nacido de un BSUID: pasa por su TELÉFONO (atributo) si está en la lista", () => {
    expect(isAllowedIdentity(team, "bsuid:MX.1", "5215512345678")).toBe(true);
    expect(isAllowedIdentity(team, "bsuid:MX.1", "+39 347 123 4567")).toBe(true);
    expect(isAllowedIdentity(team, "bsuid:MX.1", "393479999999")).toBe(false);
    expect(isAllowedIdentity(team, "bsuid:MX.1", null)).toBe(false);
    expect(isAllowedIdentity(team, "bsuid:MX.1", "")).toBe(false);
  });

  it("lista vacía con la restricción encendida → nadie (fail-closed)", () => {
    expect(isAllowedIdentity({ restrictToAllowlist: true, allowedIdentities: [] }, "393471234567")).toBe(false);
  });
});
