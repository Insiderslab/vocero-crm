import { z } from "zod";
import { MAX_TEMPLATE_VARIABLES } from "@/lib/templates";
import { normalizeAllowlistEntry } from "@/server/ai/allowlist";

/**
 * 012 — Ronda del team: la parte PURA (senza database) di
 * `POST /api/bot/team-broadcast`. Schema del body, normalizzazione dei
 * parametri, chiave di idempotenza e maschera dei numeri.
 */

/** Massimo di destinatari di una ronda: è il team, non una rubrica (Costituzione VIII). */
export const TEAM_BROADCAST_MAX_RECIPIENTS = 50;
/** Ronde (non dryRun) per organizzazione nell'ultima ora mobile. */
export const TEAM_BROADCAST_MAX_PER_HOUR = 3;
export const TEAM_BROADCAST_RATE_WINDOW_MS = 60 * 60 * 1000;
/** Per quanto tempo la stessa Idempotency-Key restituisce il primo risultato. */
export const TEAM_BROADCAST_IDEMPOTENCY_MS = 36 * 60 * 60 * 1000;
/** Lunghezza massima di un parametro del corpo DOPO la normalizzazione. */
export const TEAM_PARAM_MAX = 1024;
/** Tetto sul testo grezzo, prima della normalizzazione (limita il body). */
const TEAM_PARAM_RAW_MAX = 4096;

/**
 * Meta rifiuta nei parametri del corpo a capo, tab e più di 4 spazi di fila.
 * Decisione: si normalizza invece di rifiutare (il generatore è un LLM e un
 * a capo di troppo non deve far saltare la ronda): ogni sequenza di spazi
 * bianchi diventa UN solo spazio, gli altri caratteri di controllo spariscono
 * e si tolgono gli spazi agli estremi.
 */
export function normalizeTemplateParam(raw: string): string {
  return raw
    .replace(/[\u0000-\u0008\u000E-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const paramSchema = z
  .string()
  .max(TEAM_PARAM_RAW_MAX)
  .transform(normalizeTemplateParam)
  .pipe(
    z
      .string()
      .min(1, "parametro vuoto")
      .max(TEAM_PARAM_MAX, `parametro oltre ${TEAM_PARAM_MAX} caratteri`)
  );

const paramsSchema = z.array(paramSchema).min(1).max(MAX_TEMPLATE_VARIABLES);

/**
 * Chiave di `perRecipient`: un numero scritto come nella lista del team
 * (`+39 347 …`), oppure SOLO cifre, cioè la forma in cui la lista lo salva
 * (`393471234567`, come `wa_identity`). Un numero con spazi ma senza «+»
 * ("347 123 4567") si rifiuta, come nella lista: senza prefisso
 * internazionale non coinciderebbe mai. La normalizzazione è QUELLA della
 * lista (allowlist.ts).
 */
export function normalizeRecipientKey(raw: string): string | null {
  const typed = raw.trim();
  if (!typed) return null;
  return normalizeAllowlistEntry(/^\d+$/.test(typed) ? `+${typed}` : typed);
}

export const teamBroadcastBodySchema = z
  .object({
    templateName: z.string().trim().min(1).max(512),
    language: z
      .string()
      .trim()
      .regex(/^[a-z]{2,3}(_[A-Za-z]{2,4})?$/, "codice lingua non valido (es. it, es, es_MX)"),
    params: paramsSchema,
    perRecipient: z
      .record(z.string().max(40), paramsSchema)
      .optional()
      .superRefine((map, ctx) => {
        if (!map) return;
        const keys = Object.keys(map);
        if (keys.length > TEAM_BROADCAST_MAX_RECIPIENTS) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `massimo ${TEAM_BROADCAST_MAX_RECIPIENTS} voci`,
          });
          return;
        }
        const seen = new Set<string>();
        for (const key of keys) {
          const normalized = normalizeRecipientKey(key);
          if (!normalized) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `numero non valido: scrivilo con «+» e il prefisso internazionale (${maskIdentity(key)})`,
            });
          } else if (seen.has(normalized)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `numero ripetuto (${maskIdentity(normalized)})`,
            });
          } else {
            seen.add(normalized);
          }
        }
      })
      .transform((map) => {
        if (!map) return undefined;
        const out = new Map<string, string[]>();
        for (const [key, params] of Object.entries(map)) {
          out.set(normalizeRecipientKey(key)!, params);
        }
        return out;
      }),
    dryRun: z.boolean().optional(),
  })
  .strict();

export type TeamBroadcastBody = z.output<typeof teamBroadcastBodySchema>;

/** Idempotency-Key: 1–128 caratteri sicuri (es. `ronda-2026-10-13`). */
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{1,128}$/;

export function parseIdempotencyKey(header: string | null): string | null {
  const key = header?.trim() ?? "";
  return IDEMPOTENCY_KEY.test(key) ? key : null;
}

/**
 * Numero mascherato alle ultime 3 cifre (`…567`): l'unica forma in cui un
 * numero del team compare in log, risposte e registro della ronda.
 */
export function maskIdentity(identity: string): string {
  const digits = identity.replace(/\D/g, "");
  return digits.length > 0 ? `…${digits.slice(-3)}` : "…";
}

/**
 * Lo stesso schema tipizzato per `parseBody` (che vuole input = output): qui
 * l'input è JSON grezzo e l'output è già normalizzato (`Map` per numero).
 */
export const teamBroadcastBody = teamBroadcastBodySchema as unknown as z.ZodType<TeamBroadcastBody>;
