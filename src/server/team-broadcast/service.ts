import { and, count, desc, eq, gt, lte, min, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { countVariables } from "@/lib/templates";
import { getOrCreateContactByIdentity } from "@/server/inbox/identity";
import { getOrCreateConversation } from "@/server/inbox/ingest";
import { SendError } from "@/server/inbox/send";
import { getCredentialsByOrg } from "@/server/whatsapp/credentials";
import { sendTemplate, TemplateError } from "@/server/whatsapp/templates";
import {
  maskIdentity,
  TEAM_BROADCAST_IDEMPOTENCY_MS,
  TEAM_BROADCAST_MAX_PER_HOUR,
  TEAM_BROADCAST_MAX_RECIPIENTS,
  TEAM_BROADCAST_RATE_WINDOW_MS,
  type TeamBroadcastBody,
} from "./validation";

/**
 * 012 — Ronda del team (specs/custom-heili/012-ronda-team.md).
 *
 * Un generatore esterno (n8n, attività pianificata) consegna le priorità del
 * giorno; il CRM le invia come modello approvato dal numero
 * dell'organizzazione a OGNI numero della lista del team (007) e a nessun
 * altro. L'invio è quello di sempre (`sendTemplate`): credenziali cifrate,
 * sandbox, messaggio persistito e visibile in Posta.
 *
 * Orologio: ore e limiti con quello dell'app (JS), che è anche quello che
 * scrive `created_at`; mai mescolato con `now()` del database.
 */

export class TeamBroadcastError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfterSec?: number
  ) {
    super(message);
    this.name = "TeamBroadcastError";
  }
}

export type RecipientResult = {
  /** Sempre mascherato alle ultime 3 cifre. */
  recipient: string;
  status: "sent" | "failed" | "skipped";
  messageId?: string;
  /** Codice tipizzato dell'errore (`failed`). */
  error?: string;
  /** Motivo (`skipped`). */
  reason?: "dry_run" | "aborted";
};

export type TeamBroadcastResult = {
  broadcastId: string | null;
  replayed: boolean;
  dryRun: boolean;
  template: { name: string; language: string };
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  results: RecipientResult[];
  /** Voci di `perRecipient` fuori dalla lista del team: ignorate (mascherate). */
  unknownRecipients: string[];
};

/** Pausa tra un invio e il successivo (come il motore delle automazioni). */
const SLEEP_BETWEEN_SENDS_MS = 150;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Errori dell'ORGANIZZAZIONE, non del destinatario: dopo uno di questi gli
 * altri invii fallirebbero uguale. Si smette di chiamare Meta e il resto
 * risulta `skipped` / `aborted`.
 */
const FATAL_SEND_CODES = new Set(["not_connected", "reconnect_required", "wapi_key_missing"]);

type BroadcastRow = typeof schema.teamBroadcast.$inferSelect;

