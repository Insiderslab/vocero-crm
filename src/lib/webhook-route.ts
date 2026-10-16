/**
 * 014 — Guardia del webhook: dove manda Meta gli eventi WhatsApp di questo
 * numero? Logica PURA (nessun fetch, nessun DB), condivisa da server e client.
 *
 * Meta risponde a `GET {phone-number-id}?fields=webhook_configuration` con
 * fino a tre indirizzi: `phone_number` (override sul numero),
 * `whatsapp_business_account` (override sul WABA) e `application` (il
 * callback dell'app). Vince il più specifico. Se non è il CRM, i messaggi
 * vanno altrove (caso reale del 16/10: un flusso n8n con «WhatsApp Trigger»
 * si era iscritto al posto del CRM e nessuno se n'era accorto).
 *
 * Mai segreti verso il client: dell'indirizzo estraneo si espone solo
 * l'host (il percorso può contenere il token di un altro sistema), del
 * nostro mai il token.
 */

export type WebhookRouteLevel = "phone_number" | "whatsapp_business_account" | "application";

export type WebhookRouteState =
  /** Meta manda gli eventi al CRM. */
  | "ok"
  /** Il callback dell'APP è un altro sistema: si ripristina dal CRM (super-admin). */
  | "elsewhere"
  /** Un override sul WABA o sul numero manda gli eventi altrove: si toglie su Meta. */
  | "override"
  /** Meta non ha nessun indirizzo per questo numero. */
  | "missing"
  /** Non verificabile (Meta non risponde, gateway Wapi, risposta senza il campo). */
  | "unknown";

export type WebhookRouteCheck = {
  state: WebhookRouteState;
  /** Livello dell'indirizzo che vince (null se nessuno o non verificabile). */
  level: WebhookRouteLevel | null;
  /** Solo l'host dell'indirizzo estraneo (es. «insiderslab.app.n8n.cloud»). */
  foreignHost: string | null;
  /** L'indirizzo estraneo è sul nostro stesso host (token vecchio o percorso diverso). */
  sameHost: boolean;
  /** Perché «unknown» (per il testo e i log). */
  reason: "meta_error" | "wapi_gateway" | "no_field" | null;
  checkedAt: string;
};

export type WebhookConfiguration = Partial<Record<WebhookRouteLevel, string>>;

/** L'indirizzo che Meta deve chiamare: `<APP_BASE_URL>/api/webhooks/wa/<token>`. */
export function expectedWebhookUrl(appBaseUrl: string, verifyToken: string): string {
  return `${appBaseUrl.replace(/\/+$/, "")}/api/webhooks/wa/${verifyToken}`;
}

function normalize(url: string): string | null {
  try {
    const u = new URL(url.trim());
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url.trim()).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Classifica la `webhook_configuration` di Meta rispetto all'indirizzo atteso.
 * `undefined` (campo assente nella risposta) → «unknown», non un allarme.
 */
export function classifyWebhookRoute(
  config: WebhookConfiguration | null | undefined,
  expectedUrl: string,
  now: Date = new Date()
): WebhookRouteCheck {
  const base = { foreignHost: null, sameHost: false, reason: null, checkedAt: now.toISOString() };
  if (config === undefined || config === null || typeof config !== "object") {
    return { ...base, state: "unknown", level: null, reason: "no_field" };
  }
  const order: WebhookRouteLevel[] = ["phone_number", "whatsapp_business_account", "application"];
  const level = order.find((l) => typeof config[l] === "string" && config[l]!.trim() !== "") ?? null;
  if (!level) return { ...base, state: "missing", level: null };
  const effective = config[level]!;
  const expected = normalize(expectedUrl);
  if (expected !== null && normalize(effective) === expected) {
    return { ...base, state: "ok", level };
  }
  const foreignHost = hostOf(effective);
  return {
    ...base,
    state: level === "application" ? "elsewhere" : "override",
    level,
    foreignHost,
    sameHost: foreignHost !== null && foreignHost === hostOf(expectedUrl),
  };
}

/** Stati che meritano l'avviso rosso. */
export function webhookRouteAlarming(check: WebhookRouteCheck | null | undefined): boolean {
  return check?.state === "elsewhere" || check?.state === "override" || check?.state === "missing";
}

/** Sotto questa media non si parla di silenzio «strano»: poco traffico è normale. */
export const QUIET_MIN_PER_DAY = 3;
/** Ore senza messaggi in entrata prima dell'avviso. */
export const QUIET_HOURS = 24;

/**
 * Silenzio insolito: il numero di solito riceve (media degli ultimi 14 giorni
 * ≥ QUIET_MIN_PER_DAY al giorno) e da almeno QUIET_HOURS ore non arriva
 * niente. Un numero nuovo o poco usato non fa mai scattare l'avviso.
 */
export function isUnusuallyQuiet(input: {
  lastInboundAt: string | null;
  /** Messaggi in entrata negli ultimi 14 giorni. */
  inbound14d: number;
  now?: number;
}): boolean {
  if (!input.lastInboundAt) return false;
  if (input.inbound14d / 14 < QUIET_MIN_PER_DAY) return false;
  const last = Date.parse(input.lastInboundAt);
  if (Number.isNaN(last)) return false;
  const now = input.now ?? Date.now();
  return now - last >= QUIET_HOURS * 3_600_000;
}

/** Risposta di GET /api/settings/whatsapp/route-check. */
export type WebhookRouteCheckResponse = {
  /** null: l'organizzazione non ha un numero collegato. */
  route: WebhookRouteCheck | null;
  /** Il numero di solito riceve e da ore non arriva niente. */
  quiet: boolean;
  lastInboundAt: string | null;
  /** Chi guarda è super-admin: può rimettere il CRM come callback dell'app. */
  canRestore: boolean;
};
