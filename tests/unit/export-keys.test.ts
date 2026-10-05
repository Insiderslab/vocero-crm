import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateApiKey } from "@/server/api-keys";
import { authenticateBot } from "@/server/bot/auth";
import { authenticateExport, type ExportAuthDeps } from "@/server/export/auth";
import { withExport } from "@/server/export/handler";
import { resetRateLimit } from "@/lib/rate-limit";

/**
 * C2 (audit 2026-10-01): la extracción /api/export/* sale SIEMPRE de la
 * organización de la clave. `?org=` ya no elige organización.
 */

type KeyRow = { id: string; organizationId: string; scope: string; hash: string; revoked: boolean };

const ORGS = {
  org_a: { id: "org_a", name: "Org A", slug: "org-a" },
  org_b: { id: "org_b", name: "Org B", slug: "org-b" },
};

function fakeDeps(keys: KeyRow[], orgIds: (keyof typeof ORGS)[]): ExportAuthDeps {
  return {
    async findActiveKey(hash) {
      const row = keys.find((k) => k.hash === hash && !k.revoked);
      return row ? { id: row.id, organizationId: row.organizationId, scope: row.scope } : null;
    },
    async touchKey() {},
    async listOrganizationIds(limit) {
      return orgIds.slice(0, limit);
    },
    async loadOrganization(id) {
      return ORGS[id as keyof typeof ORGS] ?? null;
    },
  };
}

function req(key?: string, query = ""): Request {
  return new Request(`http://localhost/api/export/leads${query}`, {
    headers: key ? { "x-api-key": key } : {},
  });
}

const exA = generateApiKey("export");
const exB = generateApiKey("export");
const exRevoked = generateApiKey("export");
const botA = generateApiKey("bot");
// Fila con prefijo vex_ pero ámbito "bot": el ámbito de la fila manda.
const exWrongScope = generateApiKey("export");
const KEYS: KeyRow[] = [
  { id: "k_a", organizationId: "org_a", scope: "export", hash: exA.hash, revoked: false },
  { id: "k_b", organizationId: "org_b", scope: "export", hash: exB.hash, revoked: false },
  { id: "k_r", organizationId: "org_a", scope: "export", hash: exRevoked.hash, revoked: true },
  { id: "k_bot", organizationId: "org_a", scope: "bot", hash: botA.hash, revoked: false },
  { id: "k_ws", organizationId: "org_a", scope: "bot", hash: exWrongScope.hash, revoked: false },
];

const status = (r: unknown) => (r as Response).status;

describe("generateApiKey('export')", () => {
  it("prefijo vex_ distinto del de bot", () => {
    expect(exA.plain.startsWith("vex_")).toBe(true);
    expect(botA.plain.startsWith("vbk_")).toBe(true);
    expect(exA.prefix).toBe(exA.plain.slice(0, 12));
  });
});

