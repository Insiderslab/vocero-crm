import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Collegamento del límite de login (FR-062) al hook REAL de Better Auth en
 * `src/lib/auth/index.ts`: `authRateLimitAllowed` está probada aparte; aquí se
 * prueba que el hook la llama. Sin base de datos: los módulos que la tocan se
 * sustituyen, y el hook corre ANTES de cualquier acceso a datos.
 */
vi.mock("@/lib/db", async (orig) => ({
  ...(await orig<typeof import("@/lib/db")>()),
  getDb: () => ({}),
}));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    APP_BASE_URL: "http://localhost:3000",
    BETTER_AUTH_SECRET: "x".repeat(40),
  }),
}));
vi.mock("@/server/auth/on-signup", () => ({
  onUserCreated: async () => {},
  resolveActiveOrganizationId: async () => null,
}));
vi.mock("@/server/auth/registration", () => ({
  isPublicSignupAllowed: async () => true,
}));

import { AUTH_RATE_LIMIT, resetRateLimit } from "@/lib/rate-limit";
import { getAuth } from "@/lib/auth";

const signIn = (ip: string, path = "/api/auth/sign-in/email") =>
  getAuth().handler(
    new Request(`http://localhost:3000${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        "x-forwarded-for": ip,
      },
      body: JSON.stringify({ email: "nadie@example.com", password: "incorrecta-123" }),
    })
  );

describe("hook de login de Better Auth: el límite está conectado", () => {
  beforeEach(() => {
    resetRateLimit();
    // Los intentos que pasan el hook llegan a la base de datos simulada y fallan
    // (500): es ruido esperado de Better Auth, no se muestra.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("tras AUTH_RATE_LIMIT.max intentos desde una IP, el siguiente recibe 429; otra IP no", async () => {
    for (let i = 0; i < AUTH_RATE_LIMIT.max; i++) {
      expect((await signIn("203.0.113.7")).status).not.toBe(429);
    }
    expect((await signIn("203.0.113.7")).status).toBe(429);
    expect((await signIn("198.51.100.20")).status).not.toBe(429);
  });

  it("el registro (/sign-up/email) comparte el mecanismo: 429 tras el máximo", async () => {
    for (let i = 0; i < AUTH_RATE_LIMIT.max; i++) {
      expect((await signIn("203.0.113.8", "/api/auth/sign-up/email")).status).not.toBe(429);
    }
    expect((await signIn("203.0.113.8", "/api/auth/sign-up/email")).status).toBe(429);
  });
});
