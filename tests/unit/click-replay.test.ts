import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLICK_REPLAY_SCRIPT } from "@/lib/click-replay";

/**
 * 009 (E6) — El clic que llega ANTES de la hidratación se guarda y se repite
 * una vez al hidratar. Se ejecuta el script real contra un DOM mínimo con
 * `closest`/`contains` de verdad (árbol de nodos y selectores simples).
 */

type Node = {
  tag: string;
  attrs: Record<string, string>;
  parent: Node | null;
  isConnected: boolean;
  clicks: number;
  closest(sel: string): Node | null;
  contains(other: Node): boolean;
  click(): void;
};

const ATTR = /\[([\w-]+)(?:=([\w-]+))?\]/;

/** `tag`, `[a]`, `[a=v]` y `:not([...])`, separados por comas. */
function matches(n: Node, selector: string): boolean {
  return selector.split(",").some((raw) => {
    let sel = raw.trim();
    const nots: string[] = [];
    sel = sel.replace(/:not\((\[[^\]]+\])\)/g, (_, inner: string) => {
      nots.push(inner);
      return "";
    });
    const attrs = [...sel.matchAll(new RegExp(ATTR, "g"))];
    const tag = sel.replace(/\[[^\]]+\]/g, "");
    if (tag && tag !== n.tag) return false;
    const has = (m: RegExpMatchArray) =>
      m[2] === undefined ? m[1]! in n.attrs : n.attrs[m[1]!] === m[2];
    if (!attrs.every(has)) return false;
    return nots.every((inner) => !has(ATTR.exec(inner)!));
  });
}

function el(tag: string, attrs: Record<string, string> = {}, parent: Node | null = null): Node {
  const node: Node = {
    tag,
    attrs,
    parent,
    isConnected: true,
    clicks: 0,
    closest(sel) {
      for (let c: Node | null = node; c; c = c.parent) if (matches(c, sel)) return c;
      return null;
    },
    contains(other) {
      for (let c: Node | null = other; c; c = c.parent) if (c === node) return true;
      return false;
    },
    click() {
      node.clicks++;
    },
  };
  return node;
}

type Ev = {
  target: Node;
  button: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  stopped: boolean;
  preventDefault(): void;
  stopImmediatePropagation(): void;
};

function setup() {
  const listeners = new Set<(e: Ev) => void>();
  const document = {
    addEventListener: (_t: string, fn: (e: Ev) => void) => listeners.add(fn),
    removeEventListener: (_t: string, fn: (e: Ev) => void) => listeners.delete(fn),
  };
  const window: { __heiliHydrated?: () => void } = {};
  new Function("document", "window", CLICK_REPLAY_SCRIPT)(document, window);
  const click = (target: Node, extra: Partial<Ev> = {}): Ev => {
    const ev: Ev = {
      target,
      button: 0,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      stopped: false,
      preventDefault() {},
      stopImmediatePropagation() {
        this.stopped = true;
      },
      ...extra,
    };
    for (const fn of [...listeners]) fn(ev);
    return ev;
  };
  return { window, click, listeners };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("repetición del clic anterior a la hidratación", () => {
  it("se guarda, se frena y se repite UNA vez al hidratar", () => {
    const { window, click } = setup();
    const boton = el("button");
    expect(click(el("span", {}, boton)).stopped).toBe(true); // clic en el icono del botón
    window.__heiliHydrated!();
    vi.advanceTimersByTime(1);
    expect(boton.clicks).toBe(1);
    window.__heiliHydrated!();
    vi.advanceTimersByTime(1);
    expect(boton.clicks).toBe(1);
  });

  it("tras hidratar ya no intercepta nada", () => {
    const { window, click, listeners } = setup();
    window.__heiliHydrated!();
    expect(listeners.size).toBe(0);
    expect(click(el("button")).stopped).toBe(false);
  });

  it("no toca botones de formulario, submit ni lo que no es un control", () => {
    const { click } = setup();
    const form = el("form");
    expect(click(el("button", {}, form)).stopped).toBe(false);
    expect(click(el("button", { type: "submit" })).stopped).toBe(false);
    expect(click(el("div")).stopped).toBe(false);
  });

  it.each([
    ["a", { href: "/inbox" }],
    ["input", {}],
    ["select", {}],
    ["textarea", {}],
    ["label", {}],
    ["summary", {}],
  ])("un <%s> anidado dentro del control funciona solo: no se frena", (tag, attrs) => {
    const { click } = setup();
    const control = el("div", { role: "button" });
    expect(click(el(tag, attrs, control)).stopped).toBe(false);
  });

  it("botón secundario o con modificadores: no se frena", () => {
    const { click } = setup();
    const b = el("button");
    for (const extra of [
      { button: 1 },
      { button: 2 },
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
      { altKey: true },
    ]) {
      expect(click(b, extra).stopped).toBe(false);
    }
  });

  it("sin hidratación en 10 s deja de frenar clics y no repite nada", () => {
    const { window, click, listeners } = setup();
    const b = el("button");
    click(b);
    vi.advanceTimersByTime(10_001);
    expect(listeners.size).toBe(0);
    expect(click(b).stopped).toBe(false);
    window.__heiliHydrated!();
    vi.advanceTimersByTime(1);
    expect(b.clicks).toBe(0);
  });

  it("aunque el temporizador no llegue a correr (pestaña en segundo plano), pasados 10 s no frena", () => {
    const { click, listeners } = setup();
    vi.setSystemTime(Date.now() + 10_001); // el reloj avanza, los timers no
    expect(click(el("button")).stopped).toBe(false);
    expect(listeners.size).toBe(0);
  });

  it("un elemento que ya no está en la página no se repite", () => {
    const { window, click } = setup();
    const boton = el("button");
    click(boton);
    boton.isConnected = false;
    window.__heiliHydrated!();
    vi.advanceTimersByTime(1);
    expect(boton.clicks).toBe(0);
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
