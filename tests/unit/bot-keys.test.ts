import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  authenticateBot,
  generateBotKey,
  hashBotKey,
  type BotAuthDeps,
} from "@/server/bot/auth";
import { resetRateLimit } from "@/lib/rate-limit";

/**
 * Claves de bot por organización (P3 del audit 2026-10-01): la organización
 * sale SIEMPRE de la clave; la clave de instancia heredada solo vale con una
 * única organización.
 */

const INSTANCE_KEY = "clave-de-instancia-larga-0123456789abcdef";

type KeyRow = { id: string; organizationId: string; hash: string; revoked: boolean };

function fakeDeps(keys: KeyRow[], orgIds: string[]): BotAuthDeps & { touched: string[] } {
  const touched: string[] = [];
  return {
    touched,
    async findActiveKey(hash) {
      const row = keys.find((k) => k.hash === hash && !k.revoked);
      // Las filas de C1 son todas de ámbito "bot" (default de la columna scope).
      return row ? { id: row.id, organizationId: row.organizationId, scope: "bot" } : null;
    },
    async touchKey(id) {
      touched.push(id);
    },
    async listOrganizationIds(limit) {
      return orgIds.slice(0, limit);
    },
  };
}

function req(key?: string): Request {
  return new Request("http://localhost/api/bot/context", {
    headers: key ? { "x-api-key": key } : {},
  });
}

const keyA = generateBotKey();
const keyB = generateBotKey();
const revoked = generateBotKey();
const KEYS: KeyRow[] = [
  { id: "bk_a", organizationId: "org_a", hash: keyA.hash, revoked: false },
  { id: "bk_b", organizationId: "org_b", hash: keyB.hash, revoked: false },
  { id: "bk_r", organizationId: "org_a", hash: revoked.hash, revoked: true },
];

describe("generateBotKey", () => {
  it("prefijo vbk_, alta entropía, hash = sha256 del texto plano", () => {
    expect(keyA.plain.startsWith("vbk_")).toBe(true);
    expect(keyA.plain.length).toBeGreaterThanOrEqual(40);
    expect(keyA.hash).toBe(hashBotKey(keyA.plain));
    expect(keyA.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(keyA.plain).not.toBe(keyB.plain);
    expect(keyA.prefix).toBe(keyA.plain.slice(0, 12));
  });
});

describe("authenticateBot — clave por organización", () => {
  beforeEach(() => resetRateLimit());

  it("la clave de A resuelve org_a y la de B org_b (nunca otra)", async () => {
    const deps = fakeDeps(KEYS, ["org_a", "org_b"]);
    expect(await authenticateBot(req(keyA.plain), deps)).toEqual({
      organizationId: "org_a",
      keyId: "bk_a",
    });
    expect(await authenticateBot(req(keyB.plain), deps)).toEqual({
      organizationId: "org_b",
      keyId: "bk_b",
    });
    expect(deps.touched).toEqual(["bk_a", "bk_b"]);
  });

  it("clave revocada → 401", async () => {
    const res = await authenticateBot(req(revoked.plain), fakeDeps(KEYS, ["org_a", "org_b"]));
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(401);
  });

  it("clave vbk_ inventada → 401", async () => {
    const res = await authenticateBot(req("vbk_inventada"), fakeDeps(KEYS, ["org_a"]));
    expect((res as Response).status).toBe(401);
  });

  it("un fallo al registrar el uso no tumba la petición", async () => {
    const deps = fakeDeps(KEYS, ["org_a"]);
    deps.touchKey = async () => {
      throw new Error("db caída");
    };
    expect(await authenticateBot(req(keyA.plain), deps)).toEqual({
      organizationId: "org_a",
      keyId: "bk_a",
    });
  });
});

describe("authenticateBot — clave de instancia heredada", () => {
  beforeEach(() => {
    vi.stubEnv("BOT_API_KEY", INSTANCE_KEY);
    resetRateLimit();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("con UNA organización → esa organización", async () => {
    expect(await authenticateBot(req(INSTANCE_KEY), fakeDeps([], ["org_unica"]))).toEqual({
      organizationId: "org_unica",
      keyId: null,
    });
  });

  it("con VARIAS organizaciones → 401 instance_key_multi_org (antes: org arbitraria)", async () => {
    const res = (await authenticateBot(
      req(INSTANCE_KEY),
      fakeDeps([], ["org_a", "org_b"])
    )) as Response;
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("instance_key_multi_org");
  });

  it("sin organizaciones → 409 no_org", async () => {
    const res = (await authenticateBot(req(INSTANCE_KEY), fakeDeps([], []))) as Response;
    expect(res.status).toBe(409);
  });

  it("clave de instancia incorrecta → 401 sin consultar organizaciones", async () => {
    const deps = fakeDeps([], ["org_a"]);
    const spy = vi.spyOn(deps, "listOrganizationIds");
    const res = (await authenticateBot(req("otra-clave-igual-de-larga-pero-mala!!"), deps)) as Response;
    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it("sin header → 401", async () => {
    const res = (await authenticateBot(req(), fakeDeps(KEYS, ["org_a"]))) as Response;
    expect(res.status).toBe(401);
  });
});
