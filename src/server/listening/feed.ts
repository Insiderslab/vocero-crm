import { sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { apiError } from "@/lib/api";
import { getListeningState } from "@/server/listening/mode";

/**
 * 016 — Contratto `orbit.core-feed/v1`: piccole parti comuni di
 * `/api/export/core/*` (cursore, limite, busta della risposta). Solo lettura.
 *
 * Il cursore è opaco: base64url di `<ISO>|<id>`. L'ISO ha la precisione dei
 * microsecondi di PostgreSQL (non i millisecondi di JS): con i millisecondi,
 * una riga con `...123456` sarebbe ancora "dopo" il cursore `...123` e
 * tornerebbe a ogni pagina. La condizione keyset `(ts, id) > (cursore)` è
 * quella di `keysetAfter`, l'unica del feed.
 */

export const FEED_SCHEMA = "orbit.core-feed/v1";
export const FEED_DEFAULT_LIMIT = 500;
export const FEED_MAX_LIMIT = 1000;

export type FeedCursor = { ts: string; id: string };

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function encodeCursor(ts: string, id: string): string {
  return Buffer.from(`${ts}|${id}`, "utf8").toString("base64url");
}

/** null = cursore malformato (data non ISO, id non valido, base64url sporco). */
export function decodeCursor(raw: string): FeedCursor | null {
  const text = Buffer.from(raw, "base64url").toString("utf8");
  // Rifiuta il base64 "tollerante": deve essere esattamente quello che emettiamo.
  if (Buffer.from(text, "utf8").toString("base64url") !== raw) return null;
  const parts = text.split("|");
  if (parts.length !== 2) return null;
  const [ts, id] = parts as [string, string];
  if (!ISO_RE.test(ts) || !ID_RE.test(id) || !isRealInstant(ts)) return null;
  return { ts, id };
}

/**
 * La data esiste davvero: niente anno 0 e niente «31 febbraio», che
 * `Date.parse` normalizza ma PostgreSQL rifiuta (500 invece di 422). Andata e
 * ritorno fino ai secondi: i microsecondi li controlla `ISO_RE`.
 */
function isRealInstant(ts: string): boolean {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime()) || d.getUTCFullYear() < 1) return false;
  return d.toISOString().slice(0, 19) === ts.slice(0, 19);
}

export type FeedParams = { after: FeedCursor | null; limit: number };

/** `after` e `limit` della richiesta; fuori dai limiti → 422, prima di toccare il database. */
export function parseFeedParams(url: URL): FeedParams | Response {
  const rawAfter = url.searchParams.get("after");
  let after: FeedCursor | null = null;
  if (rawAfter !== null) {
    after = decodeCursor(rawAfter);
    if (!after) return apiError(422, "invalid_cursor", "Cursore non valido");
  }
  const rawLimit = url.searchParams.get("limit");
  let limit = FEED_DEFAULT_LIMIT;
  if (rawLimit !== null) {
    limit = /^\d{1,5}$/.test(rawLimit) ? Number(rawLimit) : 0;
    if (limit < 1 || limit > FEED_MAX_LIMIT) {
      return apiError(422, "invalid_limit", `limit deve essere tra 1 e ${FEED_MAX_LIMIT}`);
    }
  }
  return { after, limit };
}

/** Formato del cursore: microsecondi (`US`), mai millisecondi (`MS`), vedi sopra. */
export const MICRO_ISO_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"';

/** ISO con microsecondi di una colonna/espressione timestamp (il valore del cursore). */
export function microIso(expr: SQL | PgColumn): SQL<string> {
  return sql<string>`to_char(${expr}, ${sql.raw(`'${MICRO_ISO_FORMAT}'`)})`;
}

/** Condizione keyset: righe strettamente dopo il cursore nell'ordine (ts, id). */
export function keysetAfter(
  ts: SQL | PgColumn,
  idColumn: PgColumn,
  after: FeedCursor | null
): SQL | undefined {
  return after ? sql`(${ts}, ${idColumn}) > (${after.ts}::timestamp, ${after.id})` : undefined;
}

/**
 * Busta delle liste. `nextCursor` = cursore dell'ultimo elemento restituito, o
 * null se la pagina è vuota (niente di nuovo): il Core lo conserva e riparte da
 * lì al pull successivo; un cursore su una pagina piena non perde la posizione.
 */
export async function feedList(
  organizationId: string,
  items: unknown[],
  last: { cursorTs: string; id: string } | undefined
): Promise<Response> {
  const { enabled } = await getListeningState(organizationId);
  return Response.json({
    schema: FEED_SCHEMA,
    organizationId,
    listening: enabled,
    items,
    nextCursor: last ? encodeCursor(last.cursorTs, last.id) : null,
  });
}
