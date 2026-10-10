import { beforeEach, describe, expect, it } from "vitest";
import {
  AUTH_RATE_LIMIT,
  SWEEP_EVERY,
  authRateLimitAllowed,
  rateLimitSize,
  checkRateLimit,
  clientIp,
  countInWindow,
  isRateLimited,
  resetRateLimit,
} from "@/lib/rate-limit";

describe("rate limit por IP (FR-062: 10 / 10 min → 429)", () => {
  beforeEach(() => resetRateLimit());

  it("permite hasta el máximo y bloquea el siguiente", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < AUTH_RATE_LIMIT.max; i++) {
      expect(
        checkRateLimit("login:1.2.3.4", AUTH_RATE_LIMIT, t0 + i).allowed
      ).toBe(true);
    }
    expect(
      checkRateLimit("login:1.2.3.4", AUTH_RATE_LIMIT, t0 + 100).allowed
    ).toBe(false);
  });

  it("la ventana desliza: pasados 10 minutos vuelve a permitir", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < AUTH_RATE_LIMIT.max; i++) {
      checkRateLimit("k", AUTH_RATE_LIMIT, t0 + i);
    }
    expect(checkRateLimit("k", AUTH_RATE_LIMIT, t0 + 1000).allowed).toBe(false);
    expect(
      checkRateLimit("k", AUTH_RATE_LIMIT, t0 + AUTH_RATE_LIMIT.windowMs + 500)
        .allowed
    ).toBe(true);
  });

  it("claves distintas (IPs) no se afectan entre sí", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < AUTH_RATE_LIMIT.max; i++) {
      checkRateLimit("login:1.1.1.1", AUTH_RATE_LIMIT, t0 + i);
    }
    expect(
      checkRateLimit("login:1.1.1.1", AUTH_RATE_LIMIT, t0 + 100).allowed
    ).toBe(false);
    expect(
      checkRateLimit("login:2.2.2.2", AUTH_RATE_LIMIT, t0 + 100).allowed
    ).toBe(true);
  });

  it("isRateLimited consulta sin consumir y respeta la ventana", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 100; i++) {
      expect(isRateLimited("peek", AUTH_RATE_LIMIT, t0 + i)).toBe(false);
    }
    for (let i = 0; i < AUTH_RATE_LIMIT.max; i++) {
      checkRateLimit("peek", AUTH_RATE_LIMIT, t0 + i);
    }
    expect(isRateLimited("peek", AUTH_RATE_LIMIT, t0 + 200)).toBe(true);
    expect(
      isRateLimited("peek", AUTH_RATE_LIMIT, t0 + AUTH_RATE_LIMIT.windowMs + 500)
    ).toBe(false);
  });
});

describe("countInWindow", () => {
  beforeEach(() => resetRateLimit());

  it("cuenta las marcas vigentes sin consumir ninguna", () => {
    const w = { windowMs: 1000, max: 10 };
    expect(countInWindow("c", w.windowMs, 5_000)).toBe(0);
    checkRateLimit("c", w, 5_000);
    checkRateLimit("c", w, 5_500);
    expect(countInWindow("c", w.windowMs, 5_600)).toBe(2);
    expect(countInWindow("c", w.windowMs, 5_600)).toBe(2);
    expect(countInWindow("c", w.windowMs, 6_200)).toBe(1);
    expect(countInWindow("c", w.windowMs, 7_000)).toBe(0);
  });
});

describe("clientIp: la IP de los contadores por IP", () => {
  const h = (init: Record<string, string>) => new Headers(init);

  it("primera entrada de x-forwarded-for, sin espacios", () => {
    expect(clientIp(h({ "x-forwarded-for": " 203.0.113.7 , 10.0.0.1" }))).toBe("203.0.113.7");
  });

  it("x-forwarded-for gana a x-real-ip", () => {
    expect(clientIp(h({ "x-forwarded-for": "203.0.113.7", "x-real-ip": "10.0.0.9" }))).toBe(
      "203.0.113.7"
    );
  });

  it("sin x-forwarded-for (o vacía) usa x-real-ip", () => {
    expect(clientIp(h({ "x-real-ip": "198.51.100.20" }))).toBe("198.51.100.20");
    expect(clientIp(h({ "x-forwarded-for": "", "x-real-ip": "198.51.100.20" }))).toBe(
      "198.51.100.20"
    );
  });

  it("sin cabeceras: \"local\"", () => {
    expect(clientIp(h({}))).toBe("local");
    expect(clientIp(undefined)).toBe("local");
    expect(clientIp(null)).toBe("local");
  });
});

