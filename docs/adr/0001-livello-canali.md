# ADR 0001 — Livello canali: un contratto unico per WhatsApp, Instagram, Messenger ed email

| | |
|---|---|
| **Stato** | **Proposto** — in attesa di approvazione dell'owner (requisito di M1.1 in `docs/piani/PIANO-CRM-MULTICANALE.md`) |
| **Data** | 2026-10-10 |
| **Autore** | Claude (orchestratore, Opus 5.5) — pacchetto M1.1, branch locale `notte/adr-canali` |
| **Guida** | M1.2 (migrazione in due tempi), M1.3 (adattatore WhatsApp), M1.6 (adattatore Instagram in modalità sviluppo) e l'ordine dei passi con Meta (K7, K3, K4) |
| **Specifica** | [`specs/005-livello-canali/`](../../specs/005-livello-canali/spec.md) — `spec.md`, `plan.md` (inventario esatto §5), `tasks.md` |
| **Base del codice letta** | `origin/claude/keen-ptolemy-l0kv8g` @ `810272a`; pacchetto C3 sul branch locale `notte/c3-wapi` @ `6146791` (letto con `git show`, non integrato); `heili-dm` @ `7ce1633` |

Valgono le Leggi di Heili (`docs/LEGGI-AI-CODING.md`) e la costituzione Speckit (`.specify/memory/constitution.md` v1.3.0). Dove questo ADR e le Leggi divergono, prevalgono le Leggi.

---

## 1. Contesto

Il CRM è nato come CRM di WhatsApp e il modello dati lo dice ovunque (verificato su `src/lib/db/schema.ts`):

- `contact.wa_identity` è `NOT NULL` e univoco per organizzazione (`schema.ts:119`, `:148`): un contatto esiste solo con un'identità WhatsApp.
- `message.wa_message_id` è la chiave di idempotenza, **univoca su tutta l'istanza** (`schema.ts:349`), non per organizzazione.
- `meta_credentials` contiene un solo numero WhatsApp per organizzazione, con il token cifrato (`schema.ts:435-460`).
- C'è un solo webhook, `/api/webhooks/wa/[webhookToken]` (`src/app/api/webhooks/wa/[webhookToken]/route.ts`), che smista tre `field` di Meta (`route.ts:71-86`).
- La finestra di 24 ore è una costante (`src/server/inbox/window.ts:8`), usata da invio, agente AI, bandeja, automazioni e API del bot.

La direzione dell'owner (`docs/visione/crm-multicanale-multicliente.md`) chiede WhatsApp, Instagram, Messenger ed email nello stesso CRM, e **nessun canale nuovo prima di questo livello**: copiare il codice WhatsApp per ogni canale violerebbe il §3.2 delle Leggi.

**Riferimento di architettura (solo idee, nessun codice): Chatwoot.** In Chatwoot un *canale* (configurazione del provider) appartiene a una *inbox*; la *conversazione* appartiene a una inbox e a un contatto; il legame contatto↔inbox (`contact_inboxes.source_id`) è l'identità del contatto in quel canale. Qui la *inbox* e il *canale* si fondono in `channel_account` (non servono ancora membri e instradamento per inbox), e l'identità diventa `contact_identity`, con un ambito diverso da Chatwoot (§3.2).

## 2. Decisione in sintesi

1. **Un contratto `ChannelAdapter`** (§3.1): ogni canale fornisce *parse* puro del webhook → eventi normalizzati, *verifica della firma*, *invio*, *capacità* dichiarate e *stato della connessione*. Il **nucleo** (contatti, conversazioni, messaggi, idempotenza, SSE, lead, agente AI, sandbox del Laboratorio, finestra di risposta) non conosce il canale: legge solo eventi normalizzati e capacità.
2. **Modello dati comune** (§3.2): `channel_account` (da `meta_credentials`), `contact_identity` (da `contact.wa_identity`), `conversation.channel_account_id`, `message.channel` + `message.external_message_id` (da `wa_message_id`). La chiave Wapi di C3 (`wapi_credentials`) resta una credenziale di *trasporto* dell'organizzazione: non si migra, e vale solo per WhatsApp.
3. **Migrazione in tre rilasci** (§3.3): *espandi* (R1: tabelle e colonne nuove, backfill, doppia scrittura, letture ancora sulle vecchie), *migra le letture* (R2), *contrai* (R3: le colonne vecchie si tolgono in un rilascio successivo). Ogni rilascio ha il suo rollback.
4. **WhatsApp è il primo adattatore e deve comportarsi in modo identico**, dimostrato da **test golden** registrati sul codice di oggi **prima** di toccarlo (§3.7).
5. **Webhook per canale**: `/api/webhooks/<canale>/[token]` con un unico gestore nel nucleo; **l'URL di WhatsApp `/api/webhooks/wa/<token>` non cambia** (è configurato in Meta e nell'`override_callback_uri` di Wapi) (§3.5).
6. **Instagram, Messenger ed email si innestano aggiungendo un adattatore e una riga di registro**, senza modificare il nucleo (§3.6). Lo dimostra in M1.3 un adattatore finto che passa la stessa suite di contratto.
7. **Ordine di lavoro con Meta corretto** (§3.8): Instagram e Messenger si sviluppano **in modalità sviluppo** dell'app Meta con account di prova, si registrano i video con la funzione **già funzionante** e **solo dopo** si chiede l'App Review. L'app «Dm Heili» di heili-dm è *Live* ma ha solo **Standard Access**: nessun permesso Instagram è stato approvato in review.
8. **L'astrazione si valida con due canali reali nella stessa fase M1** (§3.9): WhatsApp (produzione, identico) e Instagram (adattatore reale in modalità sviluppo, pacchetto nuovo M1.6). Un adattatore finto da solo non basta a dimostrare che il contratto regge un secondo provider.

---

## 3. Dettaglio della decisione

### 3.1 (a) Contratto TypeScript

File proposto: `src/server/channels/types.ts` (solo tipi, nessuna dipendenza dal DB). È il contratto che M1.3 implementa; i nomi possono cambiare solo con una nota nel registro di M1.3.

```ts
/** Canali previsti. Aggiungerne uno = nuovo valore + adattatore + migrazione del CHECK. */
export type ChannelKind = "whatsapp" | "instagram" | "messenger" | "email";

/* ------------------------------------------------------------------ */
/* Capacità: ciò che il canale PUÒ fare. Il nucleo e l'agente AI non   */
/* promettono mai una funzione che il canale non dichiara (Prima Legge).*/
/* ------------------------------------------------------------------ */

export type MediaKind =
  | "image" | "video" | "audio" | "document" | "sticker" | "location" | "contacts";

export type ChannelCapabilities = {
  /** Finestra per il testo libero dopo l'ultimo messaggio ENTRANTE. */
  replyWindow: { kind: "rolling"; ms: number } | { kind: "unbounded" };
  /** Modelli: "required_outside_window" = fuori finestra solo modelli approvati (WhatsApp). */
  templates: "none" | "required_outside_window";
  /** Allegati in entrata e in uscita, con i limiti per tipo (WhatsApp: MEDIA_LIMITS). */
  inboundMedia: readonly MediaKind[];
  outboundMedia: { kinds: readonly MediaKind[]; maxBytes: Partial<Record<MediaKind, number>> };
  /** Lunghezza massima di un messaggio di testo in uscita. */
  maxTextLength: number;
  /** "single" = un filo per contatto e account; "email" = thread (In-Reply-To/References). */
  threads: "single" | "email";
  /** Il canale notifica i messaggi inviati FUORI dal CRM (WhatsApp coexistence, eco di Instagram/Messenger). */
  echoes: boolean;
  /** Indicatore "sta scrivendo" e conferma di lettura (API del bot: /api/bot/typing). */
  typingIndicator: boolean;
  readReceipts: boolean;
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
      /** null = timestamp illeggibile: il nucleo usa l'ora di ricezione (come toDate, ingest.ts:431). */
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
  | { kind: "ignored"; channel: ChannelKind; reason: string }; // per i log: tipo non supportato, senza identità…

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
  | { kind: "location"; location: { latitude: number; longitude: number; name?: string; address?: string } }
  | { kind: "contacts"; contacts: { name: string; phone: string }[] }
  | { kind: "template"; name: string; language: string; variables: string[] };

/** Opzioni per i canali a thread (email): oggetto e riferimento al thread. */
export type OutboundEnvelope = { threadRef?: string; subject?: string };

/* ------------------------------------------------------------------ */
/* Contesti passati dal nucleo all'adattatore                          */
/* ------------------------------------------------------------------ */

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
  /** Chiamato appena il provider ha accettato l'allegato, PRIMA dell'invio (ordine di oggi, send.ts:240-244). */
  onMediaUploaded?(externalMediaId: string): Promise<void>;
};

export type ConnectionStatus = "connected" | "reconnect_required" | "expiring" | "disconnected";

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
    /** GET di verifica (Meta: hub.mode/hub.verify_token/hub.challenge). Assente = 405. */
    handshake?(query: URLSearchParams): Response;
    /**
     * Firma sul body CRUDO, PRIMA di qualsiasi parsing o scrittura.
     * Canali nuovi: obbligatoria e fail-closed (segreto mancante → false).
     * WhatsApp in M1: identico a oggi (isValidSignature, webhook.ts:27: senza META_APP_SECRET passa).
     */
    verifySignature(rawBody: string, headers: Headers): boolean;
    /**
     * PURO: niente DB, niente rete, niente orologio. Payload illeggibile → [].
     * L'ORDINE degli eventi è l'ordine di elaborazione: WhatsApp emette prima gli
     * "status" e poi i "message" di ogni change (ingest.ts:212-236).
     */
    parse(payload: unknown): InboundEvent[];
  };

  /** Invia. Errori: SEMPRE SendError con i codici di oggi (send.ts:21-28): sono un contratto HTTP. */
  send(ctx: SendContext, message: OutboundMessage, envelope?: OutboundEnvelope): Promise<{ externalMessageId: string }>;

  /** Scarica un allegato in entrata (WA: downloadGraphMedia, media.ts:141; IG: URL). */
  fetchMedia?(ctx: AccountContext, ref: { externalMediaId: string } | { url: string }): Promise<{ data: Buffer; mimeType: string }>;

  /** Conferma di lettura + "sta scrivendo" (oggi solo /api/bot/typing, route.ts:52-81). */
  markReadAndTyping?(ctx: AccountContext, lastInboundExternalId: string): Promise<void>;

  /** Stato della connessione per la pagina «Canali» (K1). Non scrive nulla. */
  checkHealth(ctx: AccountContext): Promise<ConnectionHealth>;
}
```