describe("authenticateExport — clave por organización", () => {
  beforeEach(() => resetRateLimit());

  it("la clave de A resuelve org_a y la de B org_b", async () => {
    const deps = fakeDeps(KEYS, ["org_a", "org_b"]);
    expect(await authenticateExport(req(exA.plain), deps)).toEqual(ORGS.org_a);
    expect(await authenticateExport(req(exB.plain), deps)).toEqual(ORGS.org_b);
  });

  it("la clave de A con ?org= de B → 403 org_mismatch (por id y por slug)", async () => {
    const deps = fakeDeps(KEYS, ["org_a", "org_b"]);
    for (const q of ["?org=org_b", "?org=org-b"]) {
      const res = (await authenticateExport(req(exA.plain, q), deps)) as Response;
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("org_mismatch");
    }
  });

  it("la clave de A con ?org= propio (id o slug) → org_a", async () => {
    const deps = fakeDeps(KEYS, ["org_a", "org_b"]);
    expect(await authenticateExport(req(exA.plain, "?org=org_a"), deps)).toEqual(ORGS.org_a);
    expect(await authenticateExport(req(exA.plain, "?org=org-a"), deps)).toEqual(ORGS.org_a);
  });

  it("clave revocada → 401", async () => {
    expect(status(await authenticateExport(req(exRevoked.plain), fakeDeps(KEYS, ["org_a"])))).toBe(401);
  });

  it("clave vex_ inventada → 401", async () => {
    expect(status(await authenticateExport(req("vex_inventada"), fakeDeps(KEYS, ["org_a"])))).toBe(401);
  });

  it("una clave de bot (vbk_) no vale para export", async () => {
    expect(status(await authenticateExport(req(botA.plain), fakeDeps(KEYS, ["org_a"])))).toBe(401);
  });

  it("una clave de export (vex_) no vale para bot", async () => {
    expect(status(await authenticateBot(req(exA.plain), fakeDeps(KEYS, ["org_a"])))).toBe(401);
  });

  it("fila con ámbito distinto del prefijo → 401 (manda el ámbito guardado)", async () => {
    expect(status(await authenticateExport(req(exWrongScope.plain), fakeDeps(KEYS, ["org_a"])))).toBe(401);
  });

  it("clave válida de una organización que ya no existe → 401, también con ?org= de otra", async () => {
    const orphan = generateApiKey("export");
    const keys: KeyRow[] = [
      ...KEYS,
      { id: "k_o", organizationId: "org_borrada", scope: "export", hash: orphan.hash, revoked: false },
    ];
    for (const q of ["", "?org=org_a"]) {
      const res = (await authenticateExport(req(orphan.plain, q), fakeDeps(keys, ["org_a", "org_b"]))) as Response;
      expect(res).toBeInstanceOf(Response);
      expect(res.status).toBe(401);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("unauthorized");
    }
  });
});

describe("authenticateExport — clave de instancia heredada EXPORT_API_KEY", () => {
  const INSTANCE = "clave-export-de-instancia-0123456789";
  beforeEach(() => {
    vi.stubEnv("EXPORT_API_KEY", INSTANCE);
    vi.stubEnv("BOT_API_KEY", "clave-bot-de-instancia-0123456789ab");
    resetRateLimit();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("con UNA organización → esa organización", async () => {
    expect(await authenticateExport(req(INSTANCE), fakeDeps([], ["org_a"]))).toEqual(ORGS.org_a);
  });

  it("con VARIAS organizaciones → 401 instance_key_multi_org, también con ?org= (antes: cualquier org)", async () => {
    const res = (await authenticateExport(req(INSTANCE, "?org=org_b"), fakeDeps([], ["org_a", "org_b"]))) as Response;
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("instance_key_multi_org");
  });

  it("con UNA organización y ?org= de otra → 403", async () => {
    expect(status(await authenticateExport(req(INSTANCE, "?org=org_b"), fakeDeps([], ["org_a"])))).toBe(403);
  });

  it("la clave de instancia de bot no vale para export", async () => {
    expect(status(await authenticateExport(req("clave-bot-de-instancia-0123456789ab"), fakeDeps([], ["org_a"])))).toBe(401);
  });

  it("sin header → 401", async () => {
    expect(status(await authenticateExport(req(), fakeDeps(KEYS, ["org_a"])))).toBe(401);
  });
});

describe("withExport — el handler solo ve la organización de la clave", () => {
  beforeEach(() => resetRateLimit());

  it("clave de A: el handler recibe org_a aunque se pida otra cosa; con ?org=org_b ni se ejecuta", async () => {
    const seen: string[] = [];
    const route = withExport(async (org) => {
      seen.push(org.id);
      return Response.json({ org: org.id });
    }, fakeDeps(KEYS, ["org_a", "org_b"]));

    expect((await route(req(exA.plain))).status).toBe(200);
    expect((await route(req(exA.plain, "?org=org_b"))).status).toBe(403);
    expect((await route(req(exRevoked.plain))).status).toBe(401);
    expect(seen).toEqual(["org_a"]);
  });
});
