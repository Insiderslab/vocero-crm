import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/pg-proxy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * C2 + constitución III: las rutas de extracción `/api/export/*` leen SOLO la
 * organización de la clave, y TODA tabla que tocan (también las de los JOIN)
 * se acota con `scoped()` de `@/lib/db/tenant`.
 *
 * Prueba de comportamiento: la base de datos es un proxy de Drizzle que
 * registra el SQL real que genera cada ruta. Para cada consulta de datos, cada
 * tabla del FROM/JOIN debe llevar `"<tabla>"."organization_id" = $n` con el id
 * de la organización de la clave, y ningún parámetro puede ser el id de otra.
 *
 * Prueba estructural: las rutas filtran por organización a través de
 * `scoped()`, nunca con un `eq(...organizationId...)` suelto.
 */

const ORG_A = "org_a";
const ORG_B = "org_b";

type Query = { sql: string; params: unknown[] };

const state = vi.hoisted(() => ({
  queries: [] as { sql: string; params: unknown[] }[],
  keyOrg: "org_a",
}));

vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema");
  const db = drizzle(
    async (sql, params) => {
      state.queries.push({ sql, params });
      // Autenticación: la clave vex_ existe y es de la organización de la prueba.
      if (/from "bot_api_key"/.test(sql)) {
        return { rows: [["k_1", state.keyOrg, "export"]] };
      }
      if (/from "organization"/.test(sql)) {
        return { rows: [[state.keyOrg, `Org ${state.keyOrg}`, state.keyOrg]] };
      }
      return { rows: [] };
    },
    { schema }
  );
  return { getDb: () => db, getSql: () => null, schema };
});

import { generateApiKey } from "@/server/api-keys";
import { resetRateLimit } from "@/lib/rate-limit";
import { GET as exportContacts } from "@/app/api/export/contacts/route";
import { GET as exportConversations } from "@/app/api/export/conversations/route";
import { GET as exportLeads } from "@/app/api/export/leads/route";
import { GET as exportMessages } from "@/app/api/export/messages/route";

const key = generateApiKey("export");

const ROUTES: [string, (req: Request) => Promise<Response>][] = [
  ["contacts", exportContacts],
  ["conversations", exportConversations],
  ["leads", exportLeads],
  ["messages", exportMessages],
];

function call(handler: (req: Request) => Promise<Response>, name: string, query = "") {
  return handler(
    new Request(`http://localhost/api/export/${name}${query}`, {
      headers: { "x-api-key": key.plain },
    })
  );
}

/** Consultas de datos (fuera de la autenticación de la clave). */
function dataQueries(): Query[] {
  return state.queries.filter(
    (q) => /^select/i.test(q.sql) && !/from "(bot_api_key|organization)"/.test(q.sql)
  );
}

function tablesOf(sql: string): string[] {
  return [...sql.matchAll(/(?:from|join) "(\w+)"/g)].map((m) => m[1]!);
}

/** ¿La consulta acota `table` por organization_id = orgId? */
function scopesTable(q: Query, table: string, orgId: string): boolean {
  const re = new RegExp(`"${table}"\\."organization_id" = \\$(\\d+)`, "g");
  return [...q.sql.matchAll(re)].some((m) => q.params[Number(m[1]) - 1] === orgId);
}

beforeEach(() => {
  resetRateLimit();
  state.queries = [];
  state.keyOrg = ORG_A;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("export: cada tabla consultada se acota a la organización de la clave", () => {
  it.each(ROUTES)("/api/export/%s", async (name, handler) => {
    for (const org of [ORG_A, ORG_B]) {
      state.queries = [];
      state.keyOrg = org;
      const res = await call(handler, name);
      expect(res.status).toBe(200);

      const queries = dataQueries();
      expect(queries.length).toBeGreaterThan(0);
      for (const q of queries) {
        const tables = tablesOf(q.sql);
        expect(tables.length).toBeGreaterThan(0);
        for (const table of tables) {
          expect(scopesTable(q, table, org), `${name}: "${table}" sin organization_id = ${org}\n${q.sql}`).toBe(true);
        }
        const other = org === ORG_A ? ORG_B : ORG_A;
        expect(q.params).not.toContain(other);
      }
    }
  });

  it("messages con ?conversation= de otra organización sigue acotado a la de la clave", async () => {
    const res = await call(exportMessages, "messages", "?conversation=cv_de_b");
    expect(res.status).toBe(200);
    const [q] = dataQueries();
    expect(q).toBeDefined();
    expect(scopesTable(q!, "message", ORG_A)).toBe(true);
    expect(scopesTable(q!, "conversation", ORG_A)).toBe(true);
    expect(q!.params).toContain("cv_de_b");
  });

  it("?org= de otra organización → 403 sin ninguna consulta de datos", async () => {
    for (const [name, handler] of ROUTES) {
      state.queries = [];
      const res = await call(handler, name, `?org=${ORG_B}`);
      expect(res.status).toBe(403);
      expect(dataQueries()).toEqual([]);
    }
  });
});

describe("export: el filtro de organización pasa por scoped() (estructural)", () => {
  const dir = path.resolve(import.meta.dirname, "../../src/app/api/export");
  const files = readdirSync(dir).map((d) => path.join(dir, d, "route.ts"));

  it("hay rutas que revisar", () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  it.each(files.map((f) => [path.relative(dir, f), f]))("%s", (_rel, file) => {
    const src = readFileSync(file, "utf8");
    expect(src).toMatch(/import \{ scoped \} from "@\/lib\/db\/tenant"/);
    expect(src).toMatch(/withExport\(/);
    // Ningún filtro de organización a mano: siempre scoped(columna, org.id, …).
    expect(src).not.toMatch(/eq\(\s*schema\.\w+\.organizationId/);
    // Cada tabla en FROM/JOIN aparece como columna organizationId de un scoped().
    const tables = [...src.matchAll(/\.(?:from|innerJoin|leftJoin)\(\s*schema\.(\w+)/g)].map(
      (m) => m[1]!
    );
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) {
      expect(src, `${t} sin scoped()`).toMatch(
        new RegExp(`scoped\\(\\s*schema\\.${t}\\.organizationId,\\s*org\\.id`)
      );
    }
  });
});
