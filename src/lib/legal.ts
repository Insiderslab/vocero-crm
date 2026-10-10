/**
 * Pagine pubbliche e legali (privacy, termini, cancellazione dati).
 *
 * Tipi, dati del titolare e sostituzione dei segnaposto. Nessun accesso a
 * sessione, database o tenant: le pagine devono poterle leggere i crawler di
 * Meta senza autenticazione.
 */

export type LegalSection = {
  title: string;
  /** Paragrafi, nell'ordine. */
  body: string[];
  /** Elenco puntato opzionale, dopo i paragrafi (array vuoto = nessun elenco). */
  list: string[];
};

export type LegalDocument = {
  title: string;
  /** Meta description e sommario sotto il titolo. */
  summary: string;
  sections: LegalSection[];
};

export type LegalMessages = {
  chrome: {
    skipToContent: string;
    lastUpdated: string;
    /** Etichetta accanto alla data finche i testi non sono rivisti da un legale. */
    draftLabel: string;
    /** Avviso visibile finche i testi non sono rivisti da un legale. */
    draftNotice: string;
    nav: string;
    privacy: string;
    terms: string;
    deletion: string;
    login: string;
  };
  privacy: LegalDocument;
  terms: LegalDocument;
  deletion: LegalDocument;
};

export type LegalKind = "privacy" | "terms" | "deletion";

/** Data dell'ultima revisione dei testi (ISO). Aggiornarla a ogni modifica. */
export const LEGAL_LAST_UPDATED = "2026-10-10";

/**
 * I testi sono bozze finche l'owner non imposta LEGAL_TEXTS_REVIEWED=true
 * (dopo la revisione di un avvocato). Fail-closed: qualunque altro valore,
 * o assenza, = bozza, con avviso visibile sulle pagine.
 */
export function legalTextsReviewed(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.LEGAL_TEXTS_REVIEWED?.trim() === "true";
}

export const LEGAL_PATHS: Record<LegalKind, string> = {
  privacy: "/privacy",
  terms: "/termini",
  deletion: "/cancellazione-dati",
};

export type LegalContext = {
  product: string;
  entity: string;
  email: string;
};

/**
 * Segnaposto visibili quando l'operatore non ha ancora configurato i dati:
 * meglio un segnaposto evidente che un nome inventato.
 */
export const LEGAL_ENTITY_PLACEHOLDER = "[LEGAL_ENTITY_NAME]";
export const LEGAL_EMAIL_PLACEHOLDER = "[LEGAL_CONTACT_EMAIL]";

/** Dati del titolare, dall'ambiente (non sono segreti). */
export function legalContext(
  env: Record<string, string | undefined> = process.env
): LegalContext {
  return {
    product: "Heili CRM",
    entity: env.LEGAL_ENTITY_NAME?.trim() || LEGAL_ENTITY_PLACEHOLDER,
    email: env.LEGAL_CONTACT_EMAIL?.trim() || LEGAL_EMAIL_PLACEHOLDER,
  };
}

/** Sostituisce {{product}}, {{entity}}, {{email}}; un segnaposto ignoto resta com'è. */
export function fillLegal(text: string, ctx: LegalContext): string {
  return text.replace(/\{\{(\w+)\}\}/g, (whole, name: string) =>
    name === "product" || name === "entity" || name === "email"
      ? ctx[name]
      : whole
  );
}
