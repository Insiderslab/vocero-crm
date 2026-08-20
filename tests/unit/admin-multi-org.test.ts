import { afterEach, describe, expect, it } from "vitest";
import { slugify, uniqueSlug } from "@/lib/slug";
import { isSuperadminEmail } from "@/server/auth/superadmin";

describe("slugify", () => {
  it("minúsculas, sin acentos, guiones", () => {
    expect(slugify("Ferretería El Niño")).toBe("ferreteria-el-nino");
  });

  it("colapsa caracteres no alfanuméricos y recorta guiones", () => {
    expect(slugify("  Mi Negocio!! #2 ")).toBe("mi-negocio-2");
  });

  it("nombre sin ASCII cae a 'org'", () => {
    expect(slugify("☃☃☃")).toBe("org");
  });

  it("respeta el largo máximo sin guion colgando", () => {
    const slug = slugify("a".repeat(60) + "-" + "b".repeat(20));
    expect(slug.length).toBeLessThanOrEqual(48);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("uniqueSlug", () => {
  it("devuelve el base si está libre", () => {
    expect(uniqueSlug("acme", ["otra"])).toBe("acme");
  });

  it("sufija -2, -3… hasta encontrar libre", () => {
    expect(uniqueSlug("acme", ["acme", "acme-2"])).toBe("acme-3");
  });
});

describe("isSuperadminEmail", () => {
  afterEach(() => {
    delete process.env.SUPERADMIN_EMAILS;
  });

  it("sin la variable nadie es super-admin", () => {
    expect(isSuperadminEmail("dueño@negocio.com")).toBe(false);
  });

  it("reconoce correos de la lista, sin importar mayúsculas ni espacios", () => {
    process.env.SUPERADMIN_EMAILS = " Admin@Heili.cloud , otro@correo.com ";
    expect(isSuperadminEmail("admin@heili.cloud")).toBe(true);
    expect(isSuperadminEmail("otro@correo.com")).toBe(true);
    expect(isSuperadminEmail("intruso@heili.cloud")).toBe(false);
  });

  it("correo nulo o vacío nunca pasa", () => {
    process.env.SUPERADMIN_EMAILS = "admin@heili.cloud";
    expect(isSuperadminEmail(null)).toBe(false);
    expect(isSuperadminEmail("")).toBe(false);
  });
});