**Confini (cosa resta nel nucleo e non passa mai a un adattatore):**

| Regola | Dove resta | Perché |
|---|---|---|
| Sandbox del Laboratorio: `is_test` non tocca mai un provider | nucleo, prima di chiamare `adapter.send` (oggi `send.ts:74`, `templates.ts:333`) | Una guardia in ogni adattatore = una copia da dimenticare al canale successivo |
| Ordine dei controlli d'invio: esistenza+tenant → sandbox → finestra → account collegato → destinatario | nucleo (`send.ts:52-112`) | È il comportamento di oggi; i golden lo fissano |
| Finestra di risposta | nucleo, calcolata da `capabilities.replyWindow` | Oggi costante a `window.ts:8` |
| Idempotenza (`external_message_id` univoco) e stati monotòni | nucleo (`status.ts:17-23`) | Uguale per tutti i canali (Costituzione IV) |
| Risoluzione dell'organizzazione dall'account esterno | nucleo (`channel_account`) | L'adattatore non sceglie mai l'organizzazione |
| Riconciliazione delle identità fornite dal provider | nucleo, con i segnali di `ContactRef` | Unione tra canali **mai automatica** (§3.2) |
| Decifrare e passare il segreto | nucleo (`lib/crypto`) | L'adattatore non legge il DB |

### 3.2 (b) Modello dati

Nomi delle colonne in `snake_case` nel DB, `camelCase` in Drizzle. Prefissi `nanoid` nuovi in `src/lib/db/ids.ts`: `channelAccount: "cha"`, `contactIdentity: "ci"`.

**`channel_account`** — un account di canale collegato da un'organizzazione (≈ *channel + inbox* di Chatwoot).

| Colonna | Tipo | Note |
|---|---|---|
| `id` | text PK | `cha_…` |
| `organization_id` | text NOT NULL → `organization` ON DELETE CASCADE | Costituzione III |
| `channel` | text NOT NULL, CHECK in (`whatsapp`,`instagram`,`messenger`,`email`) | |
| `external_account_id` | text NOT NULL | WA `phone_number_id` · IG `user_id` dell'account professionale (quello che arriva come `entry.id` nei webhook) · ID della Pagina · indirizzo di ricezione email |
| `external_parent_id` | text NULL | WA `waba_id` (eventi dei modelli) |
| `display_name` | text NULL | WA `display_phone_number` · `@username` · nome Pagina |
| `verified_name` | text NULL | WA |
| `secret_cipher`, `secret_iv`, `secret_tag` | text NULL | token cifrato AES-256-GCM con `lib/crypto` (stesso formato di `meta_credentials.token_*`); CHECK: tutti e tre presenti o tutti assenti |
| `secret_expires_at` | timestamp NULL | Instagram: token a lunga durata (60 giorni) |
| `status` | text NOT NULL default `connected`, CHECK in (`connected`,`reconnect_required`,`expiring`,`disconnected`) | i primi due valori sono quelli di oggi |
| `config` | jsonb NULL | solo dati **non** segreti |
| `legacy_meta_credentials_id` | text NULL UNIQUE | traccia del backfill; si toglie in R3 |
| `created_at`, `updated_at` | timestamp NOT NULL default now() | |

Indici: `UNIQUE (channel, external_account_id)` — **è la guardia d'isolamento del routing**: due organizzazioni non possono rivendicare lo stesso numero/account (oggi `meta_credentials_phone_uq`, `schema.ts:458`); `UNIQUE (organization_id, channel)` — in M1 un solo account per canale e organizzazione, come `meta_credentials_org_uq` (`schema.ts:456`; allentarlo è la decisione D4); `INDEX (channel, external_parent_id)`; `UNIQUE (organization_id, id)` per le chiavi esterne composte qui sotto.

**`wapi_credentials` (pacchetto C3) — credenziale di *trasporto*, non account di canale.** Sul branch `notte/c3-wapi` (`6146791`) C3 aggiunge la tabella `wapi_credentials` (migrazione `drizzle/0011_classy_bloodstorm.sql`): una riga per organizzazione con la chiave del gateway Wapi (`hlp_live_…`) cifrata con `lib/crypto` (`key_cipher`/`key_iv`/`key_tag`), `key_last4`, `created_by`, `revoked_at`; `UNIQUE (organization_id)`. La chiave **non identifica un account di canale**: non ha `phone_number_id`, si salva anche senza numero collegato (`src/app/api/settings/whatsapp/wapi-key/route.ts:58`) e decide solo **da dove passa** una chiamata Graph (`decideGraphRoute`, `src/lib/meta/client.ts` su C3: chiave propria → Wapi; globale solo legacy con una sola organizzazione; ambiguo → bloccato; altrimenti Meta diretto). Metterla dentro `channel_account` violerebbe `external_account_id NOT NULL` per le organizzazioni con chiave e senza numero, e mescolerebbe due segreti con cicli di vita diversi (il token Meta si ricollega, la chiave Wapi si revoca).

Decisione:
- **In M1 `wapi_credentials` resta com'è** (nessuna migrazione, nessun backfill): è un *gateway* dell'organizzazione, che si applica agli account WhatsApp di quell'organizzazione. Il nucleo non la legge; la legge solo il client Graph (`resolveGraphTransport`), come in C3. Così l'instradamento Wapi resta **identico per costruzione** e la verifica avversaria di C3 non va rifatta.
- Gli adattatori dei canali Meta chiamano sempre il client Graph unico passando `organizationId`; **non** ricevono la chiave Wapi nel `AccountContext`.
- **Guardia nuova obbligatoria (M1.6):** `resolveGraphTransport` oggi devia a Wapi *ogni* chiamata con `organizationId` se l'organizzazione ha una chiave. Con Instagram una chiamata a `graph.instagram.com` finirebbe al gateway Wapi con la chiave dell'organizzazione. Il trasporto va quindi deciso **per canale**: in M1 il desvío a Wapi vale solo per `channel = "whatsapp"`; per gli altri canali `via: "meta"` sempre, finché D9 non decide altrimenti. Test negativo + sabotaggio in M1.6 (plan.md §7.4).
- **Contrazione:** nessuna in M1. Se D9 decide che Wapi diventa gateway di tutti i canali Meta, si generalizza in `channel_gateway_credential` con `channel_account.gateway_credential_id` (migrazione additiva, stesso schema in tre rilasci).
- **Prerequisito d'ordine:** C3 va integrato **prima** di generare la migrazione di M1.2 (numerazione `0011`, `_journal.json`, e modifiche di C3 a `src/lib/meta/client.ts` e `src/server/whatsapp/media.ts` che M1.3 sposta dietro l'adattatore).

**`contact_identity`** — l'identità di un contatto in un canale (≈ `contact_inboxes` di Chatwoot).