describe("login/registro: el límite cuenta por IP del cliente (clientIp)", () => {
  beforeEach(() => resetRateLimit());
  const from = (ip: string) => new Headers({ "x-forwarded-for": ip });

  it("agotada una IP, esa IP recibe 429 y otra IP sigue entrando", () => {
    for (let i = 0; i < AUTH_RATE_LIMIT.max; i++) {
      expect(authRateLimitAllowed("/sign-in/email", from("203.0.113.7"))).toBe(true);
    }
    expect(authRateLimitAllowed("/sign-in/email", from("203.0.113.7"))).toBe(false);
    expect(authRateLimitAllowed("/sign-in/email", from("198.51.100.20"))).toBe(true);
  });

  it("la IP sale de x-forwarded-for (primera entrada), no de una constante", () => {
    for (let i = 0; i < AUTH_RATE_LIMIT.max; i++) {
      authRateLimitAllowed("/sign-up/email", from("203.0.113.7, 10.0.0.1"));
    }
    expect(authRateLimitAllowed("/sign-up/email", from("203.0.113.7, 10.0.0.2"))).toBe(false);
    expect(authRateLimitAllowed("/sign-up/email", from("203.0.113.8"))).toBe(true);
  });

  it("solo limita login y registro", () => {
    for (let i = 0; i < AUTH_RATE_LIMIT.max + 5; i++) {
      expect(authRateLimitAllowed("/get-session", from("203.0.113.7"))).toBe(true);
    }
  });
});

describe("barrido de entradas caducadas", () => {
  beforeEach(() => resetRateLimit());
  const opts = { windowMs: 1000, max: 5 };

  it("las claves caducadas se eliminan tras SWEEP_EVERY accesos", () => {
    for (let i = 0; i < 100; i++) checkRateLimit(`old:${i}`, opts, 1_000);
    expect(rateLimitSize()).toBe(100);
    for (let i = 0; i < SWEEP_EVERY; i++) checkRateLimit("live", opts, 10_000);
    expect(rateLimitSize()).toBe(1);
  });

  it("no elimina entradas aún vigentes", () => {
    for (let i = 0; i < 10; i++) checkRateLimit(`v:${i}`, opts, 10_000);
    for (let i = 0; i < SWEEP_EVERY; i++) checkRateLimit("live", opts, 10_200);
    expect(rateLimitSize()).toBe(11);
  });

  it("no barre antes de SWEEP_EVERY (amortizado)", () => {
    checkRateLimit("old", opts, 1_000);
    for (let i = 0; i < SWEEP_EVERY - 3; i++) checkRateLimit("live", opts, 10_000);
    expect(rateLimitSize()).toBe(2);
  });

  it("finestras mixtas: un barrido provocado por tráfico de ventana corta no borra un contador de login de ventana larga", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < AUTH_RATE_LIMIT.max; i++) checkRateLimit("/sign-in/email:x", AUTH_RATE_LIMIT, t0 + i);
    // dos minutos después, 500 llamadas de API con ventana de 60 s disparan el barrido
    const later = t0 + 2 * 60_000;
    for (let i = 0; i < SWEEP_EVERY; i++) checkRateLimit("bot-api:org:a", { windowMs: 60_000, max: 10_000 }, later);
    expect(rateLimitSize()).toBe(2);
    expect(checkRateLimit("/sign-in/email:x", AUTH_RATE_LIMIT, later).allowed).toBe(false);
  });

  it("decide por la ÚLTIMA marca: un bucket con la primera marca caducada y la última viva no se borra", () => {
    const w = { windowMs: 1000, max: 1 };
    checkRateLimit("mixto", { windowMs: 1000, max: 5 }, 10_000);
    checkRateLimit("mixto", { windowMs: 1000, max: 5 }, 10_900);
    for (let i = 0; i < SWEEP_EVERY; i++) checkRateLimit("vivo", { windowMs: 1000, max: 10_000 }, 11_500);
    expect(rateLimitSize()).toBe(2);
    expect(isRateLimited("mixto", w, 11_500)).toBe(true);
  });
});
