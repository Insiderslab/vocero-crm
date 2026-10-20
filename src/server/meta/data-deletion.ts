import { customAlphabet } from "nanoid";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import type { PublicDeletionStatus } from "@/lib/legal";

/**
 * 015 — Richieste di cancellazione dati arrivate da Meta.
 *
 * Il CRM non conserva l'ID utente Facebook: una richiesta non si lega da sola
 * a un'organizzazione. Qui si REGISTRA (codice di conferma, stato, date) e la
 * cancellazione la esegue una persona da /admin → «Richieste di cancellazione
 * Meta» (vedi docs/ops/cancellazione-dati-meta.md: cosa controllare a mano).
 */

export type DeletionStatus = "received" | "in_progress" | "completed";
export const DELETION_STATUSES: readonly DeletionStatus[] = ["received", "in_progress", "completed"];

/** 20 caratteri alfanumerici da una fonte crittografica (~119 bit): non indovinabile. */
export const CONFIRMATION_CODE_PATTERN = /^[A-Za-z0-9]{20}$/;
const newCode = customAlphabet("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz", 20);

export function isConfirmationCode(value: unknown): value is string {
  return typeof value === "string" && CONFIRMATION_CODE_PATTERN.test(value);
}

/** Indirizzo da restituire a Meta: la pagina pubblica con il codice. */
export function statusUrl(appBaseUrl: string, code: string): string {
  return `${appBaseUrl.replace(/\/+$/, "")}/cancellazione-dati?id=${encodeURIComponent(code)}`;
}

/**
 * Registra la richiesta. Se per lo stesso utente Meta c'è già una richiesta
 * NON completata (Meta riprova, o l'utente la rimanda), si restituisce quella:
 * stesso codice, nessuna riga doppia. Ritorna il codice di conferma.
 */
export async function registerDeletionRequest(input: {
  metaUserId: string;
  issuedAt: Date | null;
}): Promise<{ code: string; reused: boolean }> {
  const t = schema.metaDataDeletionRequest;
  // Lettura e inserimento sotto un lock per utente Meta (transazionale): due
  // callback simultanei per la stessa persona non creano due righe aperte.
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"meta-deletion:" + input.metaUserId}))`);
    const open = await tx
      .select({ code: t.confirmationCode })
      .from(t)
      .where(and(eq(t.metaUserId, input.metaUserId), ne(t.status, "completed")))
      .orderBy(desc(t.createdAt))
      .limit(1);
    if (open[0]) return { code: open[0].code, reused: true };

    // Una collisione su 62^20 non succede; il ciclo c'è solo per non fallire se capitasse.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const code = newCode();
      const inserted = await tx
        .insert(t)
        .values({
          id: newId("metaDataDeletion"),
          metaUserId: input.metaUserId,
          confirmationCode: code,
          issuedAt: input.issuedAt,
        })
        .onConflictDoNothing({ target: t.confirmationCode })
        .returning({ code: t.confirmationCode });
      if (inserted[0]) return { code: inserted[0].code, reused: false };
    }
    throw new Error("registerDeletionRequest: impossibile generare un codice unico");
  });
}

export type { PublicDeletionStatus } from "@/lib/legal";

/** Stato per la pagina pubblica. Solo stato e date: mai l'ID Meta né la nota. */
export async function deletionStatusByCode(code: string): Promise<PublicDeletionStatus | null> {
  if (!isConfirmationCode(code)) return null;
  const t = schema.metaDataDeletionRequest;
  const rows = await getDb()
    .select({ status: t.status, createdAt: t.createdAt, updatedAt: t.updatedAt, completedAt: t.completedAt })
    .from(t)
    .where(eq(t.confirmationCode, code))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    status: r.status,
    createdAt: new Date(r.createdAt).toISOString(),
    updatedAt: new Date(r.updatedAt).toISOString(),
    completedAt: r.completedAt ? new Date(r.completedAt).toISOString() : null,
  };
}

export type AdminDeletionRequest = {
  id: string;
  metaUserId: string;
  confirmationCode: string;
  status: DeletionStatus;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  /** Giorni rimasti ai 30 promessi (negativo = in ritardo); null se completata. */
  daysLeft: number | null;
};

export const DELETION_DEADLINE_DAYS = 30;

/** Elenco per il super-admin: prima tutte le aperte, poi le ultime completate. */
export async function listDeletionRequests(now: Date = new Date()): Promise<AdminDeletionRequest[]> {
  const t = schema.metaDataDeletionRequest;
  // Tutte le aperte (nessuna può sparire dall'elenco) + le ultime 100 completate.
  const [open, done] = await Promise.all([
    getDb().select().from(t).where(ne(t.status, "completed")).orderBy(desc(t.createdAt)),
    getDb().select().from(t).where(eq(t.status, "completed")).orderBy(desc(t.createdAt)).limit(100),
  ]);
  const rows = [...open, ...done];
  const items = rows.map((r) => {
    const created = new Date(r.createdAt);
    const daysLeft =
      r.status === "completed"
        ? null
        : DELETION_DEADLINE_DAYS - Math.floor((now.getTime() - created.getTime()) / 86_400_000);
    return {
      id: r.id,
      metaUserId: r.metaUserId,
      confirmationCode: r.confirmationCode,
      status: r.status,
      note: r.note,
      createdAt: created.toISOString(),
      updatedAt: new Date(r.updatedAt).toISOString(),
      completedAt: r.completedAt ? new Date(r.completedAt).toISOString() : null,
      daysLeft,
    };
  });
  return items;
}

/** Cambio di stato dal super-admin. `completed` fissa la data di completamento. */
export async function updateDeletionRequest(input: {
  id: string;
  status: DeletionStatus;
  /** undefined = nota invariata; null o "" = nota cancellata. */
  note?: string | null;
  updatedBy: string;
}): Promise<boolean> {
  const t = schema.metaDataDeletionRequest;
  const now = new Date();
  const updated = await getDb()
    .update(t)
    .set({
      status: input.status,
      ...(input.note !== undefined ? { note: input.note } : {}),
      updatedBy: input.updatedBy,
      updatedAt: now,
      completedAt: input.status === "completed" ? now : null,
    })
    .where(eq(t.id, input.id))
    .returning({ id: t.id });
  return updated.length > 0;
}