| Colonna | Tipo | Note |
|---|---|---|
| `id` | text PK | `ci_…` |
| `organization_id` | text NOT NULL → `organization` ON DELETE CASCADE | |
| `contact_id` | text NOT NULL | FK **composta** `(organization_id, contact_id)` → `contact (organization_id, id)` ON DELETE CASCADE: un'identità non può puntare a un contatto di un'altra organizzazione, nemmeno per errore del codice (richiede `UNIQUE (organization_id, id)` su `contact`) |
| `channel` | text NOT NULL, stesso CHECK | |
| `external_id` | text NOT NULL | WA: **lo stesso valore di `wa_identity`** (telefono normalizzato 521→52 o `bsuid:<id>`) · IG: IGSID · Messenger: PSID · email: indirizzo in minuscolo |
| `channel_account_id` | text NULL | FK composta `(organization_id, channel_account_id)` → `channel_account (organization_id, id)`. Valorizzata solo per gli ID con ambito di account (IGSID e PSID valgono solo per l'account che li ha visti); NULL per WhatsApp |
| `created_at` | timestamp NOT NULL default now() | |

Indici: `UNIQUE (organization_id, channel, external_id)` (richiesto dall'owner); `INDEX (organization_id, contact_id)`.

Differenza voluta rispetto a Chatwoot: lì `source_id` è univoco per inbox; qui per organizzazione e canale. Così lo stesso telefono che scrive a due numeri della stessa organizzazione è **un solo contatto**. Conseguenza documentata: lo stesso utente su due account Instagram della stessa organizzazione ha due IGSID diversi, quindi due identità, che si uniscono solo con conferma.

**`conversation.channel_account_id`** — text NULL, FK composta `(organization_id, channel_account_id)` → `channel_account (organization_id, id)` **ON DELETE NO ACTION** (non `RESTRICT`: con `RESTRICT` la cancellazione a cascata di un'organizzazione può fallire a seconda dell'ordine; con `NO ACTION` il controllo avviene a fine istruzione). Un account non si cancella: si scollega (`status = disconnected`) e la storia resta. NULL per le conversazioni del Laboratorio (`is_test`), che simulano WhatsApp: regola esplicita `canale(conv) = account?.channel ?? "whatsapp"`.

**`message.channel`** — text NOT NULL default `'whatsapp'`, CHECK. Su PostgreSQL ≥ 11 l'aggiunta con default costante non riscrive la tabella.

**`message.external_message_id`** — text NULL (i messaggi del Laboratorio e i falliti prima dell'invio non hanno ID esterno, come oggi `wa_message_id`). Indice `UNIQUE (organization_id, channel, external_message_id)`; i NULL non collidono.

> Nota d'isolamento (Legge Zero, segnalata e non corretta qui): oggi `wa_message_id` è univoco **sull'istanza** e la ingesta fa `onConflictDoNothing` su quella colonna (`ingest.ts:307`, `:395`). Se due organizzazioni ricevessero lo stesso `wamid`, il messaggio della seconda verrebbe scartato in silenzio. Con Meta è improbabile (i `wamid` sono generati dal provider e i numeri sono univoci tra organizzazioni), ma **non è verificato**. L'indice nuovo per organizzazione chiude il caso in R3, quando diventa l'arbitro del conflitto.

**Cosa NON cambia in M1:** `wapi_credentials` (vedi sopra), `contact.phone`, `contact.wa_user_id` (attributi WhatsApp usati dalla riconciliazione BSUID), `media_asset.wa_media_id` (si generalizza in M3, quando Instagram porta allegati per URL: colonna additiva `source_url`), `template.*` (i modelli sono una capacità di WhatsApp).

**Unione di identità — solo con conferma.**
- *Automatica* solo quando è il **provider** ad attestare il legame **nello stesso evento e nello stesso canale**: è il caso WhatsApp di oggi (telefono + BSUID nello stesso payload, `identity.ts:73-145`). Resta identico.
- *Tra canali, o senza prova del provider*: mai automatica. Il CRM può **proporre** ("stesso nome", "stessa email dichiarata"); un owner o admin **conferma**; l'operazione sposta le identità sul contatto che resta, riassegna conversazioni e lead dentro la stessa organizzazione, e lascia una riga di audit (tabella `contact_merge_event`, in M1.4: chi, quando, da→a). Test negativo obbligatorio in M1.4: unire contatti di due organizzazioni → rifiutato (e impossibile anche a livello DB grazie alle FK composte).
- In M1 ogni contatto ha **esattamente una** identità WhatsApp, uguale a `wa_identity`: non si aggiungono righe alias per il BSUID (aggiungerle potrebbe collidere con un secondo contatto già esistente e cambierebbe il comportamento, D5).

### 3.3 (c) Migrazione in due tempi (tre rilasci) e rollback

Lo schema segue il precedente del repo: migrazione Drizzle generata e poi **completata a mano** con backfill idempotente, come `drizzle/0001_old_sabra.sql` (identità BSUID). Le migrazioni si applicano all'avvio del container, in transazione.

**Prerequisiti (bloccanti):** C3 (`wapi_credentials`, oggi nel worktree `notte/c3-wapi`, migrazione `0011`) integrato prima di generare la migrazione di M1.2, altrimenti due `0011` e il journal di Drizzle in conflitto; backup giornaliero e ripristino provato (M0.4) prima di R3.

| Rilascio | Schema | Codice | Letture | Rollback |
|---|---|---|---|---|
| **R1 — espandi** (M1.2) | `CREATE TABLE channel_account`, `contact_identity`; `ALTER TABLE conversation ADD channel_account_id`; `ALTER TABLE message ADD channel, external_message_id`; indici; `UNIQUE (organization_id, id)` su `contact`; **backfill nella stessa migrazione** (SQL sotto) | **Doppia scrittura** in tutti i punti di scrittura (plan.md §5.9), nella stessa transazione della scrittura vecchia | **Tutte ancora sulle colonne vecchie**: comportamento identico per costruzione | Immagine precedente. Le colonne nuove sono additive e ignorate dal codice vecchio (Drizzle seleziona solo le colonne del suo schema). Le righe scritte nel frattempo dal codice vecchio restano senza colonne nuove: le recupera il backfill ripetuto in R2. Non si cancella nulla. |
| **R2 — migra le letture** (M1.3) | Migrazione che **ripete il backfill** (idempotente) e poi **verifica**: se resta anche una riga non allineata, `RAISE EXCEPTION` e il container non parte | Adattatore WhatsApp dietro il contratto; letture da `channel_account`, `contact_identity`, `external_message_id`; **doppia scrittura mantenuta** | Nuove | A R1: sicuro, perché le colonne vecchie sono ancora scritte. |
| **R3 — contrai** (rilascio successivo, dopo il periodo di prova D10) | Ripete backfill e verifica; `ALTER TABLE contact DROP wa_identity` (e indice), `message DROP wa_message_id` (e il vincolo univoco globale), `DROP TABLE meta_credentials`, `channel_account DROP legacy_meta_credentials_id`; l'indice per organizzazione diventa l'arbitro di `ON CONFLICT` | Smette di scrivere le colonne vecchie. I contratti pubblicati restano: `GET /api/bot/context?waIdentity=` si risolve su `contact_identity` (canale `whatsapp`); l'export continua a esporre il campo `waIdentity` ricavato dall'identità | Nuove | **Solo da backup** (M0.4). Per questo R3 esce solo dopo: R2 in produzione per il periodo concordato, test end-to-end dell'owner riuscito, backup verificato con un ripristino. |

**Backfill di R1 (bozza vincolante nella forma, da provare in M1.2 su PostgreSQL usa e getta):**

```sql
-- channel_account da meta_credentials: stesso cifrato (stessa ENCRYPTION_KEY, stesso formato), nessuna decifratura in SQL.
INSERT INTO "channel_account" (id, organization_id, channel, external_account_id, external_parent_id,
  display_name, verified_name, secret_cipher, secret_iv, secret_tag, status,
  legacy_meta_credentials_id, created_at, updated_at)
SELECT 'cha_' || substr(md5(mc.id), 1, 20), mc.organization_id, 'whatsapp', mc.phone_number_id, mc.waba_id,
       mc.display_phone_number, mc.verified_name, mc.token_cipher, mc.token_iv, mc.token_tag, mc.status,
       mc.id, mc.created_at, mc.updated_at
FROM "meta_credentials" mc
ON CONFLICT (legacy_meta_credentials_id) DO NOTHING;

-- contact_identity: una riga per contatto, external_id = wa_identity (1:1, nessun alias).
INSERT INTO "contact_identity" (id, organization_id, contact_id, channel, external_id, created_at)
SELECT 'ci_' || substr(md5(c.id), 1, 20), c.organization_id, c.id, 'whatsapp', c.wa_identity, c.created_at
FROM "contact" c
ON CONFLICT (organization_id, channel, external_id) DO NOTHING;

-- conversation.channel_account_id: solo conversazioni reali, solo account della STESSA organizzazione.
UPDATE "conversation" cv SET channel_account_id = ca.id
FROM "channel_account" ca
WHERE ca.organization_id = cv.organization_id AND ca.channel = 'whatsapp'
  AND cv.is_test = false AND cv.channel_account_id IS NULL;

-- message.external_message_id: copia di wa_message_id (channel ha già il default 'whatsapp').
UPDATE "message" SET external_message_id = wa_message_id
WHERE external_message_id IS NULL AND wa_message_id IS NOT NULL;
```

Gli ID del backfill sono deterministici (`md5` dell'ID d'origine, esadecimale invece dell'alfabeto base36 di `nanoid`): rieseguire il backfill non duplica nulla. Il codice nuovo usa `newId()`. Entrambi i formati sono testo univoco: nessun codice deve interpretare la forma dell'ID.

**Verifica dopo il backfill** (query in `docs/ops/rilascio-canali.md`, da scrivere in M1.2; le stesse diventano il `RAISE EXCEPTION` di R2 e R3):
1. `count(meta_credentials) = count(channel_account WHERE legacy_meta_credentials_id IS NOT NULL)`;
2. ogni contatto con `wa_identity` non NULL ha esattamente un'identità `whatsapp` con `external_id = wa_identity`, e nessun contatto con `wa_identity` NULL ha un'identità `whatsapp` (in R1 `wa_identity` è ancora NOT NULL; il caso NULL esiste solo da M1.6, vedi §3.9);
3. nessuna conversazione reale senza `channel_account_id` in un'organizzazione che ha un account WhatsApp;
4. `0` messaggi con `wa_message_id IS DISTINCT FROM external_message_id` dove `wa_message_id` non è NULL;
5. `0` righe dove l'organizzazione della conversazione e quella del suo `channel_account` differiscono (doppia sicurezza: lo impedisce già la FK composta);
6. `wapi_credentials` invariata: stesso numero di righe e stesse `(organization_id, key_last4, revoked_at)` prima e dopo (la migrazione non la tocca; il controllo prova che nessuno l'ha toccata per errore).

**Misure richieste in M1.2 (Leggi §3.4):** durata della migrazione su una copia con dati simulati di produzione (≥ 100 000 messaggi); `EXPLAIN` della risoluzione del contatto prima (`contact` per `wa_identity`) e dopo (`contact_identity`). Se l'`UPDATE` dei messaggi supera qualche secondo, si spezza a lotti in una migrazione dedicata.

**Da verificare in M1.2 (non verificato qui):** che un'immagine più vecchia, avviata su un DB che ha già la migrazione di R1 nel registro `__drizzle_migrations`, parta senza errori. È il presupposto del rollback di R1.

### 3.4 (d) Inventario dei punti da toccare

L'inventario esatto `file:riga` di tutti gli usi di `wa_identity`, `wa_message_id`, `meta_credentials`, `/api/webhooks/wa`, `src/server/inbox/*`, `src/server/whatsapp/*`, `src/server/ai/*` (e dei consumatori fuori da queste cartelle) è in **[`specs/005-livello-canali/plan.md` §5](../../specs/005-livello-canali/plan.md#5-inventario-esatto-dei-punti-del-codice)**: una sola copia, perché i numeri di riga cambiano a ogni commit (§3.2 delle Leggi). Riepilogo:

| Simbolo | Punti nel codice applicativo | Contratti pubblicati coinvolti |
|---|---|---|
| `wa_identity` | 20 righe di codice in 8 file di `src/` | `GET /api/bot/context?waIdentity=` e DTO; export contatti (`waIdentity`) |
| `wa_message_id` | 23 righe di codice in 7 file di `src/` (più i mock di sviluppo in `src/server/dev/` e `src/app/api/dev/`) | API dei mock (`waMessageId`), non pubblica |
| `meta_credentials` e funzioni di `credentials.ts` | 1 tabella, 6 funzioni esportate, 11 file chiamanti in `src/` + 1 test | nessuno (la UI mostra solo le ultime 4 cifre del token) |
| `wapi_credentials` (C3, `notte/c3-wapi`) | 1 tabella, 4 funzioni in `wapi-credentials.ts`, 2 file chiamanti (`lib/meta/client.ts`, route `wapi-key`) | `GET/PUT/DELETE /api/settings/whatsapp/wapi-key` (non cambia in M1) |
| `/api/webhooks/wa` | 1 route + 2 punti che costruiscono l'URL (+ `.env.example:33`, `tests/e2e/us1-inbox.md:74`) | **URL configurato in Meta e in Wapi: non cambia** |
| `src/server/inbox/*`, `src/server/whatsapp/*`, `src/server/ai/*` | 8 + 5 + 5 file; importati da 28 file di `src/` fuori da queste cartelle e da 12 file di test | `SendError`/`TemplateError` → codici HTTP; DTO di `serializeMessage`/`serializeConversation` (SSE e API) |

### 3.5 (e) Instradamento dei webhook per canale

- **Route unica:** `src/app/api/webhooks/[channel]/[webhookToken]/route.ts` (`force-dynamic`), che delega a `handleChannelWebhook(slug, …)` nel nucleo. La cartella statica `src/app/api/webhooks/wa/` viene rimossa in M1.3: lo slug `wa` del registro serve lo **stesso URL**, e due route per lo stesso percorso sarebbero una copia (§3.2). Slug: `wa` → WhatsApp; poi `instagram`, `messenger`, `email`. Slug sconosciuto → **404**.
- **Ordine nel gestore (uguale per ogni canale, ricalcato su `route.ts:39-69`):**
  1. slug → adattatore, altrimenti 404;
  2. token del segmento, confronto a tempo costante (`safeEqual`, `webhook.ts:9`), altrimenti **404 senza leggere il body**;
  3. body crudo; `adapter.webhook.verifySignature(raw, headers)`, altrimenti **401**;
  4. `JSON.parse` protetto: body illeggibile → **200** senza effetti (Meta riprova e poi disattiva il webhook);
  5. risposta **200 `{"received":true}`**; il lavoro va in `after()`: `parse` → per ogni evento si risolve `channel_account` con `(channel, external_account_id)` (o `external_parent_id`) → organizzazione; account sconosciuto → avviso nel log e scarto (come `ingest.ts:200-208`); poi ingesta idempotente nel nucleo.
- **GET:** `adapter.webhook.handshake` (Meta: `hub.challenge`); senza handshake → 405.
- **Token:**
  - i canali Meta (WhatsApp, Instagram, Messenger) usano `META_WEBHOOK_VERIFY_TOKEN`, come oggi;
  - l'email usa un token **per account**, salvato come hash (lo stesso schema delle chiavi `bot_api_key`): il token identifica anche l'account, quindi l'organizzazione.
- **Firma:**
  - WhatsApp in M1: identica a oggi, cioè facoltativa se `META_APP_SECRET` manca;
  - Instagram e Messenger: obbligatoria, fail-closed, con il segreto dell'app Meta (heili-dm accetta sia il segreto dell'app Facebook sia quello dell'app Instagram: `heili-dm/lib/meta/webhook.ts:13-16`);
  - email: HMAC del ricevitore con un segreto condiviso.
  - Rendere obbligatoria la firma anche per WhatsApp è la decisione D3.

### 3.6 (f) Come si innestano Instagram, Messenger ed email senza toccare il nucleo

**Aggiungere un canale = questi file, e nessun altro:**

| Passo | File |
|---|---|
| Adattatore | `src/server/channels/<canale>/adapter.ts` (+ `parse.ts`, `send.ts`) |
| Registro | una riga in `src/server/channels/registry.ts` |
| Collegamento (pacchetti K) | `src/app/api/channels/<canale>/connect/route.ts`, `…/callback/route.ts` |
| Valore del canale | migrazione additiva del `CHECK` di `channel` (e colonne additive se servono, es. `media_asset.source_url`) |
| Prove | `tests/unit/channels/<canale>/*.test.ts`: fixture + **suite di contratto comune** |

Il nucleo (`src/server/channels/core/*`, `src/server/ai/*`, gestore dei webhook) **non cambia**. In M1.3 lo dimostra un `FakeChannelAdapter` (solo nei test) che passa la stessa suite di contratto di WhatsApp: ingesta, idempotenza, stati, eco, invio, sandbox, finestra. In M1.6 lo conferma un canale **reale**, Instagram in modalità sviluppo (§3.9).

**Instagram — Business Login for Instagram (adattatore in M1.6 in modalità sviluppo; collegamento con un clic in K3; apertura ai clienti in M3.1 dopo l'App Review).** Codice letto in `heili-dm` (`claude/keen-ptolemy-l0kv8g` @ `7ce1633`):

| Pezzo di heili-dm | Riuso nel CRM | Note |
|---|---|---|
| `lib/meta/oauth.ts:15-16` endpoint (`www.instagram.com/oauth/authorize`, `api.instagram.com/oauth/access_token`) | sì | Il commento a `:10-14` spiega perché l'host vecchio non va più |
| `oauth.ts:77-88` `getAuthorizationUrl` | sì, **con scope ridotti** | Il CRM chiede solo `instagram_business_basic,instagram_business_manage_messages`. heili-dm chiede anche commenti e insights, che il CRM non usa: meno scope, App Review più semplice |
| `oauth.ts:90-120` `exchangeCodeForToken` | sì | |
| `oauth.ts:41-75` stato firmato (HMAC, 10 minuti) | sì nel principio, **rafforzato** | Lo stato lega solo `workspaceId` e l'ora. Nel CRM deve legare organizzazione + utente + un nonce in un cookie `httpOnly`; al callback si controlla che sessione, organizzazione e ruolo (owner/admin) coincidano. Senza, chi ottiene uno stato valido può far collegare a una vittima il proprio Instagram nell'organizzazione sbagliata (CSRF sul collegamento). Firma con `BETTER_AUTH_SECRET`, non `NEXTAUTH_SECRET` |
| `oauth.ts:126-155` `encryptToken`/`decryptToken` | **no** | Formato diverso (IV di 16 byte concatenato, chiave esadecimale). Il CRM usa `lib/crypto` (`encryptSecret`/`decryptSecret`, colonne separate): una sola regola di cifratura (§3.2) |
| `lib/meta/client.ts:714-745` token a lunga durata e rinnovo (`ig_exchange_token`, `ig_refresh_token`, 60 giorni) | sì | `secret_expires_at`; job giornaliero in-process (come lo scheduler delle automazioni, `src/instrumentation-node.ts:41`) che rinnova i token in scadenza; se il rinnovo fallisce → `expiring` e poi `reconnect_required` |
| `client.ts:551-560` `getUserInfo` (`/me?fields=user_id,username,…`) | sì | `external_account_id = user_id` (non `id`): è quello che arriva come `entry.id` nei webhook (`client.ts:54-58`) |
| `client.ts:747-766` `subscribeInstagramAccountToWebhooks` | sì, **solo `messages`** | heili-dm iscrive anche `comments` |
| `client.ts:344-366` `sendDirectMessage` (`POST graph.instagram.com/<IG_ID>/messages`, `recipient.id = IGSID`) | sì | `externalMessageId = message_id` |
| `client.ts:111-145` mappatura degli errori (190 → token scaduto; 4/17/368 → limite; 10/100/200 → permessi) | sì | 190 → `reconnect_required`, come `MetaApiError.isAuthError` (`src/lib/meta/client.ts:64-67`) |
| `lib/meta/webhook.ts:207-241` `parseMessageEvents` (`object = "instagram"`, `entry[].messaging[]`, `message.mid`, `is_echo`/`is_deleted`/`is_unsupported`) | sì come base di `parse` | Nel CRM `is_echo` diventa un evento `echo` (oggi heili-dm lo scarta) |
| commenti, risposte private, insights, media | **no** | Fuori dal CRM (foco verticale) |

Regole di porting:
- le chiamate passano dal client Graph unico del CRM (`src/lib/meta/client.ts`), con base URL configurabile (`graph.instagram.com`) e un mock di sviluppo. Niente `fetch` sparsi (Costituzione: «aislamiento de integraciones»);
- ogni file portato riporta l'origine (`heili-dm@7ce1633`, file e righe).

Questa è la **seconda copia** del codice Meta tra i repository: per il §3.2 delle Leggi va valutata l'estrazione in un pacchetto condiviso (decisione D7).

Capacità di Instagram (da confermare in K0 con la documentazione Meta):
- `replyWindow` 24 ore. Il tag `HUMAN_AGENT` porta la finestra a 7 giorni, ma richiede un'approvazione separata: spento finché non c'è;
- `templates: "none"`;
- `maxTextLength` 1000;
- `echoes: true`, `typingIndicator: true`, `readReceipts: true`;
- allegati in uscita **solo per URL pubblico**. Il CRM tiene i file dietro login, quindi gli allegati in uscita restano spenti finché non esiste un URL firmato a tempo (rischio K).

Vincoli di Meta da tenere presenti per Instagram (da confermare in K0; nessuna chiamata a Meta in questo pacchetto):
- **un solo URL di callback dei webhook per oggetto (`instagram`) e per app.** L'app «Dm Heili» manda già i webhook Instagram a heili-dm (`heili-dm/PROGETTO-STATO.md:65`). Il CRM non può ricevere gli stessi eventi dalla stessa app senza un inoltro da heili-dm o senza un'app diversa (§3.8, D14);
- l'accesso **Standard** copre solo gli account Instagram che hanno un ruolo sull'app (admin, sviluppatori, *Instagram tester*): un altro account riceve `code=100 Unsupported request` su ogni chiamata (`heili-dm/docs/setup.md:202-218`). È ciò che permette di sviluppare e provare **prima** della review.

**Messenger — Facebook Login for Business (sviluppo in modalità sviluppo prima della review, come Instagram; collegamento K4; apertura M3.2).**
- La Pagina scelta dà `external_account_id` = ID della Pagina, con un token di Pagina cifrato.
- I webhook arrivano con `object = "page"` e `entry[].messaging[]` (stessa forma di Instagram: il `parse` condivide un modulo `meta-messaging`).
- Invio: `POST graph.facebook.com/<PAGE_ID>/messages` con `messaging_type: "RESPONSE"`.
- Iscrizione: `/<PAGE_ID>/subscribed_apps`.
- Capacità: finestra 24 ore (i tag dei messaggi, se approvati, la estendono) e `maxTextLength` 2000.
- I nomi esatti dei permessi si confermano in K0.

**Email (K5 v1, M4).**
- `channel_account.external_account_id` = indirizzo di ricezione dedicato.
- In entrata: il ricevitore fa `POST /api/webhooks/email/<token>`, firmato HMAC.
- `external_message_id` = intestazione `Message-ID`; `threadRef` = `In-Reply-To`/`References`.
- Identità: l'indirizzo del mittente in minuscolo.
- Capacità: `replyWindow: unbounded`, `threads: "email"`, `templates: "none"`.
- In uscita: dominio del cliente verificato.
- **Blocco costituzionale:** la Costituzione II vieta oggi i servizi email (D2). Il parser MIME e il client SMTP sarebbero dipendenze nuove, da approvare (§3.3 delle Leggi). Ricevitore self-hosted o servizio esterno: decisione D8.

### 3.7 (g) Test golden: WhatsApp identico

**Principio:** il comportamento di oggi si **registra prima** di cambiare il codice (primo commit di M1.2, sul codice invariato). Dopo, ogni pacchetto deve riprodurre gli stessi file golden **senza modificarli**. Se un golden va cambiato, non è un refactor: serve una nota nel registro e l'approvazione dell'orchestratore.

**Due livelli:**
1. **Golden di comportamento con DB reale** (`tests/golden/`, comando `pnpm test:golden`). Ogni caso:
   - parte da uno schema pulito, creato con le migrazioni su un PostgreSQL usa e getta;
   - semina **due organizzazioni**, A e B, ognuna con il suo numero;
   - chiama i gestori veri (`POST`/`GET` della route, `sendText`, `sendMediaMessage`, `sendStructured`, `sendTemplate`, `runAgentTurn`), con `after()` eseguito subito, `fetch` verso Graph intercettato e `publish` spiato;
   - salva un'istantanea normalizzata: righe di `contact`, `conversation`, `message`, `media_asset`, `lead`, `meta_credentials`/`channel_account` (ID → segnaposto stabili, orari → relativi), più le richieste a Graph (percorso, metodo, body, *tipo* di bearer, mai il valore) e gli eventi SSE.
   Senza database **fallisce**, non si salta: le Leggi vietano i test saltati. Per questo è un comando separato da `pnpm test`, obbligatorio nel controllo prima di ogni commit di M1.2 e M1.3, e da aggiungere alla CI con un servizio PostgreSQL (D-CI in plan.md).
2. **Golden puro** (in `pnpm test`, dopo M1.3): fixture di payload → `whatsappAdapter.webhook.parse()` → `InboundEvent[]` atteso; più la suite di contratto comune a tutti gli adattatori.

**Fixture:** **sintetiche**, costruite dalla forma documentata da Meta e dai costruttori di `src/server/dev/wa-mock-inbound.ts`. Nessun payload reale: la Legge Zero vieta agli agenti di toccare dati reali. L'owner può fornire payload reali anonimizzati (D12).

**Casi minimi** (elenco completo e nomi dei file in plan.md §7):
- *in entrata:* testo con telefono messicano `521…` (normalizzazione); solo BSUID; telefono + BSUID con contatto preesistente (riconciliazione); duplicato (idempotenza); immagine, documento con nome file, posizione, contatti, allegato rotto; tipo non supportato; senza identità; più `entry`/`changes` nello stesso payload;
- *stati:* `sent`→`delivered`→`read`, un `delivered` tardivo dopo `read` (monotonìa), `failed` con codice;
- *eco:* testo, immagine, duplicato, senza `to` (con pausa dell'AI `manual_reply`);
- *modelli e routing:* stato del modello per WABA; `phone_number_id` sconosciuto;
- *autenticazione del webhook:* token errato → 404; firma errata → 401; body illeggibile → 200; GET di verifica (200/403/404);
- *invio:* testo, allegato, upload fallito → messaggio `failed` conservato, posizione, contatti, modello con variabili, destinatario solo BSUID, finestra chiusa, token scaduto → `reconnect_required`, Meta 5xx → `meta_unavailable`, trasporto Wapi per organizzazione (dopo C3);
- *agente AI:* risposta, finestra chiusa → handoff `ventana`, conversazione del Laboratorio senza alcuna `fetch`.

**Test negativi con due organizzazioni (obbligatori):**
- un payload per il numero di B non crea né modifica nulla in A;
- uno stato con un `wamid` di A che arriva sul numero di B non cambia il messaggio di A (oggi filtrato da `status.ts:42`);
- un invio con l'organizzazione A su una conversazione di B → rifiutato senza `fetch`;
- il backfill non assegna mai a una conversazione un account di un'altra organizzazione.

**Sabotaggio (uno per guardia, registrato nel registro di lavoro):** si inverte la guardia, almeno un golden deve diventare rosso, poi si ripristina. Guardie:
- sandbox (`is_test`);
- ordine statuses→messages;
- `normalizeMx` nell'identità;
- `onConflictDoNothing` dei messaggi;
- monotonìa degli stati;
- filtro per organizzazione in `applyStatusUpdate`;
- pausa dell'AI sull'eco;
- FK composta (inserimento di un'identità con contatto di un'altra organizzazione → errore del DB);
- `RAISE EXCEPTION` della verifica di R2.

**Più** il self-test end-to-end esistente (`pnpm test:e2e`, `scripts/e2e-selftest.mjs` contro wa-mock) verde prima e dopo, e il test end-to-end WhatsApp dell'owner prima di R3.

### 3.8 (h) Ordine di lavoro corretto con Meta

**Correzione al piano.** `docs/piani/PIANO-CRM-MULTICANALE.md` §3 dice «M3 — Instagram e Messenger (**dopo l'App Review di Meta**)» e, per K2–K4, «appena arrivano le approvazioni Meta». L'ordine è al contrario. L'App Review di Meta valuta una funzione **che già funziona**: chiede un video dimostrativo del flusso completo, girato sull'app vera con account reali, e la giustificazione di ogni permesso. `heili-dm/docs/setup.md:330-334` lo dice per esperienza: «a screencast of the full flow working, recorded on real accounts in one take». Una funzione non ancora scritta non si può filmare. Quindi:

> **si sviluppa in modalità sviluppo (o con accesso Standard) con account di prova → si prova end-to-end → si registrano i video → solo allora si chiede la review.**

L'accesso Standard lo permette: copre tutti gli account che hanno un ruolo sull'app (admin, sviluppatori, tester), senza review (`heili-dm/docs/setup.md:206`).

**L'app «Dm Heili» ha già i permessi Instagram approvati? No.** Fonti nei documenti di heili-dm (stato al 31/08/2026, confermato dal rapporto del 05/10):

| Fatto | Fonte |
|---|---|
| App «Dm Heili» (con app Instagram «Dm Heili-IG») **pubblicata (Live)** il 30/08 | `heili-dm/PROGETTO-STATO.md:25`, `:69` |
| Permessi **aggiunti** all'app: `instagram_business_basic`, `instagram_business_manage_comments`, `instagram_business_manage_messages` | `PROGETTO-STATO.md:67` |
| *Live* **non è** accesso avanzato: un'app pubblicata ha solo accesso **Standard**, valido solo per gli account con un ruolo sull'app | `heili-dm/docs/setup.md:202-218` |
| L'App Review per l'accesso avanzato **non è stata fatta**: «serve la Meta App Review… bozze pronte» | `PROGETTO-STATO.md:81`; `GUIDA-OPERATIVA.md:116` («Quando la Meta App Review passerà»); `MIGLIORIE-ROADMAP.md:55` (obiettivo di lungo termine) |
| Esistono solo **bozze** di richiesta, per il caso d'uso «commento → DM privato» | `heili-dm/META_APP_REVIEW.md:1-21` |
| Oggi ogni account cliente di heili-dm entra come **Instagram tester** (invito + accettazione) | `GUIDA-OPERATIVA.md:15-30` |
| Nessun permesso Messenger o Pagine nei documenti | `grep` di `pages_messaging` in heili-dm: zero risultati |

Conclusione: **una nuova App Review non si evita**, né per Instagram né per Messenger. Anche se l'app di heili-dm avesse avuto la review, il caso d'uso approvato sarebbe stato «risposta privata a un commento», non «inbox di un CRM». *Non verificato:* lo stato attuale nella console Meta. Gli agenti non possono accedervi, e i documenti di heili-dm risalgono al 31/08 e al 05/10. L'owner lo controlla in *Dashboard dell'app → Verifica dell'app → Autorizzazioni e funzioni* (D14).

**Vincolo che decide quale app usare.** Meta accetta **un solo URL di callback per oggetto webhook e per app**. «Dm Heili» manda già l'oggetto `instagram` a `dm.heili.cloud` (`PROGETTO-STATO.md:65`). Il CRM ha quindi tre strade (D14):
- **app nuova del CRM** in modalità sviluppo. È la proposta: la review si chiede sull'app che va in produzione, quindi conviene sviluppare subito su quella;
- **app di test** derivata da «Dm Heili», con impostazioni proprie. Da verificare in K0;
- **stessa app con inoltro da heili-dm**. Sconsigliata: lega due prodotti, e heili-dm leggerebbe messaggi destinati al CRM (Legge Zero).

Il consolidamento delle tre app esistenti resta il compito di K0.

**Sequenza:**

| # | Passo | Chi | Prerequisito |
|---|---|---|---|
| 1 | M1.2 e M1.3: WhatsApp dietro il contratto, comportamento identico | agenti | D1 |
| 2 | App Meta per lo sviluppo del CRM (D14); prodotti *Instagram API with Instagram Login* e *Messenger*; URL di privacy, termini e cancellazione dei dati (anche provvisori) | owner | — |
| 3 | Account di prova: un account Instagram professionale come *Instagram tester* (invito + accettazione); una Pagina Facebook di prova con l'owner come admin | owner | 2 |
| 4 | Ambiente di sviluppo raggiungibile in HTTPS per i webhook (**non** la produzione), con `/api/webhooks/instagram/<token>` registrato nell'app | owner | 2 |
| 5 | **M1.6** — adattatore Instagram con fixture sintetiche e mock (§3.9); nessuna chiamata a Meta da parte degli agenti | agenti | 1, D2, D13 |
| 6 | Prova end-to-end reale sull'ambiente di sviluppo: DM in arrivo, risposta dal CRM, eco dall'app Instagram, stato del token | owner | 3, 4, 5 |
| 7 | Messenger nello stesso modo: adattatore, poi prova reale con la Pagina di prova | agenti, poi owner | 6 |
| 8 | **K7** — video girati sulla funzione funzionante (un'unica ripresa per flusso), giustificazioni dei permessi, credenziali di prova per i revisori, callback di deautorizzazione e di cancellazione dei dati (K1) | agenti (testi) + owner (video) | 6, 7 |
| 9 | **Richiesta di App Review**, solo per gli scope usati: `instagram_business_basic` e `instagram_business_manage_messages` (niente commenti né insights, a differenza di heili-dm: `heili-dm/lib/meta/oauth.ts:81-82`), più i permessi Messenger confermati in K0. La Business Verification risulta fatta (piano §4) | owner | 8 |
| 10 | In attesa della review: clienti pilota gestiti come *tester* (modello A di heili-dm, accesso Standard) | owner | 6 |
| 11 | Review approvata → K3 e K4 (collegamento con un clic per qualunque account) e M3.1 e M3.2 (apertura ai clienti) | agenti | 9 |

WhatsApp segue una strada a parte (Tech Provider ed Embedded Signup v4, K2) e non blocca i passi da 2 a 11. Il piano va corretto di conseguenza (D15). Questo ADR non lo modifica: un altro pacchetto lavora in parallelo sui materiali della review (`notte/app-review`).

### 3.9 (i) Validare l'astrazione con due canali reali nella stessa fase M1

Un `FakeChannelAdapter` scritto da chi ha scritto il contratto prova soprattutto che il contratto è coerente con sé stesso. Per sapere se regge un secondo provider serve un **secondo canale reale**. Instagram è il candidato giusto: differisce da WhatsApp proprio sugli assi in cui il contratto può sbagliare.

| Asse | WhatsApp | Instagram | Cosa mette alla prova |
|---|---|---|---|
| Forma del webhook | `object: whatsapp_business_account`, `entry[].changes[]` | `object: instagram`, `entry[].messaging[]` | `parse` puro e indipendente |
| Identità | telefono o BSUID, valida per tutta l'organizzazione | IGSID, **valida solo per l'account** | `contact_identity.channel_account_id`, unione solo con conferma |
| Account che riceve | `phone_number_id` in `value.metadata` | `entry.id` = `user_id` professionale | `ExternalAccountRef` |
| Allegati in entrata | ID di media Graph, da scaricare con il bearer | URL a scadenza | `InboundMedia.ref` a due forme |
| Modelli | obbligatori fuori finestra | assenti | `capabilities.templates`, UI e agente (M1.5) |
| Eco | `smb_message_echoes` | `message.is_echo` | evento `echo` |
| Credenziale | token di sistema, `reconnect_required` su 190 | token di 60 giorni, da rinnovare | `secret_expires_at`, `checkHealth`, stato `expiring` |
| Host e trasporto | `graph.facebook.com` o Wapi (C3) | `graph.instagram.com`, **mai Wapi** | trasporto per canale (§3.2) |
| Firma | `META_APP_SECRET` facoltativa (D3) | obbligatoria, fail-closed | `verifySignature` per adattatore |

**Pacchetto nuovo M1.6 — «Adattatore Instagram in modalità sviluppo»** (Sonnet alto / verifica Opus), dopo M1.3 e in parallelo a M1.4 e M1.5. Contenuto:
- adattatore (`parse`, `verifySignature`, `handshake`, `send` testo, `fetchMedia` per URL, `checkHealth`);
- collegamento minimo via OAuth, riusando `heili-dm/lib/meta/oauth.ts` con lo stato rafforzato (§3.6), solo per owner e admin;
- riga di registro dietro un interruttore d'istanza (`CHANNELS_ENABLED`, default `whatsapp`): in produzione Instagram resta spento finché l'owner non lo accende.

Fuori da M1.6: la pagina «Canali» (K1), il job di rinnovo dei token (M3.1), gli allegati in uscita, Messenger ed email.

**Criteri «astrazione validata» (fine di M1):**
1. l'adattatore Instagram passa la **stessa suite di contratto** dell'adattatore WhatsApp e del finto;
2. `git diff --stat` di M1.6 non tocca `src/server/channels/core/*`, `src/server/ai/*` e il gestore dei webhook. Se il nucleo va cambiato, la modifica **torna in questo ADR** (revisione del contratto, approvata dall'owner) e non si nasconde dentro M1.6;
3. i golden WhatsApp restano verdi senza modifiche;
4. test negativi a due organizzazioni anche per Instagram: un evento per l'account di B non scrive in A; un IGSID uguale in A e in B produce due contatti separati; il collegamento OAuth con lo stato di A non può creare un account in B;
5. guardia del trasporto: nessuna chiamata Instagram va a `WAPI_BASE_URL`, nemmeno con la chiave Wapi dell'organizzazione presente (test negativo + sabotaggio);
6. prova end-to-end reale dell'owner riuscita in modalità sviluppo (passo 6 di §3.8), con l'esito scritto nel registro di lavoro.

Se il punto 6 non è possibile entro M1 (app o account di prova non pronti), M1 si chiude con i punti 1–5. Il registro dice esplicitamente «secondo canale validato solo con fixture, non con Meta reale». Non si dichiara validato ciò che non lo è (Prima Legge).

**Vincolo di schema per M1.6 (prima di R3).** Fino a R3 `contact.wa_identity` è `NOT NULL` e univoca per organizzazione: un contatto solo-Instagram non si può salvare. Scartato un valore finto (`ig:<IGSID>` in `wa_identity`): metterebbe un'identità Instagram nello spazio WhatsApp, e `GET /api/bot/context?waIdentity=` potrebbe restituirla. Decisione:
- M1.6 porta una migrazione **additiva per il codice nuovo**: `ALTER TABLE contact ALTER COLUMN wa_identity DROP NOT NULL`. L'indice univoco resta, e in PostgreSQL i NULL non collidono;
- il codice di R2 tratta `wa_identity` NULL come «nessuna identità WhatsApp»: `start-conversation`, il cervello esterno e l'export non lo restituiscono come stringa vuota; l'invio WhatsApp risponde `not_connected` o niente destinatario, come oggi;
- `message.wa_message_id` resta NULL per i messaggi Instagram; l'idempotenza usa l'indice `(organization_id, channel, external_message_id)` creato in R1;
- **rollback a R1 di un ambiente dove Instagram è stato acceso:** il codice di R1 presume `wa_identity` non NULL. Prima del rollback serve `SELECT count(*) FROM contact WHERE wa_identity IS NULL` = 0. Altrimenti si spengono i canali e si archiviano o si eliminano quei contatti di prova (passo scritto in `docs/ops/rilascio-canali.md`). In produzione Instagram resta spento (`CHANNELS_ENABLED=whatsapp`) **fino a R3** (D17): in produzione il rollback di R2 resta sicuro per costruzione.

---

## 4. Alternative scartate

| Alternativa | Perché no |
|---|---|
| Copiare il modulo WhatsApp per ogni canale | Viola il §3.2 delle Leggi; moltiplica i bug (caso reale: la regex UUID in 16 copie, `LEGGI-AI-CODING.md:96`) |
| Migrazione in un colpo solo (rinominare `wa_identity` in `external_id`) | Nessun rollback senza ripristino da backup; rompe il codice vecchio a metà rilascio |
| Doppia scrittura con trigger nel DB invece che nel codice | Logica nascosta fuori da TypeScript e dai test unitari; i trigger restano dopo R3 se qualcuno se ne dimentica |
| `contact_identity` univoca per account (come Chatwoot) invece che per organizzazione+canale | Lo stesso telefono su due numeri della stessa organizzazione diventerebbe due contatti; l'owner ha chiesto l'ambito per organizzazione |
| Usare `contact_identity` senza `channel_account_id` | IGSID e PSID valgono solo per l'account che li ha visti: senza l'account non si sa da dove rispondere |
| Lasciare la finestra di 24 ore come costante | L'email non ha finestra; Instagram e Messenger hanno regole proprie (tag); l'agente AI prometterebbe cose che il canale non fa |
| Unione automatica dei contatti tra canali (stesso nome o telefono dichiarato) | Legge Zero: un errore espone la conversazione di una persona a un'altra. Solo con conferma |

## 5. Conseguenze

- **Positive:** un canale nuovo costa un adattatore, non un fork; la finestra e la sandbox restano in un punto solo; isolamento tra organizzazioni rafforzato nel DB (FK composte, indice per organizzazione per gli ID esterni).
- **Negative:** tre rilasci invece di uno; per due rilasci ogni scrittura scrive due volte; `pnpm test:golden` richiede PostgreSQL nella CI.
- **Neutre:** i contratti pubblicati (`/api/bot/*`, export, URL del webhook, codici di `SendError`, eventi SSE) restano identici; il DTO dei messaggi riceve in R2 il campo **additivo** `channel`.

## 6. (j) Rischi e decisioni per l'owner

### Decisioni (servono prima dell'avvio del pacchetto indicato)

| ID | Decisione | Proposta | Serve per |
|---|---|---|---|
| **D1** | Approvare questo ADR | — | M1.2 |
| **D2** | **Emendare la costituzione.** Oggi il Principio II limita le dipendenze a WhatsApp Cloud API + LLM e **vieta i servizi email**; il Principio VIII fissa il foco su WhatsApp; la spec 001 mette Instagram fuori ambito. Il multicanale le contraddice: secondo la governance della costituzione è un bump **MAJOR** (2.0.0) | M1.2–M1.5 procedono (nessuna dipendenza esterna nuova, WhatsApp identico) con la nota nel Constitution Check di `plan.md`. Con il secondo canale reale dentro M1 (§3.9) l'emendamento va approvato **prima del merge di M1.6**, non più prima di M3 | M1.6, M3, M4 |
| **D3** | Firma dei webhook obbligatoria anche per WhatsApp (`META_APP_SECRET` richiesto in produzione, fail-closed) | Sì, in un rilascio separato **dopo** R2, così M1 resta "comportamento identico" | dopo M1.3 |
| **D4** | Più account dello stesso canale per organizzazione (due numeri WhatsApp) | No in M1 (indice `UNIQUE (organization_id, channel)`); si toglie quando serve | M1.2 |
| **D5** | Identità WhatsApp: una sola riga per contatto (= `wa_identity`), BSUID e telefono restano attributi | Sì in M1; le righe alias si valutano in M1.4 | M1.2 |
| **D6** | Granularità della conversazione: una per (contatto, account) — come Chatwoot — oppure una per contatto con tutti i canali mescolati | Una per (contatto, account): finestra, eco e destinatario dipendono dall'account. La scheda contatto (M1.4) mostra la vista unificata. L'indice univoco attuale `(organization_id, contact_id) WHERE is_test = false` diventa `(organization_id, contact_id, channel_account_id)` in R3, non prima: con il codice di prima di R1 `getOrCreateConversation` inserisce senza account (`src/server/inbox/ingest.ts:169`, `onConflictDoNothing()` senza target) e con `channel_account_id` NULL l'indice nuovo non fermerebbe i duplicati durante un rollback. Conseguenza **fino a R3**: un contatto ha al massimo una conversazione reale, quindi l'unione (M1.4) di due contatti che hanno **entrambi** una conversazione reale va rifiutata con un messaggio chiaro, senza perdere nulla. I contatti solo-Instagram di M1.6 hanno la loro conversazione e non collidono | R3, M1.4, M1.6 |
| **D7** | Codice Instagram: portarlo da heili-dm nel CRM con la nota d'origine, oppure estrarre subito un pacchetto `@heili/meta` condiviso (heili-dm, CRM, Wapi) | Portarlo ora; estrarre quando un terzo repository lo usa (Wapi «Heili Channels», D9) | M1.6 |
| **D8** | Email in entrata: ricevitore SMTP self-hosted nel compose, oppure servizio esterno | Self-hosted (Principio II); parser MIME e SMTP da approvare come dipendenze | M4.0 |
| **D9** | Wapi resta gateway del solo WhatsApp o diventa gateway di tutti i canali Meta | Aperta (`crm-multicanale-multicliente.md` §3) | M3 |
| **D10** | Periodo di prova tra i rilasci | ≥ 7 giorni tra R1→R2 e R2→R3, con un ripristino di backup riuscito prima di R3 | R2, R3 |
| **D11** | Ambito dell'univocità di `external_message_id`: organizzazione+canale (proposto) oppure account | Organizzazione+canale. Per l'email, lo stesso `Message-ID` inoltrato a due indirizzi della stessa organizzazione verrebbe salvato una volta sola: da rivalutare in M4 | M1.2 |
| **D12** | Payload reali anonimizzati per i golden | Facoltativi; senza, fixture sintetiche | M1.2 |
| **D13** | Secondo canale reale dentro M1: aggiungere il pacchetto **M1.6** (adattatore Instagram in modalità sviluppo, spento in produzione dietro `CHANNELS_ENABLED`) | Sì (§3.9): è l'unico modo di sapere in M1 se il contratto regge un secondo provider; costa un pacchetto e anticipa lavoro che M3.1 farebbe comunque. **Modifica la direzione scritta**: la visione (`docs/visione/crm-multicanale-multicliente.md` §4) dice per M1 «WhatsApp come unico adattatore». Serve l'ok esplicito dell'owner | M1.6 |
| **D14** | Quale app Meta usa il CRM per sviluppo e review: app nuova, app di test di «Dm Heili», oppure «Dm Heili» con inoltro dei webhook da heili-dm. Contestualmente: confermare nella console Meta che «Dm Heili» non ha richieste di review approvate o in corso | App nuova del CRM, la stessa che andrà in review e in produzione (un solo URL di callback per oggetto e per app, §3.8); K0 decide il consolidamento | M1.6 |
| **D15** | Correggere l'ordine in `docs/piani/PIANO-CRM-MULTICANALE.md`: M3 e K3/K4 non «dopo l'App Review», ma sviluppo in modalità sviluppo → prova reale → video → review → apertura | Sì, con un commit sul piano dopo l'approvazione di questo ADR (non fatto qui: un altro pacchetto lavora sui materiali della review) | M1.6, K7 |
| **D16** | Chi esegue la prova end-to-end con Meta reale (gli agenti non possono chiamare Meta) e su quale ambiente di sviluppo HTTPS raggiungibile da Meta | L'owner, su un ambiente di sviluppo o di staging separato dalla produzione, con account di prova | M1.6 (criterio 6) |
| **D17** | Accendere Instagram in produzione prima di R3 | No: in produzione `CHANNELS_ENABLED=whatsapp` fino a R3 (rollback di R2 sicuro senza passi manuali). Prima di R3, Instagram solo in sviluppo e staging | M1.6, R3 |

### Rischi

| Rischio | Probabilità / impatto | Mitigazione |
|---|---|---|
| Conflitto di numerazione delle migrazioni con C3 (`0011`) e con le sue modifiche a `src/lib/meta/client.ts` e `src/server/whatsapp/media.ts` | Alta / medio | M1.2 parte dopo il merge di C3 e rigenera la migrazione; M1.3 si basa su C3 |
| R3 è irreversibile senza backup | Certa / alto | M0.4 prima di R3, ripristino provato, periodo di prova (D10) |
| Il rollback di R1 dipende dal comportamento del migratore Drizzle con un registro più recente del codice | Media / medio | Prova esplicita in M1.2 su PostgreSQL usa e getta |
| `wa_message_id` univoco sull'istanza: il messaggio di un'organizzazione scartato se il `wamid` coincide con quello di un'altra | Bassa / alto (dato perso in silenzio) | Indice per organizzazione come arbitro in R3; da verificare con Meta |
| Le automazioni (`src/server/automations/engine.ts:74-170`) mandano modelli WhatsApp a contatti scelti per etichetta: dopo M3 un contatto solo-Instagram riceverebbe un modello WhatsApp | Media dopo M3 / medio | M1.5: le automazioni filtrano i contatti con identità `whatsapp` |
| L'agente AI parla di "WhatsApp" nel prompt (`src/server/ai/prompts.ts:33`) e il mock AI dipende dal prompt (`src/server/dev/ai-mock.ts`) | Certa in M1.5 / basso | Il cambio del prompt è comportamento nuovo: golden aggiornati in modo dichiarato in M1.5, non in M1.3 |
| Token Instagram a 60 giorni: senza rinnovo il canale si spegne in silenzio | Alta senza job / alto | Job di rinnovo + stato `expiring` + avviso nella pagina «Canali» (K1) |
| Due bot sullo stesso account (Clientify, heili-dm e CRM sullo stesso numero o profilo) | Media / alto (doppie risposte) | Decisione per account, già nel piano §5; la pagina «Canali» lo mostra |
| Allegati in uscita su Instagram e Messenger richiedono un URL pubblico | Certa / medio | URL firmato a tempo, oppure allegati in uscita spenti (lo dice la capacità) |
| Performance: la risoluzione del contatto passa da `contact_identity` | Bassa / basso | `EXPLAIN` prima/dopo in M1.2 (Leggi §3.4) |
| La review di Meta respinge la prima richiesta (frequente per le app che inviano DM: `heili-dm/docs/setup.md:336`) | Media / medio (settimane) | Video sulla funzione vera, scope minimi (solo messaggi), giustificazioni per permesso; nel frattempo clienti pilota come tester (accesso Standard) |
| Il CRM usa la stessa app di heili-dm e i webhook `instagram` arrivano solo a heili-dm (un callback per oggetto e per app) | Certa se si riusa l'app / alto (nessun messaggio Instagram arriva al CRM) | App propria del CRM (D14) |
| Con la chiave Wapi dell'organizzazione presente, `resolveGraphTransport` devierebbe a Wapi anche le chiamate Instagram, con la chiave del gateway verso un host sbagliato | Certa senza guardia / alto (segreto inviato al destinatario sbagliato) | Trasporto deciso per canale (§3.2), test negativo + sabotaggio in M1.6 |
| L'adattatore Instagram obbliga a cambiare il nucleo (il contratto non regge) | Media / medio | È lo scopo di M1.6 scoprirlo in M1: la modifica torna nell'ADR (§3.9, criterio 2), prima di R3 |
| Collegamento OAuth senza legame a sessione e organizzazione (lo stato di heili-dm lega solo `workspaceId` e ora) | Certa se si porta tale e quale / alto (CSRF: un Instagram altrui collegato nell'organizzazione sbagliata) | Stato rafforzato con nonce in cookie `httpOnly`, utente e ruolo verificati al callback (§3.6); test negativo con due organizzazioni |
| Codice morto trovato durante l'inventario: `getOrCreateContact` (`src/server/inbox/ingest.ts:149-161`) non ha chiamanti | — | Da togliere con un commit `refactor:` dedicato (Leggi §3.5), fuori da questo pacchetto |
