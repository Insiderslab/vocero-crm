import { drizzle } from "drizzle-orm/pg-proxy";

/**
 * Doble de la base de datos para i test del pacchetto 016: un proxy di Drizzle
 * che registra l'SQL vero e risponde con `answer(sql, params)` (righe come
 * array, nell'ordine delle colonne selezionate). I timestamp di colonna vanno
 * SENZA «Z» (il driver aggiunge +0000); i testi `cursorTs` sono stringhe libere.
 */
export type Recorded = { sql: string; params: unknown[] };

export async function makeProxyDb(
  log: Recorded[],
  answer: (sql: string, params: unknown[]) => unknown[][]
) {
  const schema = await import("@/lib/db/schema");
  const db = drizzle(
    async (sql, params) => {
      log.push({ sql, params });
      return { rows: answer(sql, params) };
    },
    { schema }
  );
  return { getDb: () => db, getSql: () => null, schema };
}

/** Risposta di `listening_mode`: acceso solo per le organizzazioni dell'insieme (param = org). */
export function listeningRows(on: ReadonlySet<string>, sql: string, params: unknown[]): unknown[][] | null {
  if (!/from "listening_mode"/.test(sql)) return null;
  return params.some((p) => typeof p === "string" && on.has(p))
    ? [[true, "2026-10-31T10:00:00.000"]]
    : [];
}
