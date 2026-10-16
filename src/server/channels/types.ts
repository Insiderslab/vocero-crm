/**
 * 005-livello-canali (M1.3, T026) — Contratto dei canali (ADR 0001 §3.1).
 *
 * SOLO tipi: nessuna dipendenza dal DB né dalla rete. Il nucleo
 * (`src/server/channels/core/*`) legge solo eventi normalizzati e capacità;
 * ogni canale fornisce un `ChannelAdapter` e una riga nel registro.
 *
 * Differenze rispetto al testo dell'ADR §3.1 (registro
 * `docs/lavoro/2026-10-14-m1.3-r2.md`, «Contratto»): `webhook.expectedToken`,
 * `webhook.unavailable`, `verifySignature` sui byte crudi (PR #9),
 * `capabilities.identityScope`, `recipientFor` e l'evento `provider`
 * (coexistence 009, domanda aperta Q1). Sono tutte aggiunte: nessun nome
 * dell'ADR è cambiato.
 */

/** Canali previsti. Aggiungerne uno = nuovo valore + adattatore + migrazione del CHECK. */
export type ChannelKind = "whatsapp" | "instagram" | "messenger" | "email";

/* ------------------------------------------------------------------ */
/* Capacità: ciò che il canale PUÒ fare. Il nucleo e l'agente AI non   */
/* promettono mai una funzione che il canale non dichiara (Prima Legge).*/
/* ------------------------------------------------------------------ */

export type MediaKind =
  | "image"
  | "video"
  | "audio"
  | "document"
  | "sticker"
  | "location"
  | "contacts";

export type ChannelCapabilities = {
  /** Finestra per il testo libero dopo l'ultimo messaggio ENTRANTE. */
  replyWindow: { kind: "rolling"; ms: number } | { kind: "unbounded" };
  /** Modelli: "required_outside_window" = fuori finestra solo modelli approvati (WhatsApp). */
  templates: "none" | "required_outside_window";
  /** Allegati in entrata e in uscita, con i limiti per tipo (WhatsApp: MEDIA_LIMITS). */
  inboundMedia: readonly MediaKind[];
  outboundMedia: {
    kinds: readonly MediaKind[];
    maxBytes: Partial<Record<MediaKind, number>>;
  };
  /** Lunghezza massima di un messaggio di testo in uscita. */
  maxTextLength: number;
  /** "single" = un filo per contatto e account; "email" = thread (In-Reply-To/References). */
  threads: "single" | "email";
  /** Il canale notifica i messaggi inviati FUORI dal CRM (WhatsApp coexistence, eco di Instagram/Messenger). */
  echoes: boolean;
  /** Indicatore "sta scrivendo" e conferma di lettura (API del bot: /api/bot/typing). */
  typingIndicator: boolean;
  readReceipts: boolean;
  /**
   * (M1.3) Ambito dell'ID esterno della persona: "organization" = vale per
   * tutta l'organizzazione (WhatsApp: telefono/BSUID, `contact_identity.channel_account_id`
   * NULL); "account" = vale solo per l'account che l'ha visto (IGSID, PSID:
   * l'identità porta l'account). ADR §3.2, colonna `channel_account_id`.
   */
  identityScope: "organization" | "account";
};

/* ------------------------------------------------------------------ */
/* Eventi in entrata normalizzati (output PURO di parse)               */
/* ------------------------------------------------------------------ */

/** Come il provider identifica l'account che riceve: serve a trovare channel_account → organizzazione. */
export type ExternalAccountRef =
  | { by: "account"; externalAccountId: string } // WA phone_number_id · IG user_id · ID Pagina · indirizzo email
  | { by: "parent"; externalParentId: string }; // WA waba_id (eventi a livello WABA: stato dei modelli)

/** Identità di una persona IN QUESTO CANALE. */
export type ContactRef = {
  /** Chiave stabile nel canale → contact_identity.external_id. WA: telefono normalizzato o "bsuid:<id>". */
  externalId: string;
  /** Segnali che il PROVIDER attesta nello stesso evento (WA: telefono e BSUID). Mai dedotti. */
  phone?: string | null;
  providerUserId?: string | null;
  displayName?: string | null;
};

