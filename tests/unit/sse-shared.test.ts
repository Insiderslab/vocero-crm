import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reconnectDelay, resetEvents, subscribeToEvents } from "@/components/use-events";

/**
 * 009 — La conexión SSE compartida sabe volver a empezar: al cambiar de
 * organización (`resetEvents`) y cuando el navegador la da por muerta
 * (`readyState === CLOSED`), con espera creciente y `onReconnect` al reabrir.
 */

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readyState = 0; // CONNECTING
  closed = false;
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener() {}
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  die() {
    this.readyState = 2; // CLOSED: el navegador ya no reintenta
    this.onerror?.();
  }
  blip() {
    this.readyState = 0; // CONNECTING: el navegador reintenta solo
    this.onerror?.();
  }
}

const g = globalThis as unknown as { EventSource?: unknown };
const original = g.EventSource;
const offs: (() => void)[] = [];
const latest = () => FakeEventSource.instances[FakeEventSource.instances.length - 1]!;

function subscribe() {
  const ref = { current: { onReconnect: vi.fn() } };
  offs.push(subscribeToEvents(ref));
  return ref.current.onReconnect;
}

beforeEach(() => {
  vi.useFakeTimers();
  g.EventSource = FakeEventSource;
  FakeEventSource.instances = [];
});
afterEach(() => {
  for (const off of offs.splice(0)) off();
  g.EventSource = original;
  vi.useRealTimers();
});

describe("conexión SSE compartida", () => {
  it("resetEvents (cambio de organización): cierra la vieja, abre otra y avisa al abrir", () => {
    const onReconnect = subscribe();
    const first = latest();
    first.open();
    expect(onReconnect).not.toHaveBeenCalled();

    resetEvents();
    expect(first.closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(2);
    latest().open();
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it("CLOSED: se reabre con espera creciente y onReconnect llega UNA vez al abrir", () => {
    const onReconnect = subscribe();
    latest().open();
    latest().die();
    expect(FakeEventSource.instances).toHaveLength(1);
    vi.advanceTimersByTime(999);
    expect(FakeEventSource.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeEventSource.instances).toHaveLength(2);

    latest().die(); // sigue caído: ahora espera 2 s
    vi.advanceTimersByTime(1999);
    expect(FakeEventSource.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeEventSource.instances).toHaveLength(3);

    latest().open();
    expect(onReconnect).toHaveBeenCalledTimes(1);
    // Abierta de nuevo: la espera vuelve a empezar en 1 s.
    latest().die();
    vi.advanceTimersByTime(1000);
    expect(FakeEventSource.instances).toHaveLength(4);
  });

  it("CONNECTING: el navegador reintenta solo; no se abre una segunda conexión", () => {
    const onReconnect = subscribe();
    latest().open();
    latest().blip();
    vi.advanceTimersByTime(60_000);
    expect(FakeEventSource.instances).toHaveLength(1);
    latest().open();
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it("sin suscriptores no queda ninguna reconexión pendiente", () => {
    subscribe();
    latest().die();
    for (const off of offs.splice(0)) off();
    vi.advanceTimersByTime(60_000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("la espera crece hasta 30 s", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(reconnectDelay)).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000,
    ]);
  });
});

describe("cambio de organización (vigilancia del código)", () => {
  it.each([["components/app-nav.tsx"], ["components/admin/admin-client.tsx"]])(
    "%s llama a resetEvents() justo después de setActive",
    async (file) => {
      const { readFileSync } = await import("node:fs");
      const path = await import("node:path");
      const src = readFileSync(path.resolve(import.meta.dirname, "..", "..", "src", file), "utf8");
      expect(src).toMatch(/organization\.setActive\([\s\S]{0,120}?\);[\s\S]{0,200}?resetEvents\(\);/);
    }
  );
});
