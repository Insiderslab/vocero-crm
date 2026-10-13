import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mockGuard,
  unsignedWebhookAllowed,
  webhookSecretMissingWarning,
} from "@/lib/dev-guard";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("mockGuard (FR-080: mocks en producción → 404)", () => {
  it("producción con flag activo → 404 igualmente", () => {
    vi.stubEnv("WA_MOCK_ENABLED", "true");
    vi.stubEnv("NODE_ENV", "production");
    const res = mockGuard();
    expect(res).not.toBeNull();
    expect(res!.status).toBe(404);
  });

  it("desarrollo sin flag → 404", () => {
    vi.stubEnv("WA_MOCK_ENABLED", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(mockGuard()?.status).toBe(404);
  });

  it("desarrollo con flag → permitido (null)", () => {
    vi.stubEnv("WA_MOCK_ENABLED", "true");
    vi.stubEnv("NODE_ENV", "development");
    expect(mockGuard()).toBeNull();
  });

  it("test con flag → permitido (null)", () => {
    vi.stubEnv("WA_MOCK_ENABLED", "true");
    vi.stubEnv("NODE_ENV", "test");
    expect(mockGuard()).toBeNull();
  });
});

describe("unsignedWebhookAllowed: mismo gate que los mocks", () => {
  it.each([
    ["production", "true", false],
    ["production", "", false],
    ["development", "", false],
    ["test", "", false],
    ["development", "true", true],
    ["test", "true", true],
  ])("NODE_ENV=%s WA_MOCK_ENABLED=%s → %s", (nodeEnv, flag, expected) => {
    vi.stubEnv("NODE_ENV", nodeEnv);
    vi.stubEnv("WA_MOCK_ENABLED", flag);
    expect(unsignedWebhookAllowed()).toBe(expected);
  });
});

describe("webhookSecretMissingWarning", () => {
  it("producción sin secreto → aviso claro (nombra la variable y el 503)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WA_MOCK_ENABLED", "true");
    const warning = webhookSecretMissingWarning(undefined);
    expect(warning).toContain("META_APP_SECRET");
    expect(warning).toContain("503");
    expect(webhookSecretMissingWarning("   ")).not.toBeNull();
  });

  it("con secreto → sin aviso, y el aviso nunca contiene el valor", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(webhookSecretMissingWarning("valor-secreto")).toBeNull();
  });

  it("gate de pruebas sin secreto → sin aviso", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("WA_MOCK_ENABLED", "true");
    expect(webhookSecretMissingWarning(undefined)).toBeNull();
  });
});
