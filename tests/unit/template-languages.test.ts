import { describe, expect, it } from "vitest";
import { LOCALES } from "@/lib/i18n";
import { defaultTemplateLanguage, TEMPLATE_LANGUAGES } from "@/lib/templates";

describe("idioma de plantilla por defecto", () => {
  it("el formulario ofrece el italiano", () => {
    expect(TEMPLATE_LANGUAGES).toContain("it");
  });

  it("sigue el idioma de la interfaz", () => {
    expect(defaultTemplateLanguage("it")).toBe("it");
    expect(defaultTemplateLanguage("es")).toBe("es_MX");
    expect(defaultTemplateLanguage("en")).toBe("en_US");
  });

  it("el valor por defecto de cada idioma de la interfaz está entre las opciones", () => {
    for (const locale of LOCALES) {
      expect(TEMPLATE_LANGUAGES).toContain(defaultTemplateLanguage(locale));
    }
  });
});