export type InboundMedia =
  | {
      kind: "image" | "video" | "audio" | "document" | "sticker";
      ref: { externalMediaId: string } | { url: string }; // WA: media id Graph · IG/Messenger: URL a scadenza
      mimeType: string | null;
      fileName: string | null;
      caption: string | null;
    }
  | { kind: "location" | "contacts"; payload: unknown };

export type InboundContent = {
  /** Valore di message.type. Per WhatsApp resta IDENTICO a oggi ("text", "image", …). */
  type: string;
  text: string | null;
  media: InboundMedia | null;
};

export type InboundEvent =
  | {
      kind: "message";
      channel: ChannelKind;
      account: ExternalAccountRef;
      externalMessageId: string;
      /** null = timestamp illeggibile: il nucleo usa l'ora di ricezione. */
      occurredAt: Date | null;
      from: ContactRef;
      content: InboundContent;
      threadRef?: string; // email
    }
  | {
      kind: "echo"; // inviato dal titolare FUORI dal CRM (app del telefono, app di Instagram)
      channel: ChannelKind;
      account: ExternalAccountRef;
      externalMessageId: string;
      occurredAt: Date | null;
      to: ContactRef;
      content: InboundContent;
    }
  | {
      kind: "status";
      channel: ChannelKind;
      account: ExternalAccountRef;
      externalMessageId: string;
      status: "sent" | "delivered" | "read" | "failed";
      error?: { code?: number; message?: string };
    }
  | {
      kind: "template_status"; // solo canali con capacità templates ≠ "none"
      channel: ChannelKind;
      account: ExternalAccountRef;
      event: string; // APPROVED | REJECTED | PENDING | …
      templateExternalId?: string;
      name?: string;
      language?: string;
      reason?: string | null;
    }
  | {
      /**
       * (M1.3, domanda aperta Q1) Evento del provider che il nucleo NON
       * modella (WhatsApp coexistence 009: `history`, `smb_app_state_sync`,
       * `account_update`). Il nucleo non lo interpreta: lo consegna, nello
       * stesso ordine degli altri eventi, al gestore che il registro associa
       * al canale. Payload = il `value` del provider così com'è.
       */
      kind: "provider";
      channel: ChannelKind;
      name: string;
      /** ID dell'oggetto padre dell'evento (WA: `entry.id` = WABA), se c'è. */
      parentId: string | null;
      payload: unknown;
    }
  | {
      kind: "ignored";
      channel: ChannelKind;
      /** Per i log: `unsupported_type`, `no_identity`, `no_recipient`, … */
      reason: string;
      externalMessageId?: string;
    };

/* ------------------------------------------------------------------ */
/* Messaggi in uscita normalizzati                                    */
/* ------------------------------------------------------------------ */

export type OutboundMessage =
  | { kind: "text"; text: string }
  | {
      kind: "media";
      mediaKind: "image" | "video" | "audio" | "document";
      file: { data: Buffer; mimeType: string; fileName?: string };
      caption?: string;
    }
  | {
      kind: "location";
      location: { latitude: number; longitude: number; name?: string; address?: string };
    }
  | { kind: "contacts"; contacts: { name: string; phone: string }[] }
  | { kind: "template"; name: string; language: string; variables: string[] };

/** Opzioni per i canali a thread (email): oggetto e riferimento al thread. */
export type OutboundEnvelope = { threadRef?: string; subject?: string };

/* ------------------------------------------------------------------ */
/* Contesti passati dal nucleo all'adattatore                          */
/* ------------------------------------------------------------------ */

export type ConnectionStatus =
  | "connected"
  | "reconnect_required"
  | "expiring"
  | "disconnected";

export type ChannelAccountView = {
  id: string;
  organizationId: string;
  channel: ChannelKind;
  externalAccountId: string;
  externalParentId: string | null;
  status: ConnectionStatus;
};

