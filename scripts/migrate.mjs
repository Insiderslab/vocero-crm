/**
 * Migraciones al ARRANQUE del contenedor (no en pre-deploy: el pre-deploy de
 * plataformas como Coolify corre en el contenedor viejo). Se bundlea con
 * esbuild dentro de la imagen (incluye `migrate-channels.mjs`) y corre antes
 * de `node server.js`.
 *
 * 005 (R1): además de las migraciones de Drizzle, reconcilia y verifica el
 * livello canali en CADA arranque (ADR 0001 §3.3, `migrate-channels.mjs`). La
 * modalidad es una constante del release (`RELEASE_MODE`), nunca una variable
 * de entorno.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RELEASE_MODE, runStartup } from "./migrate-channels.mjs";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[migrate] DATABASE_URL no está definida");
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder =
  process.env.MIGRATIONS_DIR ?? path.join(here, "drizzle");

process.exit(await runStartup({ url, migrationsFolder, mode: RELEASE_MODE }));
