import { describe, expect, it } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { intlLocale, localeFromHeaders, type Locale } from "@/lib/i18n";
import { I18nProvider } from "@/lib/i18n/client";
import { defaultCurrencyFor, DEFAULT_CURRENCY } from "@/lib/money";
import { defaultStageKeyOf, isStageRename, seedStages, stageLabel } from "@/lib/stages";
import { fichaValueText, parseFichaValue } from "@/lib/ficha";
import { formatDay } from "@/components/inbox/helpers";
import { ConversationList } from "@/components/inbox/conversation-list";
import { personaName } from "@/components/lab/lab-client";
import { defaultOrgName } from "@/server/auth/on-signup";
import type { ConversationDto } from "@/lib/types";

/** 009 (E2) — Lenguas mezcladas: siembra, visualización y formatos. */

describe("etapas de fábrica", () => {
  it("una organización nueva se siembra en el idioma de quien la crea", () => {
    expect(seedStages("it").map((s) => s.name)).toEqual([
      "Nuovo",
      "In conversazione",
      "Interessato",
      "Cliente",
      "Perso",
    ]);
    expect(seedStages("es").map((s) => s.name)).toEqual([
      "Nuevo",
      "En conversación",
      "Interesado",
      "Cliente",
      "Perdido",
    ]);
    expect(seedStages("en").map((s) => s.kind)).toEqual(["open", "open", "open", "won", "lost"]);
  });

  it("un nombre de fábrica (en cualquier idioma) se muestra traducido", () => {
    expect(stageLabel("En conversación", "it")).toBe("In conversazione");
    expect(stageLabel("Perdido", "en")).toBe("Lost");
    expect(stageLabel("Nuovo", "es")).toBe("Nuevo");
    expect(stageLabel("Cliente", "en")).toBe("Customer");
  });

  it("una etapa renombrada se muestra tal como se escribió (comparación exacta)", () => {
    expect(stageLabel("Nuevo cliente", "it")).toBe("Nuevo cliente");
    expect(stageLabel("nuevo", "it")).toBe("nuevo");
    expect(stageLabel("Cotizado", "en")).toBe("Cotizado");
    expect(defaultStageKeyOf("Nuevo ")).toBeNull();
  });

  it("el gestor de etapas no renombra al dejar la etiqueta traducida tal cual", () => {
    expect(isStageRename("Nuovo", "Nuevo", "it")).toBe(false);
    expect(isStageRename(" Nuovo ", "Nuevo", "it")).toBe(false);
    expect(isStageRename("Nuevo", "Nuevo", "it")).toBe(false);
    expect(isStageRename("", "Nuevo", "it")).toBe(false);
    expect(isStageRename("Primo contatto", "Nuevo", "it")).toBe(true);
    expect(isStageRename("Cotizado", "Interesado", "es")).toBe(true);
  });

  it("la lista de la bandeja enseña la etapa traducida", () => {
    const conv: ConversationDto = {
      id: "cv_1",
      contact: { id: "ct_1", name: "Ana", phone: null },
      stageName: "En conversación",
      aiEnabled: true,
      handoffAt: null,
      handoffReason: null,
      lastInboundAt: null,
      lastMessageAt: null,
      unreadCount: 0,
      windowOpen: false,
      windowRemainingMs: 0,
      preview: null,
    };
    const html = renderToStaticMarkup(
      createElement(
        I18nProvider,
        { locale: "it" } as { locale: "it"; children: ReactNode },
        createElement(ConversationList, {
          conversations: [conv],
          selectedId: null,
          onSelect: () => undefined,
          onSeeded: () => undefined,
        })
      )
    );
    expect(html).toContain("In conversazione");
    // El valor del filtro sigue siendo el dato crudo; lo que se LEE va traducido.
    expect(html).not.toContain(">En conversación<");
  });
});

describe("moneda de una organización nueva", () => {
  it("italiano → EUR; el resto, el default de la instancia", () => {
    expect(defaultCurrencyFor("it")).toBe("EUR");
    expect(defaultCurrencyFor("es")).toBe(DEFAULT_CURRENCY);
    expect(defaultCurrencyFor("en")).toBe(DEFAULT_CURRENCY);
    expect(defaultCurrencyFor(null)).toBe(DEFAULT_CURRENCY);
  });
});

describe("idioma desde las cabeceras (hook de registro)", () => {
  const h = (init: Record<string, string>) => new Headers(init);

  it("la cookie de idioma manda", () => {
    expect(localeFromHeaders(h({ cookie: "x=1; heili-locale=en", "accept-language": "it" }))).toBe("en");
  });

  it("cookie inválida o ausente → Accept-Language → default", () => {
    expect(localeFromHeaders(h({ cookie: "heili-locale=fr", "accept-language": "es-ES,es;q=0.9" }))).toBe("es");
    expect(localeFromHeaders(h({ "accept-language": "en-US" }))).toBe("en");
    expect(localeFromHeaders(h({}))).toBe("it");
    expect(localeFromHeaders(null)).toBe("it");
  });

  it("nombre inicial de la organización en ese idioma", () => {
    expect(defaultOrgName("Ana", "it")).toBe("Attività di Ana");
    expect(defaultOrgName("Ana", "es")).toBe("Negocio de Ana");
    expect(defaultOrgName("", "en")).toBe("My business");
  });
});

describe("fechas y textos en el idioma de la interfaz", () => {
  const iso = "2026-10-09T10:00:00Z";

  it.each<[Locale, RegExp]>([
    ["it", /ottobre/],
    ["en", /October/],
    ["es", /octubre/],
  ])("separador de día en %s", (locale, re) => {
    expect(formatDay(iso, locale)).toMatch(re);
  });

  it("intlLocale da una etiqueta BCP 47 por idioma", () => {
    expect(intlLocale("it")).toBe("it-IT");
    expect(intlLocale("en")).toBe("en-US");
    expect(intlLocale("es")).toBe("es-MX");
  });

  it("la ficha dice Sì/No en italiano y entiende «sì» y «yes» al editar", () => {
    expect(fichaValueText(true, { yes: "Sì", no: "No" })).toBe("Sì");
    expect(fichaValueText(true)).toBe("Sí"); // default de siempre
    expect(parseFichaValue("Sì", false)).toBe(true);
    expect(parseFichaValue("yes", false)).toBe(true);
  });

  it("las personas del Laboratorio se nombran por su clave", () => {
    const t = (k: string) => `T(${k})`;
    expect(personaName({ persona: "cliente_enojado", personaLabel: "Cliente enojado" }, t)).toBe(
      "T(lab.personas.cliente_enojado)"
    );
    expect(personaName({ persona: "nueva_persona", personaLabel: "Nueva" }, t)).toBe("Nueva");
  });
});
