import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * CRM-1 (rapporto Heili Shield del 16/10/2026): sin sesión, la marca era la
 * de `organization` con `limit(1)` sin orden → con varias organizaciones,
 * cualquiera veía la marca de una al azar (y el login, la equivocada).
 * El código REAL de `getBrandingContext` corre contra un doble de Drizzle que
 * aplica el `eq(id, …)` y el `limit` de verdad.
 */

type Org = { id: string; metadata: string | null; createdAt: number };
const state = vi.hoisted(() => ({ orgs: [] as Org[], queries: [] as string[] }));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  const idOf = (cond: unknown): string | undefined => {
    const chunks = (cond as { queryChunks?: unknown[] })?.queryChunks ?? [];
    for (const c of chunks) {
      if (c && typeof c === "object" && "value" in c && typeof (c as { value: unknown }).value === "string") {
        return (c as { value: string }).value;
      }
    }
    return undefined;
  };
  const db = {
    select: () => {
      let rows = [...state.orgs];
      let kind = "all";
      const builder = {
        from: () => builder,
        where: (cond: unknown) => {
          const id = idOf(cond);
          rows = rows.filter((o) => o.id === id);
          kind = `where:${id}`;
          return builder;
        },
        orderBy: () => {
          rows.sort((a, b) => a.createdAt - b.createdAt);
          kind = "ordered";
          return builder;
        },
        limit: async (n: number) => {
          state.queries.push(`${kind}:limit${n}`);
          return rows.slice(0, n).map(({ id, metadata }) => ({ id, metadata }));
        },
      };
      return builder;
    },
  };
  return { ...actual, getDb: () => db };
});

beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgresql://t:t@localhost:5432/t";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test";
});

const brand = (name: string) => JSON.stringify({ branding: { name } });

beforeEach(() => {
  state.queries.length = 0;
  delete process.env.BRANDING_ORGANIZATION_ID;
  // getEnv() se memoriza: módulos nuevos en cada test para releer el entorno.
  vi.resetModules();
});

async function context(orgId?: string | null) {
  const { getBrandingContext } = await import("@/server/branding");
  return getBrandingContext(orgId);
}

describe("CRM-1: marca sin sesión", () => {
  it("con varias organizaciones y nada configurado → marca por defecto, nunca la de otra", async () => {
    const { DEFAULT_BRANDING } = await import("@/lib/branding");
    state.orgs = [
      { id: "org_b", metadata: brand("Azienda B"), createdAt: 2 },
      { id: "org_a", metadata: brand("Azienda A"), createdAt: 1 },
    ];
    const ctx = await context();
    expect(ctx.organizationId).toBeNull();
    expect(ctx.branding).toEqual(DEFAULT_BRANDING);
    expect(JSON.stringify(ctx)).not.toMatch(/Azienda/);
    expect(state.queries).toEqual(["ordered:limit2"]);
  });

  it("con una sola organización → la suya (instancia de un solo negocio, como antes)", async () => {
    state.orgs = [{ id: "org_a", metadata: brand("Azienda A"), createdAt: 1 }];
    const ctx = await context();
    expect(ctx.organizationId).toBe("org_a");
    expect(ctx.branding.name).toBe("Azienda A");
  });

  it("con BRANDING_ORGANIZATION_ID → exactamente esa, aunque haya varias", async () => {
    process.env.BRANDING_ORGANIZATION_ID = "org_b";
    state.orgs = [
      { id: "org_a", metadata: brand("Azienda A"), createdAt: 1 },
      { id: "org_b", metadata: brand("Azienda B"), createdAt: 2 },
    ];
    const ctx = await context();
    expect(ctx.organizationId).toBe("org_b");
    expect(ctx.branding.name).toBe("Azienda B");
    expect(state.queries).toEqual(["where:org_b:limit1"]);
  });

  it("instancia vacía → marca por defecto", async () => {
    state.orgs = [];
    const ctx = await context();
    expect(ctx.organizationId).toBeNull();
  });
});

describe("con sesión: la marca de SU organización", () => {
  it("cada organización ve la suya", async () => {
    state.orgs = [
      { id: "org_a", metadata: brand("Azienda A"), createdAt: 1 },
      { id: "org_b", metadata: brand("Azienda B"), createdAt: 2 },
    ];
    expect((await context("org_b")).branding.name).toBe("Azienda B");
    expect((await context("org_a")).branding.name).toBe("Azienda A");
    expect(state.queries).toEqual(["where:org_b:limit1", "where:org_a:limit1"]);
  });
});
