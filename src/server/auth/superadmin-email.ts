/**
 * Regole PURE sulle email di super-admin (`SUPERADMIN_EMAILS`), senza
 * dipendenze da Better Auth: le usano sia `@/lib/auth` (hook di creazione
 * utenti) sia `@/server/auth/superadmin` (guardia delle rotte), senza cicli.
 */

/**
 * Super-admin de la instancia (custom heili.cloud): una capacidad definida
 * por la variable SUPERADMIN_EMAILS (correos separados por coma). No es un rol
 * de organización. Sin la variable, nadie es super-admin.
 */
export function isSuperadminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = (process.env.SUPERADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.trim().toLowerCase());
}

/** Codice dell'errore «email non disponibile» (non dice PERCHÉ non lo è). */
export const EMAIL_UNAVAILABLE = "EMAIL_UNAVAILABLE";
export const EMAIL_UNAVAILABLE_MESSAGE = "Email non disponibile";

/**
 * 013 (revisione PR #15) — Chi è super-admin lo decide la sola email: se un
 * owner potesse creare (o invitare) un account con un'email della lista,
 * quell'account passerebbe `withSuperadmin` e potrebbe cambiare la
 * configurazione Meta di TUTTA l'istanza. Un account con un'email di
 * super-admin si crea quindi solo:
 * - nel bootstrap: l'istanza non ha ancora nessuna organizzazione (primo
 *   registro), oppure
 * - da un super-admin, dal pannello /admin (rotte `withSuperadmin`, che lo
 *   dichiarano con `runInternalSignup(fn, { bySuperadmin: true })`).
 * Tutto il resto (alta di equipo dell'owner, registro aperto con
 * ALLOW_SIGNUP, inviti) → «email non disponibile».
 */
export function superadminEmailCreationAllowed(input: {
  email: string | null | undefined;
  bySuperadmin: boolean;
  instanceEmpty: boolean;
}): boolean {
  if (!isSuperadminEmail(input.email)) return true;
  return input.bySuperadmin || input.instanceEmpty;
}

/** ¿El error de Better Auth es nuestro «email non disponibile»? */
export function isEmailUnavailableError(err: unknown): boolean {
  const body = (err as { body?: { code?: unknown } } | null)?.body;
  return body?.code === EMAIL_UNAVAILABLE;
}
