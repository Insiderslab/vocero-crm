import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  usePathname: () => "/inbox",
  useRouter: () => ({ refresh: () => undefined, prefetch: () => undefined, push: () => undefined }),
}));
vi.mock("@/components/use-events", () => ({ useEvents: () => undefined }));
vi.mock("@/lib/auth/client", () => ({
  authClient: { organization: { setActive: async () => undefined } },
  signOut: async () => undefined,
}));

import { Switch } from "@/components/ui/switch";
import { AppNav, roleLabel } from "@/components/app-nav";
import { MessageThread } from "@/components/inbox/message-thread";
import { StageFooter, type BoardLead } from "@/components/pipeline/pipeline-client";
import { DEFAULT_BRANDING } from "@/lib/branding";
import type { MessageDto } from "@/lib/types";

/** 009 (E7/E8/E10) — Rifiniture visive, comprobables sin navegador. */

const SRC = path.resolve(import.meta.dirname, "..", "..", "src");
const read = (...p: string[]) => readFileSync(path.join(SRC, ...p), "utf8");

/* ------------------------------ contraste ------------------------------ */

function lum(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** Valor de un token `--nombre: #hex;` en el bloque n-ésimo (0 = claro, 1 = oscuro). */
function token(css: string, name: string, block: 0 | 1): string {
  const all = [...css.matchAll(new RegExp(`--${name}:\\s*([^;]+);`, "g"))].map((m) => m[1]!.trim());
  const v = all[block];
  if (!v) throw new Error(`token ${name} sin valor en el bloque ${block}`);
  return v;
}

describe("E7 — contraste de la hora en la burbuja saliente", () => {
  const heili = read("app", "heili-tokens.css");
  const globals = read("app", "globals.css");
  const resolve = (v: string, block: 0 | 1): string => {
    const m = /^var\(--([\w-]+)\)$/.exec(v);
    if (!m) return v;
    const name = m[1]!;
    const src = name.startsWith("heili-") ? heili : globals;
    return resolve(token(src, name, block), block);
  };

  it.each([0, 1] as const)("tema %i: hora/insignias ≥ 4,5:1 y palomita de leído ≥ 3:1", (block) => {
    const bubble = resolve(token(globals, "bubble-out", block), block);
    const meta = resolve(token(globals, "bubble-out-meta", block), block);
    const tick = resolve(token(globals, "bubble-out-tick-read", block), block);
    expect(contrast(meta, bubble)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tick, bubble)).toBeGreaterThanOrEqual(3);
  });

  it("la burbuja saliente usa esos tokens (ya no `text-text-4`)", () => {
    const msg: MessageDto = {
      id: "m1",
      conversationId: "c1",
      direction: "out",
      type: "text",
      text: "hola",
      status: "read",
      error: null,
      aiGenerated: true,
      origin: "ai",
      media: null,
      createdAt: "2026-10-09T10:00:00Z",
    };
    const out = renderToStaticMarkup(createElement(MessageThread, { messages: [msg] }));
    const time = /<span data-bubble-time=""[^>]*class="([^"]*)"/.exec(out)?.[1] ?? "";
    expect(time).toContain("text-bubble-out-meta");
    expect(out).not.toContain("text-text-4");
    expect(out).toContain("text-bubble-out-tick");
  });
});

/* -------------------------- pie del lateral (E8) -------------------------- */

describe("E8 — pie del lateral", () => {
  const html = (role: string, userName: string) =>
    renderToStaticMarkup(
      createElement(AppNav, { branding: DEFAULT_BRANDING, userName, role, theme: "light", locale: "it" })
    );

  it("nombre y rol en un renglón; idioma, tema y salir en otro (no se pisan)", () => {
    const out = html("owner", "Stefano Finoti Insiderslab");
    const footer = out.slice(out.indexOf("data-user-footer"));
    const firstRowEnd = footer.indexOf("nav.online");
    const languageButton = footer.indexOf("Language / Idioma / Lingua");
    expect(firstRowEnd).toBeGreaterThan(0);
    expect(languageButton).toBeGreaterThan(firstRowEnd);
    expect(footer).toContain('title="Stefano Finoti Insiderslab"');
  });

  it("un admin ya no aparece como «Team»", () => {
    const t = (k: string) => k;
    expect(roleLabel("owner", t)).toBe("nav.owner");
    expect(roleLabel("admin", t)).toBe("nav.roleAdmin");
    expect(roleLabel("member", t)).toBe("nav.member");
  });
});

/* -------------------------- interruptor (E10) -------------------------- */

describe("E10 — interruptor del agente", () => {
  const render = (checked: boolean) =>
    renderToStaticMarkup(
      createElement(Switch, { checked, label: "Agente attivo", onCheckedChange: () => undefined })
    );

  it("rol switch, aria-checked y nombre accesible", () => {
    expect(render(true)).toMatch(/role="switch"[^>]*aria-checked="true"[^>]*aria-label="Agente attivo"/);
    expect(render(false)).toMatch(/aria-checked="false"/);
  });

  it("la manopola existe y cambia de lado y de color con el estado", () => {
    const on = render(true);
    const off = render(false);
    expect(on).toContain("data-knob");
    expect(on).toMatch(/data-knob=""[^>]*translate-x-5[^"]*bg-white|data-knob=""[^>]*bg-white[^"]*translate-x-5/);
    expect(off).toMatch(/data-knob=""[^>]*translate-x-0/);
    expect(off).toContain("bg-text-3");
    // Apagado: carril con borde (antes una píldora gris clara sin borde).
    expect(off).toContain("border-border-strong");
  });

  it("la página del agente usa el interruptor (no la píldora de antes)", () => {
    const src = read("components", "agent", "agent-client.tsx");
    expect(src).toMatch(/<Switch\s[\s\S]*?label=\{t\("agent\.toggleLabel"\)\}/);
    expect(src).toMatch(/describedBy="agent-enabled-state"/);
    expect(src).not.toMatch(/translate-x-0\.5/);
  });
});

/* ---------------------- pie de columna del pipeline ---------------------- */

describe("pie de columna del pipeline", () => {
  const lead = (amountCents: number | null): BoardLead => ({
    id: `l${amountCents}`,
    stageId: "s1",
    position: 0,
    lastActivityAt: null,
    contact: { id: "c", name: "C", phone: null },
    conversationId: null,
    amountCents,
    currency: null,
    priority: null,
  });
  const render = (leads: BoardLead[]) =>
    renderToStaticMarkup(createElement(StageFooter, { leads, currency: "EUR" }));

  it("sin importes no se pinta (nada de «Nessun importo inserito» repetido)", () => {
    expect(render([])).toBe("");
    expect(render([lead(null), lead(null)])).toBe("");
  });

  it("con un importe enseña el total", () => {
    expect(render([lead(12_500), lead(null)])).toContain("pipeline.footer.total");
  });
});