export type AccountContext = {
  organizationId: string;
  account: ChannelAccountView;
  /** Segreto DECIFRATO dal nucleo (lib/crypto). Mai loggato, mai restituito al client. */
  secret: string | null;
  /** Il nucleo marca l'account "reconnect_required" (oggi markReconnectRequired). */
  markReconnectRequired(): Promise<void>;
};

export type SendContext = AccountContext & {
  /** Destinatario già risolto dal nucleo (WA: telefono normalizzato, o BSUID se manca il telefono). */
  recipient: { externalId: string; phone: string | null; providerUserId: string | null };
  /** Chiamato appena il provider ha accettato l'allegato, PRIMA dell'invio (ordine di oggi). */
  onMediaUploaded?(externalMediaId: string): Promise<void>;
};

export type ConnectionHealth = {
  status: ConnectionStatus;
  expiresAt?: Date | null; // Instagram: token di 60 giorni
  detail?: string; // testo per l'utente, mai segreti
};

/* ------------------------------------------------------------------ */
/* Il contratto                                                        */
/* ------------------------------------------------------------------ */

export interface ChannelAdapter {
  readonly channel: ChannelKind;
  /** Segmento dell'URL del webhook: "wa" per WhatsApp (storico, non cambia), poi "instagram", "messenger", "email". */
  readonly webhookSlug: string;
  readonly capabilities: ChannelCapabilities;

  readonly webhook: {
    /**
     * (M1.3) Il token atteso nel segmento dell'URL (uno per canale, ADR §3.5).
     * Il NUCLEO lo confronta a tempo costante; vuoto = nessun token valido (404).
     */
    expectedToken(): string;
    /**
     * (M1.3, PR #9) Il canale non può ricevere ora (configurazione mancante):
     * risposta da dare PRIMA di leggere il body, a GET e POST. null = pronto.
     * WhatsApp: 503 senza `META_APP_SECRET` fuori dal gate dei mock.
     */
    unavailable?(): Response | null;
    /** GET di verifica (Meta: hub.mode/hub.verify_token/hub.challenge). Assente = 405. */
    handshake?(query: URLSearchParams): Response;
    /**
     * Firma sui byte CRUDI, PRIMA di qualsiasi parsing o scrittura.
     * Canali nuovi: obbligatoria e fail-closed (segreto mancante → false).
     * WhatsApp: la regola di PR #9 (obbligatoria, D3).
     */
    verifySignature(rawBody: Uint8Array | string, headers: Headers): boolean;
    /**
     * PURO: niente DB, niente rete, niente orologio. Payload illeggibile → [].
     * L'ORDINE degli eventi è l'ordine di elaborazione: WhatsApp emette prima
     * gli "status" e poi i "message" di ogni change.
     */
    parse(payload: unknown): InboundEvent[];
  };

  /**
   * (M1.3) Destinatario dell'invio a partire dall'identità del contatto in
   * questo canale. Puro. null = nessun destinatario utilizzabile (il nucleo
   * risponde `meta_error`, come oggi). Assente = `externalId` dell'identità.
   */
  recipientFor?(identity: {
    externalId: string;
    phone: string | null;
    providerUserId: string | null;
  }): string | null;

  /** Invia. Errori: SEMPRE SendError con i codici di oggi: sono un contratto HTTP. */
  send(
    ctx: SendContext,
    message: OutboundMessage,
    envelope?: OutboundEnvelope
  ): Promise<{ externalMessageId: string }>;

  /** Scarica un allegato in entrata (WA: downloadGraphMedia; IG: URL). */
  fetchMedia?(
    ctx: AccountContext,
    ref: { externalMediaId: string } | { url: string }
  ): Promise<{ data: Buffer; mimeType: string }>;

  /** Conferma di lettura + "sta scrivendo" (oggi solo /api/bot/typing). */
  markReadAndTyping?(ctx: AccountContext, lastInboundExternalId: string): Promise<void>;

  /** Stato della connessione per la pagina «Canali» (K1). Non scrive nulla. */
  checkHealth(ctx: AccountContext): Promise<ConnectionHealth>;
}
