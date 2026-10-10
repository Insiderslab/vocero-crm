import { spawnSync } from "node:child_process";
import path from "node:path";
import postgres from "postgres";

/**
 * Base de datos de los golden (005-livello-canali, T003).
 *
 * - `requireGoldenDatabaseUrl()`: `DATABASE_URL_GOLDEN` obligatoria y con
 *   «golden» en el nombre de la base. Los golden VACÍAN el esquema: jamás
 *   deben poder apuntar a una base con datos (Ley Zero).
 * - `recreateSchemaAndMigrate()`: esquema limpio y migraciones con el runner
 *   REAL de la imagen (`scripts/migrate.mjs`). Así, cuando M1.2 añada la
 *   reconciliación al runner, los golden la ejercitan sin tocar este archivo.
 * - `resetDatabase()` + `seedOrganizations()`: antes de CADA caso, tablas
 *   vacías y dos organizaciones, A y B, cada una con su número.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

/** Bases que este arnés jamás debe tocar aunque alguien las nombre. */
const FORBIDDEN_DATABASES = new Set(["vocero_e2e", "vocero_up", "vocero", "postgres"]);

export function requireGoldenDatabaseUrl(): string {
  const url = process.env.DATABASE_URL_GOLDEN?.trim();
  if (!url) {
    throw new Error(
      "[golden] Falta DATABASE_URL_GOLDEN. Los golden necesitan un PostgreSQL 16 " +
        "usa-y-tira (se BORRA su esquema en cada corrida), por ejemplo:\n" +
        "  DATABASE_URL_GOLDEN=postgres://vocero@127.0.0.1:5433/vocero_golden pnpm test:golden\n" +
        "No se saltan: sin base de datos la corrida falla (Leyes de Heili, Primera Ley)."
    );
  }
  let dbName: string;
  try {
    dbName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    throw new Error("[golden] DATABASE_URL_GOLDEN no es una URL válida de PostgreSQL");
  }
  if (!/golden/i.test(dbName) || FORBIDDEN_DATABASES.has(dbName)) {
    throw new Error(
      `[golden] La base «${dbName}» no parece usa-y-tira: su nombre debe contener «golden» ` +
        "(el arnés borra el esquema public en cada corrida)."
    );
  }
  return url;
}

/** Esquema limpio + migraciones con el runner de la imagen. */
export async function recreateSchemaAndMigrate(url: string): Promise<void> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE");
    await sql.unsafe("CREATE SCHEMA public");
  } finally {
    await sql.end();
  }
  const run = spawnSync(process.execPath, [path.join(REPO_ROOT, "scripts", "migrate.mjs")], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      DATABASE_URL: url,
      MIGRATIONS_DIR: path.join(REPO_ROOT, "drizzle"),
    },
    encoding: "utf8",
    timeout: 120_000,
  });
  if (run.status !== 0) {
    throw new Error(
      `[golden] el runner de migraciones salió con código ${run.status}:\n${run.stdout}\n${run.stderr}`
    );
  }
}

/* ---------------- Organizaciones A y B (datos sintéticos, D12) ---------------- */

export const ORG_A = "org_golden_a";
export const ORG_B = "org_golden_b";

export type GoldenOrg = {
  id: string;
  name: string;
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string;
  verifiedName: string;
  /** Token Meta SINTÉTICO (no es un token real). */
  token: string;
};

export const ORGS: Record<"A" | "B", GoldenOrg> = {
  A: {
    id: ORG_A,
    name: "Negocio Golden A",
    wabaId: "200000000000001",
    phoneNumberId: "100000000000001",
    displayPhoneNumber: "+52 55 1000 0001",
    verifiedName: "Golden A",
    token: "EAAGoldenSyntheticTokenOrgA0001",
  },
  B: {
    id: ORG_B,
    name: "Negocio Golden B",
    wabaId: "200000000000002",
    phoneNumberId: "100000000000002",
    displayPhoneNumber: "+52 55 1000 0002",
    verifiedName: "Golden B",
    token: "EAAGoldenSyntheticTokenOrgB0002",
  },
};

/** Clave Wapi SINTÉTICA de A (formato `hlp_live_`, C3). */
export const WAPI_KEY_A = "hlp_live_goldenSyntheticKeyOrgA0001";
/** Token del proveedor de IA SINTÉTICO. */
export const AI_TOKEN = "sk-or-golden-synthetic-token";

/** Vacía todas las tablas del esquema public (la historia de migraciones vive en `drizzle`). */
export async function resetDatabase(sql: postgres.Sql): Promise<void> {
  const rows = await sql<{ tablename: string }[]>`
    select tablename from pg_tables where schemaname = 'public'
  `;
  if (rows.length === 0) return;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(", ");
  await sql.unsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

/**
 * Siembra A y B: organización, una etapa abierta del pipeline (el webhook crea
 * el lead en la primera) y la conexión de WhatsApp guardada con la función
 * REAL `saveCredentials` (en R1 hará también la doble escritura).
 */
export async function seedOrganizations(sql: postgres.Sql): Promise<void> {
  const { saveCredentials } = await import("@/server/whatsapp/credentials");
  for (const [key, org] of Object.entries(ORGS)) {
    await sql`
      insert into organization (id, name, slug)
      values (${org.id}, ${org.name}, ${`golden-${key.toLowerCase()}`})
    `;
    await sql`
      insert into pipeline_stage (id, organization_id, name, position, kind)
      values (${`stg_golden_${key.toLowerCase()}_nuevo`}, ${org.id}, 'Nuevo', 0, 'open'),
             (${`stg_golden_${key.toLowerCase()}_ganado`}, ${org.id}, 'Ganado', 1, 'won')
    `;
    await saveCredentials({
      organizationId: org.id,
      wabaId: org.wabaId,
      phoneNumberId: org.phoneNumberId,
      token: org.token,
      displayPhoneNumber: org.displayPhoneNumber,
      verifiedName: org.verifiedName,
    });
  }
}
