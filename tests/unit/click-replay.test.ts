import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CLICK_REPLAY_SCRIPT } from "@/lib/click-replay";

/**
 * 009 (E6) — El clic que llega ANTES de la hidratación se guarda y se repite
 * una vez al hidratar. Se ejecuta el script real contra un DOM mínimo.
 */

type Listener = (e: FakeEvent) => void;
type FakeEvent = {
  target: FakeEl;
  defaultPrevented: boolean;
  stopped: boolean;
  preventDefault(): void;
  stopImmediatePropagation(): void;
};
type FakeEl = {
  matches: string[];
  inForm: boolean;
  isConnected: boolean;
  clicks: number;
  closest(sel: string): FakeEl | null;
  click(): void;
};

function setup() {
  const listeners = new Set<Listener>();
  const document = {
    addEventListener: (_t: string, fn: Listener) => listeners.add(fn),
    removeEventListener: (_t: string, fn: Listener) => listeners.delete(fn),
  };
  const window: { __heiliHydrated?: () => void } = {};
  new Function("document", "window", CLICK_REPLAY_SCRIPT)(document, window);
  const el = (kind: "button" | "submit" | "div"): FakeEl => {
    const e: FakeEl = {
      matches: kind === "button" ? ["button"] : [],
      inForm: kind === "submit",
      isConnected: true,
      clicks: 0,
      closest(sel: string) {
        if (sel === "form") return this.inForm ? this : null;
        return kind === "button" ? this : null;
      },
      click() {
        this.clicks++;
      },
    };
    return e;
  };
  const click = (target: FakeEl): FakeEvent => {
    const ev: FakeEvent = {
      target,
      defaultPrevented: false,
      stopped: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopImmediatePropagation() {
        this.stopped = true;
      },
    };
    for (const fn of [...listeners]) fn(ev);
    return ev;
  };
  return { window, el, click, listeners };
}

describe("repetición del clic anterior a la hidratación", () => {
  it("se guarda, se frena y se repite UNA vez al hidratar", () => {
    vi.useFakeTimers();
    const { window, el, click } = setup();
    const boton = el("button");
    const ev = click(boton);
    expect(ev.stopped).toBe(true);
    window.__heiliHydrated!();
    vi.runAllTimers();
    expect(boton.clicks).toBe(1);
    window.__heiliHydrated!(); // segunda llamada: nada
    vi.runAllTimers();
    expect(boton.clicks).toBe(1);
    vi.useRealTimers();
  });

  it("tras hidratar ya no intercepta nada", () => {
    const { window, el, click, listeners } = setup();
    window.__heiliHydrated!();
    expect(listeners.size).toBe(0);
    expect(click(el("button")).stopped).toBe(false);
  });

  it("no toca botones de formulario ni lo que no es un control", () => {
    const { el, click } = setup();
    expect(click(el("submit")).stopped).toBe(false);
    expect(click(el("div")).stopped).toBe(false);
  });

  it("un elemento que ya no está en la página no se repite", () => {
    vi.useFakeTimers();
    const { window, el, click } = setup();
    const boton = el("button");
    click(boton);
    boton.isConnected = false;
    window.__heiliHydrated!();
    vi.runAllTimers();
    expect(boton.clicks).toBe(0);
    vi.useRealTimers();
  });

  it("el layout raíz carga el script y marca la hidratación", () => {
    const layout = readFileSync(
      path.resolve(import.meta.dirname, "..", "..", "src", "app", "layout.tsx"),
      "utf8"
    );
    expect(layout).toMatch(/dangerouslySetInnerHTML=\{\{ __html: CLICK_REPLAY_SCRIPT \}\}/);
    expect(layout).toContain("<HydrationMark />");
  });
});
