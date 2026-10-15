/**
 * 013 — Collegamento WhatsApp guidato: macchina a stati PURA della pagina
 * Configurazione → WhatsApp (nessun DB, nessun fetch). La usano il componente
 * client e i test; i dati arrivano da GET /api/settings/whatsapp/status.
 */

export type GuideConnection = {
  status: "connected" | "reconnect_required";
  /** Meta ha tolto il numero dalla coexistence (ISO), null = attiva. */
  appDisconnectedAt: string | null;
  onboardingMode: "manual" | "embedded" | "coexistence";
};

export type GuideState =
  /** Manca la configurazione Meta della piattaforma (lo fa il super-admin). */
  | "not_configured"
  /** Tutto pronto: si può collegare il numero. */
  | "ready"
  | "connected"
  /** Il token è scaduto o revocato: gli invii sono fermi. */
  | "reconnect_required"
  /** Coexistence tolta da Meta (app non aperta, telefono cambiato, partner rimosso). */
  | "app_disconnected";

/**
 * Prima si guarda la connessione che c'è (un numero collegato resta collegato
 * anche se la piattaforma perde la configurazione: la riconnessione allora
 * passa da «Avanzate»). Il taglio della coexistence ha la precedenza sul
 * token: il rimedio è ricollegare con Meta, che rinnova anche il token.
 */
export function guideState(input: {
  platformReady: boolean;
  connection: GuideConnection | null;
}): GuideState {
  const c = input.connection;
  if (c?.appDisconnectedAt) return "app_disconnected";
  if (c?.status === "reconnect_required") return "reconnect_required";
  if (c) return "connected";
  return input.platformReady ? "ready" : "not_configured";
}

export type StepStatus = "done" | "current" | "todo" | "blocked";
export type GuideSteps = { connect: StepStatus; confirm: StepStatus; test: StepStatus };

/**
 * I tre passi: (1) collega il numero, (2) conferma sul telefono (avviene
 * dentro la finestra di Meta: è fatto quando il numero risulta collegato),
 * (3) prova: fatto quando è arrivato un messaggio vero DOPO l'ultimo
 * collegamento o aggiornamento della connessione (`connectedAt`): i messaggi
 * del numero di prima, o di prima di ricollegare, non contano.
 */
export function inboundAfterConnection(lastInboundAt: string | null, connectedAt: string | null): boolean {
  if (!lastInboundAt) return false;
  if (!connectedAt) return true;
  return Date.parse(lastInboundAt) > Date.parse(connectedAt);
}

export function guideSteps(
  state: GuideState,
  lastInboundAt: string | null,
  connectedAt: string | null = null
): GuideSteps {
  switch (state) {
    case "not_configured":
      return { connect: "blocked", confirm: "todo", test: "todo" };
    case "ready":
    case "reconnect_required":
    case "app_disconnected":
      return { connect: "current", confirm: "todo", test: "todo" };
    case "connected":
      return {
        connect: "done",
        confirm: "done",
        test: inboundAfterConnection(lastInboundAt, connectedAt) ? "done" : "current",
      };
  }
}

/** «Coexistence» (app + CRM) o «API» (solo Cloud API: manuale o Embedded Signup senza app). */
export function connectionMode(mode: GuideConnection["onboardingMode"]): "coexistence" | "api" {
  return mode === "coexistence" ? "coexistence" : "api";
}

export type SignatureInfo = {
  /** La firma è obbligatoria (sempre, salvo l'ambiente di prova con i mock). */
  required: boolean;
  /** META_APP_SECRET presente nell'istanza. */
  configured: boolean;
  stats: { lastVerifiedAt: string | null; lastInvalidAt: string | null; invalidSinceBoot: number };
};

export type SignatureState = "verified" | "waiting" | "rejected" | "missing" | "test_mode";

/**
 * Stato della firma del webhook dai contatori di processo (PR #9):
 * «verificata» solo se è arrivato davvero un evento firmato valido e dopo
 * non ci sono stati rifiuti più recenti.
 */
export function signatureState(s: SignatureInfo): SignatureState {
  if (!s.configured) return s.required ? "missing" : "test_mode";
  const { lastVerifiedAt, lastInvalidAt, invalidSinceBoot } = s.stats;
  const rejectedLast =
    invalidSinceBoot > 0 &&
    (!lastVerifiedAt || (lastInvalidAt !== null && Date.parse(lastInvalidAt) > Date.parse(lastVerifiedAt)));
  if (rejectedLast) return "rejected";
  return lastVerifiedAt ? "verified" : "waiting";
}

/**
 * Come si ricollega un numero da ricollegare (o tagliato da Meta):
 * - `manual`: incollando un token nuovo in «Avanzate». Sempre così per una
 *   connessione NON in coexistence (fatta a mano o con Embedded Signup senza
 *   app): il pulsante di Meta fa solo coexistence e un clic cambierebbe la
 *   modalità del numero (es. un numero di test di Meta collegato a mano);
 * - `meta`: «Ricollega con Meta», solo per la coexistence e con la
 *   piattaforma pronta;
 * - `null`: niente da ricollegare.
 */
export function reconnectVia(input: {
  platformReady: boolean;
  connection: GuideConnection | null;
}): "meta" | "manual" | null {
  const state = guideState(input);
  if (state !== "reconnect_required" && state !== "app_disconnected") return null;
  if (input.connection?.onboardingMode !== "coexistence") return "manual";
  return input.platformReady ? "meta" : "manual";
}