/** Ronda registrata con questa chiave negli ultimi 36 h (o null). */
async function findByKey(
  organizationId: string,
  idempotencyKey: string,
  now: Date
): Promise<BroadcastRow | null> {
  const rows = await getDb()
    .select()
    .from(schema.teamBroadcast)
    .where(
      scoped(
        schema.teamBroadcast.organizationId,
        organizationId,
        eq(schema.teamBroadcast.idempotencyKey, idempotencyKey),
        gt(
          schema.teamBroadcast.createdAt,
          new Date(now.getTime() - TEAM_BROADCAST_IDEMPOTENCY_MS)
        )
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

function replayOf(row: BroadcastRow): TeamBroadcastResult {
  if (row.status !== "done" || !row.result) {
    throw new TeamBroadcastError(
      409,
      "broadcast_in_progress",
      "Una ronda con questa Idempotency-Key è ancora in corso (o si è interrotta): non si reinvia"
    );
  }
  return { ...(row.result as TeamBroadcastResult), replayed: true };
}

type Claim =
  | { kind: "claimed"; id: string }
  | { kind: "replay"; row: BroadcastRow }
  | { kind: "rate_limited"; retryAfterSec: number };

/**
 * Prende la chiave di idempotenza e un posto nel limite orario, in UNA
 * transazione serializzata per organizzazione (advisory lock): due chiamate
 * contemporanee non possono né usare la stessa chiave né superare il limite.
 */
async function claim(input: {
  organizationId: string;
  idempotencyKey: string;
  templateName: string;
  language: string;
  total: number;
  now: Date;
}): Promise<Claim> {
  const { organizationId, idempotencyKey, now } = input;
  return getDb().transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`team_broadcast:${organizationId}`}))`
    );
    // Una chiave più vecchia di 36 h torna libera.
    await tx
      .delete(schema.teamBroadcast)
      .where(
        scoped(
          schema.teamBroadcast.organizationId,
          organizationId,
          eq(schema.teamBroadcast.idempotencyKey, idempotencyKey),
          lte(
            schema.teamBroadcast.createdAt,
            new Date(now.getTime() - TEAM_BROADCAST_IDEMPOTENCY_MS)
          )
        )
      );
    const existing = await tx
      .select()
      .from(schema.teamBroadcast)
      .where(
        scoped(
          schema.teamBroadcast.organizationId,
          organizationId,
          eq(schema.teamBroadcast.idempotencyKey, idempotencyKey)
        )
      )
      .limit(1);
    if (existing[0]) return { kind: "replay", row: existing[0] };

    const windowStart = new Date(now.getTime() - TEAM_BROADCAST_RATE_WINDOW_MS);
    const [usage] = await tx
      .select({ n: count(), oldest: min(schema.teamBroadcast.createdAt) })
      .from(schema.teamBroadcast)
      .where(
        scoped(
          schema.teamBroadcast.organizationId,
          organizationId,
          gt(schema.teamBroadcast.createdAt, windowStart)
        )
      );
    if ((usage?.n ?? 0) >= TEAM_BROADCAST_MAX_PER_HOUR) {
      const oldest = usage?.oldest ?? now;
      const freeAt = oldest.getTime() + TEAM_BROADCAST_RATE_WINDOW_MS;
      return {
        kind: "rate_limited",
        retryAfterSec: Math.max(1, Math.ceil((freeAt - now.getTime()) / 1000)),
      };
    }

    const id = newId("teamBroadcast");
    await tx.insert(schema.teamBroadcast).values({
      id,
      organizationId,
      idempotencyKey,
      templateName: input.templateName,
      language: input.language,
      status: "running",
      total: input.total,
      createdAt: now,
    });
    return { kind: "claimed", id };
  });
}

/** Esegue (o simula, o ripete) una ronda. Lancia `TeamBroadcastError` per i rifiuti. */
export async function runTeamBroadcast(input: {
  organizationId: string;
  idempotencyKey: string;
  body: TeamBroadcastBody;
}): Promise<TeamBroadcastResult> {
  const { organizationId, idempotencyKey, body } = input;
  const db = getDb();
  const now = new Date();

  // 1) Stessa chiave entro 36 h: il primo risultato, senza inviare nulla.
  const previous = await findByKey(organizationId, idempotencyKey, now);
  if (previous) return replayOf(previous);

  // 2) Destinatari: SOLO la lista del team, e solo se la restrizione è attiva.
  const profiles = await db
    .select({
      restrictToAllowlist: schema.agentProfile.restrictToAllowlist,
      allowedIdentities: schema.agentProfile.allowedIdentities,
    })
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  const profile = profiles[0];
  if (!profile || !profile.restrictToAllowlist || profile.allowedIdentities.length === 0) {
    throw new TeamBroadcastError(
      409,
      "no_team_list",
      "Nessuna lista del team: attiva «Accesso riservato» nella pagina Agente IA e aggiungi i numeri"
    );
  }
  const team = [...new Set(profile.allowedIdentities)];
  if (team.length > TEAM_BROADCAST_MAX_RECIPIENTS) {
    throw new TeamBroadcastError(
      409,
      "team_too_large",
      `La lista del team ha più di ${TEAM_BROADCAST_MAX_RECIPIENTS} numeri: la ronda è per il team, non un invio massivo`
    );
  }

  // 3) Numero collegato (prima di consumare la chiave di idempotenza).
  const creds = await getCredentialsByOrg(organizationId);
  if (!creds) {
    throw new TeamBroadcastError(409, "not_connected", "Nessun numero WhatsApp collegato");
  }
  if (creds.status === "reconnect_required") {
    throw new TeamBroadcastError(409, "reconnect_required", "Il token di WhatsApp è scaduto: ricollega il numero");
  }

  // 4) Modello: dell'organizzazione, stessa lingua, approvato, stessi parametri.
  const templates = await db
    .select()
    .from(schema.template)
    .where(
      scoped(
        schema.template.organizationId,
        organizationId,
        eq(schema.template.name, body.templateName),
        eq(schema.template.language, body.language)
      )
    )
    .limit(1);
  const template = templates[0];
  if (!template) {
    throw new TeamBroadcastError(
      422,
      "template_not_found",
      `Modello «${body.templateName}» (${body.language}) non trovato tra quelli sincronizzati: sincronizza i modelli`
    );
  }
  if (template.status !== "approved") {
    throw new TeamBroadcastError(
      422,
      "template_not_approved",
      `Il modello «${template.name}» (${template.language}) non è approvato da Meta (stato: ${template.status})`
    );
  }
  const variableCount = countVariables(template.body);
  const perRecipient = body.perRecipient ?? new Map<string, string[]>();
  const counts = [body.params.length, ...[...perRecipient.values()].map((p) => p.length)];
  if (counts.some((n) => n !== variableCount)) {
    throw new TeamBroadcastError(
      422,
      "template_params_mismatch",
      `Il modello «${template.name}» vuole ${variableCount} parametri: params e ogni voce di perRecipient devono averne esattamente ${variableCount}`
    );
  }

  const plan = team.map((identity) => ({
    identity,
    params: perRecipient.get(identity) ?? body.params,
  }));
  const teamSet = new Set(team);
  const unknownRecipients = [...perRecipient.keys()]
    .filter((k) => !teamSet.has(k))
    .map(maskIdentity);
  const base = {
    replayed: false,
    template: { name: template.name, language: template.language },
    total: plan.length,
    unknownRecipients,
  };

  // 5) dryRun: tutti i controlli sopra, nessun invio, nessuna scrittura.
  if (body.dryRun) {
    return {
      ...base,
      broadcastId: null,
      dryRun: true,
      sent: 0,
      failed: 0,
      skipped: plan.length,
      results: plan.map((p) => ({
        recipient: maskIdentity(p.identity),
        status: "skipped" as const,
        reason: "dry_run" as const,
      })),
    };
  }

  // 6) Chiave + limite orario, atomici.
  const claimed = await claim({
    organizationId,
    idempotencyKey,
    templateName: template.name,
    language: template.language,
    total: plan.length,
    now,
  });
  if (claimed.kind === "replay") return replayOf(claimed.row);
  if (claimed.kind === "rate_limited") {
    throw new TeamBroadcastError(
      429,
      "rate_limited",
      `Massimo ${TEAM_BROADCAST_MAX_PER_HOUR} ronde all'ora per organizzazione`,
      claimed.retryAfterSec
    );
  }

  // 7) Invii, uno alla volta, con il percorso di sempre.
  const results: RecipientResult[] = [];
  let abortedBy: string | null = null;
  for (const [i, item] of plan.entries()) {
    const recipient = maskIdentity(item.identity);
    if (abortedBy) {
      results.push({ recipient, status: "skipped", reason: "aborted" });
      continue;
    }
    try {
      // Come l'ingest: identità normalizzata = telefono; se nasce, contatto +
      // contact_identity nella stessa transazione (005). Un archiviato resta tale.
      const { contact } = await getOrCreateContactByIdentity(
        organizationId,
        { identity: item.identity, phone: item.identity, waUserId: null, profileName: null },
        { reactivate: false }
      );
      const conversation = await getOrCreateConversation(organizationId, contact.id);
      const sent = await sendTemplate({
        organizationId,
        conversationId: conversation.id,
        templateId: template.id,
        variables: item.params,
      });
      results.push({ recipient, status: "sent", messageId: sent.messageId });
    } catch (err) {
      const code =
        err instanceof SendError || err instanceof TemplateError ? err.code : "internal";
      results.push({ recipient, status: "failed", error: code });
      // Mai parametri né numeri completi nei log.
      console.warn(`[team-broadcast] ${organizationId}: invio a ${recipient} fallito (${code})`);
      if (FATAL_SEND_CODES.has(code)) abortedBy = code;
    }
    if (!abortedBy && i < plan.length - 1) await sleep(SLEEP_BETWEEN_SENDS_MS);
  }

  const tally = (s: RecipientResult["status"]) => results.filter((r) => r.status === s).length;
  const result: TeamBroadcastResult = {
    ...base,
    broadcastId: claimed.id,
    dryRun: false,
    sent: tally("sent"),
    failed: tally("failed"),
    skipped: tally("skipped"),
    results,
  };

  await db
    .update(schema.teamBroadcast)
    .set({
      status: "done",
      sent: result.sent,
      failed: result.failed,
      skipped: result.skipped,
      result,
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(schema.teamBroadcast.organizationId, organizationId),
        eq(schema.teamBroadcast.id, claimed.id)
      )
    );

  console.log(
    `[team-broadcast] ${organizationId}: ronda ${claimed.id} (${template.name}/${template.language}) → ` +
      `${result.sent} inviati, ${result.failed} falliti, ${result.skipped} saltati`
  );
  return result;
}

export type LastTeamBroadcast = {
  at: string;
  status: "running" | "done";
  total: number;
  sent: number;
  failed: number;
  skipped: number;
};

/** Ultima ronda dell'organizzazione (riga di sola lettura nella pagina Agente IA). */
export async function getLastTeamBroadcast(
  organizationId: string
): Promise<LastTeamBroadcast | null> {
  const rows = await getDb()
    .select()
    .from(schema.teamBroadcast)
    .where(scoped(schema.teamBroadcast.organizationId, organizationId))
    .orderBy(desc(schema.teamBroadcast.createdAt))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    at: row.createdAt.toISOString(),
    status: row.status,
    total: row.total,
    sent: row.sent,
    failed: row.failed,
    skipped: row.skipped,
  };
}
