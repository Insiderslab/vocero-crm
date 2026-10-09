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

/**
 * Claves inválidas: el contador es por IP del cliente (`clientIp`, la misma
 * regla del login). Una avalancha desde una IP no bloquea las claves válidas
 * que llegan desde otras IPs, y sigue limitada para la IP que la envía.
 */
describe("claves inválidas: contador por IP del cliente", () => {
  beforeEach(() => resetRateLimit());

  const ATTACKER = "203.0.113.7";
  const OTHER = "198.51.100.20";
  const VALID: Record<ApiKeyScope, string> = { export: keyB.plain, bot: botA.plain };

  async function callFrom(key: string, scope: ApiKeyScope, d: ApiKeyAuthDeps, xff: string) {
    const r = await authenticateApiKey(
      new Request("http://localhost/api/x", {
        headers: { "x-api-key": key, "x-forwarded-for": xff },
      }),
      scope,
      d
    );
    return r instanceof Response ? r.status : 200;
  }

  async function flood(scope: ApiKeyScope, d: ApiKeyAuthDeps, xff: string) {
    const { max } = API_KEY_SCOPES[scope].rateLimit;
    const { prefix } = API_KEY_SCOPES[scope];
    for (let i = 0; i < max; i++) {
      expect(await callFrom(`${prefix}inventada_${i}`, scope, d, xff)).toBe(401);
    }
  }

  it.each(["export", "bot"] as const)(
    "%s: una avalancha desde una IP no bloquea la clave válida que llega de otra IP",
    async (scope) => {
      const d = deps();
      await flood(scope, d, ATTACKER);
      expect(await callFrom(VALID[scope], scope, d, OTHER)).toBe(200);
    }
  );

  it("la avalancha sigue limitada: la IP que la envía recibe 429 sin consultar la base de datos", async () => {
    const d = deps();
    await flood("export", d, ATTACKER);
    d.findActiveKey.mockClear();
    expect(await callFrom("vex_otra_inventada", "export", d, ATTACKER)).toBe(429);
    expect(d.findActiveKey).not.toHaveBeenCalled();
  });

  it("otra IP con claves inválidas tiene su propio contador", async () => {
    const d = deps();
    await flood("export", d, ATTACKER);
    expect(await callFrom("vex_inventada_otra_ip", "export", d, OTHER)).toBe(401);
  });

  it("decisión: la IP bloqueada lo está también con una clave válida (si no, el 200 delataría la clave buena)", async () => {
    const d = deps();
    await flood("export", d, ATTACKER);
    d.findActiveKey.mockClear();
    expect(await callFrom(keyB.plain, "export", d, ATTACKER)).toBe(429);
    expect(d.findActiveKey).not.toHaveBeenCalled();
  });

  it("cuenta la primera IP de x-forwarded-for, no la del proxy añadida detrás", async () => {
    const d = deps();
    await flood("export", d, `${ATTACKER}, 10.0.0.1`);
    expect(await callFrom("vex_x", "export", d, ATTACKER)).toBe(429);
    expect(await callFrom("vex_y", "export", d, "10.0.0.1")).toBe(401);
  });

  it("las claves válidas no consumen el contador de inválidas de su IP", async () => {
    const d = deps();
    for (let i = 0; i < 5; i++) expect(await callFrom(keyA.plain, "export", d, ATTACKER)).toBe(200);
    await flood("export", d, ATTACKER);
    expect(await callFrom("vex_z", "export", d, ATTACKER)).toBe(429);
  });

  it("una avalancha completa no consume el contador de ninguna organización", async () => {
    const d = deps();
    await flood("export", d, ATTACKER);
    for (let i = 0; i < 5; i++) expect(await callFrom(`vex_mas_${i}`, "export", d, ATTACKER)).toBe(429);
    const { max } = API_KEY_SCOPES.export.rateLimit;
    for (let i = 0; i < max; i++) expect(await callFrom(keyA.plain, "export", d, OTHER)).toBe(200);
  });
});

/**
 * Clave de instancia: los fallos cuentan por IP del cliente y el contador de
 * la instancia solo se consume tras una comparación correcta. Una avalancha
 * de x-api-key falsas no bloquea la clave de instancia legítima.
 */
describe("clave de instancia: fallos por IP, contador tras comparación correcta", () => {
  beforeEach(() => resetRateLimit());
  afterEach(() => vi.unstubAllEnvs());

  const INSTANCE = "clave-export-de-instancia-0123456789";
  const ATTACKER = "203.0.113.7";
  const OTHER = "198.51.100.20";

  const from = (key: string | null, xff: string) =>
    new Request("http://localhost/api/x", {
      headers: { ...(key ? { "x-api-key": key } : {}), "x-forwarded-for": xff },
    });
  const status = async (key: string | null, xff: string) => {
    const r = await authenticateApiKey(from(key, xff), "export", deps());
    return r instanceof Response ? r.status : 200;
  };

  it("una avalancha de claves sin prefijo no bloquea la clave de instancia legítima", async () => {
    vi.stubEnv("EXPORT_API_KEY", INSTANCE);
    const { max } = API_KEY_SCOPES.export.rateLimit;
    for (let i = 0; i < max + 5; i++) await status(`falsa_${i}`, ATTACKER);
    expect(await status(INSTANCE, OTHER)).toBe(200);
  });

  it("la IP que inunda queda en 429, incluso con la clave buena", async () => {
    vi.stubEnv("EXPORT_API_KEY", INSTANCE);
    const { max } = API_KEY_SCOPES.export.rateLimit;
    for (let i = 0; i < max; i++) expect(await status(`falsa_${i}`, ATTACKER)).toBe(401);
    expect(await status("otra_falsa", ATTACKER)).toBe(429);
    expect(await status(INSTANCE, ATTACKER)).toBe(429);
  });

  it("sin cabecera x-api-key también cuenta como fallo por IP", async () => {
    vi.stubEnv("EXPORT_API_KEY", INSTANCE);
    const { max } = API_KEY_SCOPES.export.rateLimit;
    for (let i = 0; i < max; i++) expect(await status(null, ATTACKER)).toBe(401);
    expect(await status(null, ATTACKER)).toBe(429);
    expect(await status(INSTANCE, OTHER)).toBe(200);
  });

  it("los fallos no consumen el contador de la instancia; los aciertos sí", async () => {
    vi.stubEnv("EXPORT_API_KEY", INSTANCE);
    const { max } = API_KEY_SCOPES.export.rateLimit;
    for (let i = 0; i < max - 1; i++) await status(`falsa_${i}`, `10.0.0.${i % 200}`);
    for (let i = 0; i < max; i++) expect(await status(INSTANCE, OTHER)).toBe(200);
    expect(await status(INSTANCE, OTHER)).toBe(429);
  });
});
