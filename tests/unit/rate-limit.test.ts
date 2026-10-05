import { beforeEach, describe, expect, it } from "vitest";
import {
  AUTH_RATE_LIMIT,
  checkRateLimit,
  clientIp,
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
