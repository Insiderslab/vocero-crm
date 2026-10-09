import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

/**
 * Doble de la tabla `wapi_credentials` para tests con DOS organizaciones.
 * Renderiza el WHERE real que construye el código (dialecto PostgreSQL) y lo
 * aplica sobre filas en memoria: si el código olvida acotar por organización
 * (o por `revoked_at is null`), la consulta devuelve filas ajenas y el test
 * falla. El almacén vive en globalThis para sobrevivir a `vi.resetModules()`.
 */

export type WapiRow = {
  id: string;
  organizationId: string;
  keyCipher: string;
  keyIv: string;
  keyTag: string;
  keyLast4: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  revokedAt: Date | null;
};

type Store = { rows: WapiRow[]; writes: number };
const g = globalThis as unknown as { __fakeWapiStore?: Store };

export function wapiStore(): Store {
  return (g.__fakeWapiStore ??= { rows: [], writes: 0 });
}

export function resetWapiStore(): void {
  g.__fakeWapiStore = { rows: [], writes: 0 };
}

const dialect = new PgDialect();

function matches(where: unknown): (r: WapiRow) => boolean {
  const q = dialect.sqlToQuery(where as SQL);
  const orgs = q.params.filter((p): p is string => typeof p === "string");
  const scopedToOrg = q.sql.includes('"organization_id" = $');
  const onlyActive = q.sql.includes('"revoked_at" is null');
  return (r) =>
    // Sin condición de organización la consulta no filtra nada (como en SQL).
    (!scopedToOrg || orgs.includes(r.organizationId)) &&
    (!onlyActive || r.revokedAt === null);
}

export function createFakeWapiDb() {
  const store = wapiStore;
  return {
    select: () => ({
      from: () => ({
        where: (w: unknown) => ({
          limit: async () => {
            const pred = matches(w);
            return store()
              .rows.filter(pred)
              .map((r) => ({ ...r, last4: r.keyLast4 }));
          },
        }),
      }),
    }),
    insert: () => ({
      values: (v: Omit<WapiRow, "createdAt" | "updatedAt" | "revokedAt">) => ({
        onConflictDoUpdate: async (c: { set: Partial<WapiRow> }) => {
          const s = store();
          s.writes += 1;
          const existing = s.rows.find((r) => r.organizationId === v.organizationId);
          if (existing) Object.assign(existing, c.set);
          else
            s.rows.push({
              ...v,
              createdAt: new Date(),
              updatedAt: new Date(),
              revokedAt: null,
            });
        },
      }),
    }),
    update: () => ({
      set: (patch: Partial<WapiRow>) => ({
        where: (w: unknown) => ({
          returning: async () => {
            const s = store();
            const hit = s.rows.filter(matches(w));
            for (const r of hit) Object.assign(r, patch);
            s.writes += hit.length;
            return hit.map((r) => ({ id: r.id }));
          },
        }),
      }),
    }),
  };
}
