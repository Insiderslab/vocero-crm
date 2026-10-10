import { recreateSchemaAndMigrate, requireGoldenDatabaseUrl } from "./setup";

/**
 * Una vez por corrida: valida `DATABASE_URL_GOLDEN` (sin ella la corrida
 * FALLA con un mensaje claro, nunca se salta) y deja el esquema limpio y
 * migrado con el runner real.
 */
export default async function globalSetup(): Promise<void> {
  const url = requireGoldenDatabaseUrl();
  await recreateSchemaAndMigrate(url);
}
