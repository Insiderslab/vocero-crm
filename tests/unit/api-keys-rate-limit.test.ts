import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  API_KEY_SCOPES,
  INVALID_HARD_FACTOR,
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

  it("claves inválidas: 401 hasta el máximo, luego 429 (con verificación) y, en el umbral duro, 429 sin consultar la base de datos", async () => {
    const d = deps();
    const { max } = API_KEY_SCOPES.export.rateLimit;
    for (let i = 0; i < max; i++) expect(await call(`vex_inventada_${i}`, "export", d)).toBe(401);
    expect(await call("vex_otra_inventada", "export", d)).toBe(429);
    expect(d.findActiveKey).toHaveBeenCalledTimes(max + 1);
    for (let i = max + 1; i < max * INVALID_HARD_FACTOR; i++) await call(`vex_mas_${i}`, "export", d);
    d.findActiveKey.mockClear();
    expect(await call("vex_ya_bloqueada", "export", d)).toBe(429);
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

  it("la avalancha sigue limitada: las consultas a la base de datos de una IP tienen techo (umbral duro)", async () => {
    const d = deps();
    const { max } = API_KEY_SCOPES.export.rateLimit;
    for (let i = 0; i < max * INVALID_HARD_FACTOR * 3; i++) {
      await callFrom(`vex_inventada_${i}`, "export", d, ATTACKER);
    }
    expect(d.findActiveKey).toHaveBeenCalledTimes(max * INVALID_HARD_FACTOR);
    d.findActiveKey.mockClear();
    expect(await callFrom("vex_otra_inventada", "export", d, ATTACKER)).toBe(429);
    expect(d.findActiveKey).not.toHaveBeenCalled();
  });

  it("otra IP con claves inválidas tiene su propio contador", async () => {
    const d = deps();
    await flood("export", d, ATTACKER);
    expect(await callFrom("vex_inventada_otra_ip", "export", d, OTHER)).toBe(401);
  });

  it.each(["export", "bot"] as const)(
    "%s: decisión: una clave VÁLIDA no la bloquean los fallos ajenos de su IP (por encima del umbral blando), también desde la misma IP",
    async (scope) => {
      const d = deps();
      await flood(scope, d, ATTACKER);
      for (let i = 0; i < 20; i++) await callFrom(`${API_KEY_SCOPES[scope].prefix}mas_${i}`, scope, d, ATTACKER);
      expect(await callFrom(VALID[scope], scope, d, ATTACKER)).toBe(200);
      expect(await callFrom(VALID[scope], scope, d, OTHER)).toBe(200);
    }
  );

  it("en el umbral duro la IP queda bloqueada también con una clave válida (freno: no hay intentos ilimitados)", async () => {
    const d = deps();
    const { max } = API_KEY_SCOPES.export.rateLimit;
    for (let i = 0; i < max * INVALID_HARD_FACTOR; i++) await callFrom(`vex_inventada_${i}`, "export", d, ATTACKER);
    d.findActiveKey.mockClear();
    expect(await callFrom(keyB.plain, "export", d, ATTACKER)).toBe(429);
    expect(d.findActiveKey).not.toHaveBeenCalled();
    expect(await callFrom(keyB.plain, "export", d, OTHER)).toBe(200);
  });

  it("entre el umbral blando y el duro un fallo recibe 429, no 401 (la respuesta no revela cuándo se acierta)", async () => {
    const d = deps();
    await flood("export", d, ATTACKER);
    expect(await callFrom("vex_inventada_x", "export", d, ATTACKER)).toBe(429);
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

  it("la IP que inunda recibe 429 en los fallos, pero su clave buena sigue entrando hasta el umbral duro", async () => {
    vi.stubEnv("EXPORT_API_KEY", INSTANCE);
    const { max } = API_KEY_SCOPES.export.rateLimit;
    for (let i = 0; i < max; i++) expect(await status(`falsa_${i}`, ATTACKER)).toBe(401);
    expect(await status("otra_falsa", ATTACKER)).toBe(429);
    expect(await status(INSTANCE, ATTACKER)).toBe(200);
  });

  it("flood de claves falsas desde X: la clave de instancia válida entra desde X y desde Y; el flood sigue limitado", async () => {
    vi.stubEnv("EXPORT_API_KEY", INSTANCE);
    const { max } = API_KEY_SCOPES.export.rateLimit;
    for (let i = 0; i < max * (INVALID_HARD_FACTOR - 1); i++) await status(`falsa_${i}`, ATTACKER);
    expect(await status(INSTANCE, ATTACKER)).toBe(200);
    expect(await status(INSTANCE, OTHER)).toBe(200);
    // el flood sigue limitado: en el umbral duro ni siquiera se compara la clave
    for (let i = 0; i < max * INVALID_HARD_FACTOR; i++) await status(`falsa_mas_${i}`, ATTACKER);
    expect(await status(INSTANCE, ATTACKER)).toBe(429);
    expect(await status(INSTANCE, OTHER)).toBe(200);
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

/**
 * Residuo "contador compartido por IP comunes" (PIANO-CRM-MULTICANALE M0.3):
 * el tráfico sin clave del ámbito (escáneres, o todo "local" cuando no hay
 * proxy) no debe tocar las claves por organización, ni viceversa.
 */
describe("contadores de fallos separados por tipo de clave", () => {
  beforeEach(() => resetRateLimit());
  afterEach(() => vi.unstubAllEnvs());

  const INSTANCE = "clave-export-de-instancia-0123456789";
  const { max } = API_KEY_SCOPES.export.rateLimit;
  const hardMax = max * INVALID_HARD_FACTOR;

  const call2 = async (key: string | null, headers: Record<string, string>) => {
    const r = await authenticateApiKey(
      new Request("http://localhost/api/x", {
        headers: { ...(key ? { "x-api-key": key } : {}), ...headers },
      }),
      "export",
      deps()
    );
    return r instanceof Response ? r.status : 200;
  };

  it.each([
    ["IP compartida", { "x-forwarded-for": "198.51.100.9" }],
    ["sin proxy: todo es \"local\"", {}],
  ])("%s: un flood SIN x-api-key (más allá del umbral duro) no bloquea la clave vex_ válida de otra organización", async (_n, h) => {
    for (let i = 0; i < hardMax + 50; i++) await call2(null, h);
    expect(await call2(null, h)).toBe(429);
    expect(await call2(keyB.plain, h)).toBe(200);
  });

  it("un flood de claves sin prefijo no bloquea la clave por organización de esa IP", async () => {
    const h = { "x-forwarded-for": "198.51.100.9" };
    for (let i = 0; i < hardMax + 50; i++) await call2(`falsa_${i}`, h);
    expect(await call2(keyA.plain, h)).toBe(200);
  });

  it("un flood de claves vex_ falsas (más allá del umbral duro) no bloquea la clave de instancia de esa IP", async () => {
    vi.stubEnv("EXPORT_API_KEY", INSTANCE);
    const h = { "x-forwarded-for": "198.51.100.9" };
    for (let i = 0; i < hardMax + 50; i++) await call2(`vex_falsa_${i}`, h);
    expect(await call2(`vex_falsa_final`, h)).toBe(429);
    expect(await call2(INSTANCE, h)).toBe(200);
  });
});

/**
 * Rama "variable de entorno de la clave de instancia ausente o demasiado
 * corta": sin clave válida posible, cada intento cuenta como fallo por IP.
 */
describe("clave de instancia: variable de entorno ausente o corta", () => {
  beforeEach(() => resetRateLimit());
  afterEach(() => vi.unstubAllEnvs());

  const ip = (xff: string) => new Request("http://localhost/api/x", {
    headers: { "x-api-key": "cualquiera-0123456789", "x-forwarded-for": xff },
  });
  const status = async (xff: string) => {
    const r = await authenticateApiKey(ip(xff), "export", deps());
    return r instanceof Response ? r.status : 200;
  };
  const { max } = API_KEY_SCOPES.export.rateLimit;

  it("EXPORT_API_KEY sin definir: 401 hasta el máximo y 429 después, por IP", async () => {
    vi.stubEnv("EXPORT_API_KEY", undefined);
    expect(process.env.EXPORT_API_KEY).toBeUndefined();
    for (let i = 0; i < max; i++) expect(await status("203.0.113.7")).toBe(401);
    expect(await status("203.0.113.7")).toBe(429);
    expect(await status("198.51.100.20")).toBe(401);
  });

  it("EXPORT_API_KEY de menos de 16 caracteres: nunca vale, ni siquiera enviándola igual; cuenta como fallo", async () => {
    vi.stubEnv("EXPORT_API_KEY", "corta-123");
    const corta = new Request("http://localhost/api/x", {
      headers: { "x-api-key": "corta-123", "x-forwarded-for": "203.0.113.7" },
    });
    const r = await authenticateApiKey(corta, "export", deps());
    expect(r instanceof Response && r.status).toBe(401);
    for (let i = 0; i < max - 1; i++) expect(await status("203.0.113.7")).toBe(401);
    expect(await status("203.0.113.7")).toBe(429);
  });
});

describe("clave activa de otro ámbito", () => {
  beforeEach(() => resetRateLimit());

  it("una clave existente y activa pero de otro ámbito cuenta como fallo (401) y no entra", async () => {
    const d: ApiKeyAuthDeps = {
      ...deps(),
      findActiveKey: async () => ({ id: "k_x", organizationId: "org_a", scope: "bot" }),
    };
    expect(await call("vex_clave_de_ambito_bot", "export", d)).toBe(401);
    const { max } = API_KEY_SCOPES.export.rateLimit;
    for (let i = 1; i < max; i++) await call("vex_clave_de_ambito_bot", "export", d);
    expect(await call("vex_clave_de_ambito_bot", "export", d)).toBe(429);
  });
});
