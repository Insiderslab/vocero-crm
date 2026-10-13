import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DailyChart,
  fillDailyGaps,
  QuotaBar,
  StageChart,
} from "@/components/dashboard/charts";

/**
 * 010 — los gráficos de «Sintesi» son CSS puro y reciben los textos ya
 * traducidos: aquí se vigila el contrato observable — números visibles y
 * texto alternativo accesible (`aria-label`), con estado vacío incluido.
 */

describe("010 StageChart", () => {
  it("muestra nombres y números, y el aria-label lleva los datos", () => {
    const out = renderToStaticMarkup(
      createElement(StageChart, {
        rows: [
          { name: "Nuevo", value: 3 },
          { name: "Ganado", value: 0 },
        ],
        empty: "VACIO",
        aria: "Conversaciones por etapa: Nuevo: 3, Ganado: 0.",
        formatValue: (n: number) => String(n),
      })
    );
    expect(out).toContain("Nuevo");
    expect(out).toContain("Ganado");
    expect(out).toContain(">3<");
    expect(out).toContain('aria-label="Conversaciones por etapa: Nuevo: 3, Ganado: 0."');
    expect(out).not.toContain("VACIO");
  });

  it("todo en cero → estado vacío, sin barras falsas", () => {
    const out = renderToStaticMarkup(
      createElement(StageChart, {
        rows: [{ name: "Nuevo", value: 0 }],
        empty: "VACIO",
        aria: "A",
        formatValue: (n: number) => String(n),
      })
    );
    expect(out).toContain("VACIO");
  });
});

describe("010 DailyChart", () => {
  it("aria-label con totales y lista sr-only con cada día", () => {
    const out = renderToStaticMarkup(
      createElement(DailyChart, {
        points: [{ date: "2030-01-01", inbound: 2, outbound: 1 }],
        empty: "VACIO",
        aria: "Mensajes por día: 2 entrantes y 1 salientes.",
        inboundLabel: "Entrantes",
        outboundLabel: "Salientes",
        formatDay: () => "01/01",
        formatNumber: (n: number) => String(n),
      })
    );
    expect(out).toContain('role="img"');
    expect(out).toContain('aria-label="Mensajes por día: 2 entrantes y 1 salientes."');
    expect(out).toContain("01/01");
    expect(out).toContain("Entrantes");
    expect(out).toContain("Salientes");
    expect(out).toContain("sr-only");
  });

  it("sin puntos → estado vacío", () => {
    const out = renderToStaticMarkup(
      createElement(DailyChart, {
        points: [],
        empty: "VACIO",
        aria: "A",
        inboundLabel: "Entrantes",
        outboundLabel: "Salientes",
        formatDay: () => "01/01",
        formatNumber: (n: number) => String(n),
      })
    );
    expect(out).toContain("VACIO");
  });
});

describe("010 DailyChart — accesibilidad y días vacíos", () => {
  const base = {
    empty: "VACIO",
    aria: "TOTALES",
    inboundLabel: "Entrantes",
    outboundLabel: "Salientes",
    formatDay: (iso: string) => iso,
    formatNumber: (n: number) => String(n),
  };

  it("la lista sr-only queda FUERA del role=img (dentro sería presentacional)", () => {
    const out = renderToStaticMarkup(
      createElement(DailyChart, {
        ...base,
        points: [
          { date: "2030-01-01", inbound: 2, outbound: 1 },
          { date: "2030-01-02", inbound: 0, outbound: 0 },
        ],
      })
    );
    const img = out.indexOf('role="img"');
    const srOnly = out.indexOf('class="sr-only"');
    expect(img).toBeGreaterThanOrEqual(0);
    // El div del img se cierra antes de que empiece la lista sr-only.
    expect(out.slice(img, srOnly)).toMatch(/<\/ul><\/div><ul $/);
    expect(out).toContain("2030-01-01: Entrantes 2, Salientes 1");
    // Los días en cero no se leen uno por uno: solo los que tienen mensajes.
    expect(out).not.toContain("2030-01-02: Entrantes");
  });

  it("una serie toda en cero → estado vacío", () => {
    const out = renderToStaticMarkup(
      createElement(DailyChart, {
        ...base,
        points: [{ date: "2030-01-01", inbound: 0, outbound: 0 }],
      })
    );
    expect(out).toContain("VACIO");
  });
});

describe("010 fillDailyGaps", () => {
  it("rellena con ceros los días sin mensajes, de from a to (UTC)", () => {
    expect(
      fillDailyGaps(
        [
          { date: "2029-12-30", inbound: 1, outbound: 0 },
          { date: "2030-01-01", inbound: 2, outbound: 1 },
        ],
        "2029-12-29",
        "2030-01-02"
      )
    ).toEqual([
      { date: "2029-12-29", inbound: 0, outbound: 0 },
      { date: "2029-12-30", inbound: 1, outbound: 0 },
      { date: "2029-12-31", inbound: 0, outbound: 0 },
      { date: "2030-01-01", inbound: 2, outbound: 1 },
      { date: "2030-01-02", inbound: 0, outbound: 0 },
    ]);
  });

  it("un punto fuera del rango lo amplía en vez de perderse", () => {
    expect(
      fillDailyGaps([{ date: "2030-01-03", inbound: 1, outbound: 0 }], "2030-01-01", "2030-01-02")
    ).toEqual([
      { date: "2030-01-01", inbound: 0, outbound: 0 },
      { date: "2030-01-02", inbound: 0, outbound: 0 },
      { date: "2030-01-03", inbound: 1, outbound: 0 },
    ]);
  });

  it("sin datos: todos los días del período en cero", () => {
    expect(fillDailyGaps([], "2030-01-01", "2030-01-03")).toHaveLength(3);
  });
});

describe("010 QuotaBar", () => {
  it("aria-label con los números y leyenda con ambas cuentas", () => {
    const out = renderToStaticMarkup(
      createElement(QuotaBar, {
        ai: 7,
        human: 3,
        aiLabel: "de IA",
        humanLabel: "de personas",
        aria: "Mensajes salientes: 7 de IA y 3 de personas.",
        formatNumber: (n: number) => String(n),
      })
    );
    expect(out).toContain('aria-label="Mensajes salientes: 7 de IA y 3 de personas."');
    expect(out).toContain("de IA");
    expect(out).toContain("de personas");
    expect(out).toContain(">7<");
    expect(out).toContain(">3<");
  });
});
