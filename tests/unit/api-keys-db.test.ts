import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

/**
 * Código REAL de acceso a datos de las claves de servicio (no el doble
 * `fakeDeps`): `dbApiKeyAuthDeps.findActiveKey` debe excluir las claves
 * revocadas en la propia consulta. Se intercepta el query builder de Drizzle
 * y se renderiza la condición WHERE con el dialecto de PostgreSQL (mismo
 * patrón que `export-keys-routes.test.ts`), sin base de datos.
 */

const state = vi.hoisted(() => ({
  wheres: [] as unknown[],
  queue: [] as unknown[][],
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "from", "limit", "orderBy", "set", "update"]) {
    builder[m] = () => builder;
  }
  builder.where = (w: unknown) => {
    state.wheres.push(w);
    return builder;
  };
  (builder as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    resolve(state.queue.shift() ?? []);
  return { ...actual, getDb: () => builder };
});

import { authenticateApiKey, dbApiKeyAuthDeps, generateApiKey } from "@/server/api-keys";
import { resetRateLimit } from "@/lib/rate-limit";

const dialect = new PgDialect();
const render = (w: unknown) => dialect.sqlToQuery(w as SQL);

describe("dbApiKeyAuthDeps.findActiveKey (consulta real)", () => {
  beforeEach(() => {
    state.wheres = [];
    state.queue = [];
    resetRateLimit();
  });

  it("filtra por hash Y excluye las claves revocadas (revoked_at is null)", async () => {
    state.queue = [[]];
    expect(await dbApiKeyAuthDeps.findActiveKey("h_abc")).toBeNull();
    expect(state.wheres).toHaveLength(1);
    const q = render(state.wheres[0]);
    expect(q.sql).toContain('"bot_api_key"."key_hash" = $1');
    expect(q.sql).toContain('"bot_api_key"."revoked_at" is null');
    expect(q.params).toEqual(["h_abc"]);
  });

  it("devuelve la fila que da la base de datos", async () => {
    const row = { id: "k_1", organizationId: "org_a", scope: "bot" };
    state.queue = [[row]];
    expect(await dbApiKeyAuthDeps.findActiveKey("h_abc")).toEqual(row);
  });

  it("authenticateApiKey con las deps reales: consulta con el hash de la clave y sin revocadas; sin fila → 401", async () => {
    const key = generateApiKey("export");
    state.queue = [[]]; // la BD no devuelve nada: revocada o inexistente
    const res = await authenticateApiKey(
      new Request("http://localhost/api/export/leads", { headers: { "x-api-key": key.plain } }),
      "export"
    );
    expect((res as Response).status).toBe(401);
    const q = render(state.wheres[0]);
    expect(q.params).toEqual([key.hash]);
    expect(q.sql).toContain('"bot_api_key"."revoked_at" is null');
  });
});
