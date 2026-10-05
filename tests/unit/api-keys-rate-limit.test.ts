import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  API_KEY_SCOPES,
  authenticateApiKey,
  generateApiKey,
  type ApiKeyAuthDeps,
  type ApiKeyScope,
} from "@/server/api-keys";
import { resetRateLimit } from "@/lib/rate-limit";

/**
 * Rate limit de las claves de servicio: el límite existe y se cuenta por
 * organización, así una organización no agota el límite de otra.
 */

const keyA = generateApiKey("export");
const keyA2 = generateApiKey("export");
const keyB = generateApiKey("export");
const botA = generateApiKey("bot");

const ROWS: Record<string, { id: string; organizationId: string; scope: string }> = {
  [keyA.hash]: { id: "k_a", organizationId: "org_a", scope: "export" },
  [keyA2.hash]: { id: "k_a2", organizationId: "org_a", scope: "export" },
  [keyB.hash]: { id: "k_b", organizationId: "org_b", scope: "export" },
  [botA.hash]: { id: "k_bot", organizationId: "org_a", scope: "bot" },
};

function deps(): ApiKeyAuthDeps & { findActiveKey: ReturnType<typeof vi.fn> } {
  return {
    findActiveKey: vi.fn(async (hash: string) => ROWS[hash] ?? null),
    async touchKey() {},
    async listOrganizationIds(limit) {
      return ["org_a"].slice(0, limit);
    },
  };
}

const req = (key: string) =>
  new Request("http://localhost/api/x", { headers: { "x-api-key": key } });

async function call(key: string, scope: ApiKeyScope, d: ApiKeyAuthDeps) {
  const r = await authenticateApiKey(req(key), scope, d);
  return r instanceof Response ? r.status : 200;
}

async function exhaust(key: string, scope: ApiKeyScope, d: ApiKeyAuthDeps) {
  const { max } = API_KEY_SCOPES[scope].rateLimit;
  for (let i = 0; i < max; i++) expect(await call(key, scope, d)).toBe(200);
}

describe("rate limit de claves de servicio por organización", () => {
  beforeEach(() => resetRateLimit());
  afterEach(() => vi.unstubAllEnvs());

  it("el límite existe: superado el máximo, la misma organización recibe 429", async () => {
    const d = deps();
    await exhaust(keyA.plain, "export", d);
    expect(await call(keyA.plain, "export", d)).toBe(429);
  });

  it("A agota su límite y B sigue entrando", async () => {
    const d = deps();
    await exhaust(keyA.plain, "export", d);
    expect(await call(keyA.plain, "export", d)).toBe(429);
    expect(await call(keyB.plain, "export", d)).toBe(200);
  });

  it("el límite es de la organización: otra clave de A no lo multiplica", async () => {
    const d = deps();
    await exhaust(keyA.plain, "export", d);
    expect(await call(keyA2.plain, "export", d)).toBe(429);
  });

  it("los ámbitos tienen contadores separados: export agotado no bloquea bot de A", async () => {
    const d = deps();
    await exhaust(keyA.plain, "export", d);
    expect(await call(botA.plain, "bot", d)).toBe(200);
  });

  it("claves inválidas: 401 hasta el máximo y luego 429 sin consultar la base de datos", async () => {
    const d = deps();
    const { max } = API_KEY_SCOPES.export.rateLimit;
    for (let i = 0; i < max; i++) expect(await call(`vex_inventada_${i}`, "export", d)).toBe(401);
    d.findActiveKey.mockClear();
    expect(await call("vex_otra_inventada", "export", d)).toBe(429);
    expect(d.findActiveKey).not.toHaveBeenCalled();
  });

  it("las claves inválidas no consumen el contador de una organización", async () => {
    const d = deps();
    const { max } = API_KEY_SCOPES.export.rateLimit;
    for (let i = 0; i < max - 1; i++) await call(`vex_inventada_${i}`, "export", d);
    await exhaust(keyA.plain, "export", d);
  });

  it("el tráfico de la clave de instancia no consume el contador de las organizaciones", async () => {
    const instance = "clave-export-de-instancia-0123456789";
    vi.stubEnv("EXPORT_API_KEY", instance);
    const d = deps();
    const { max } = API_KEY_SCOPES.export.rateLimit;
    for (let i = 0; i < max; i++) expect(await call(instance, "export", d)).toBe(200);
    expect(await call(instance, "export", d)).toBe(429);
    expect(await call(keyA.plain, "export", d)).toBe(200);
  });
});
