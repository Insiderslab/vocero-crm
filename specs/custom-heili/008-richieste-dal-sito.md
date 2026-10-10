# Fase 8 — Richieste dal sito web nella posta (Inbox)

> Personalizzazione sul fork pubblicato su crm.heili.cloud.
> **Stato: ✅ IMPLEMENTATA (con una parte bloccata, vedi D1)** (2026-10-11),
> branch locale `site-leads` (base `origin/main` @ `83c6a13`, con la doppia
> scrittura di 005 R1).
> **Corsia: COMPLETA** — migrazione nuova `drizzle/0015_*.sql` (tabella
> `site_request_config`, colonna `contact.email`, valore `web` nel CHECK di
> `message.channel`). **Numerazione provvisoria:** la PR #8 aggiunge
> `drizzle/0014_*`; questa migrazione va rigenerata o rinumerata dopo il suo
> merge. Registro: `docs/lavoro/2026-10-11-richieste-dal-sito.md`.

**Constitution Check**: nessuna dipendenza nuova (II ✔️ — il modulo del sito
chiama il CRM, il CRM non chiama nessuno); segreti (I ✔️ — della chiave si
salva solo lo SHA-256, il testo in chiaro si mostra una volta; la chiave non
finisce mai nei log); multi-tenancy (III ✔️ — l'organizzazione si ricava
SEMPRE dalla chiave, mai dal body o dall'origine; ogni query passa da
`scoped()` o filtra `organization_id`); idempotenza (IV ⚠️ — un doppio invio
del modulo produce due messaggi nella stessa conversazione dello stesso
contatto, senza duplicare contatto né lead; vedi «Fuori ambito»); livello
canali 005 (✔️ — vedi «Livello canali»: V1–V7 restano a 0).

**Input**: richiesta dell'owner 2026-10-11 — il modulo di contatto o di
prenotazione del sito di un cliente (es. La Bambola, tour in barca in
Venezuela) deve arrivare nel CRM come contatto + conversazione, così il team e
la pipeline lo gestiscono come un lead arrivato da WhatsApp.

## Storie

### US1 — Chiave del sito per organizzazione (P1)
In Impostazioni → «Sito web», owner/admin creano la **chiave del sito**
(`vsk_…`), la ruotano o la revocano, e scrivono le origini autorizzate.

**AC**
1. Rotte `GET/PUT /api/settings/site` (stato + origini) e
   `POST/DELETE /api/settings/site/key` (crea o ruota / revoca) con
   `withAdminAuth`: 401 senza sessione, 403 a un member, prima di leggere il
   body o la base dati.
2. La chiave riusa la tabella delle chiavi di servizio (`bot_api_key`) con
   `scope = "site"` e prefisso `vsk_`: stessa generazione (32 byte casuali),
   stesso SHA-256, stesso `last_used_at`. Il testo in chiaro esce **una sola
   volta** nella risposta del `POST` (`cache-control: no-store`).
3. **Una chiave attiva per organizzazione.** `POST` revoca le chiavi attive
   del sito e ne crea una nuova nella stessa transazione (creare = ruotare).
   `DELETE` revoca la chiave attiva; ripeterlo non fa nulla.
4. Le chiavi del sito non valgono su `/api/bot/*` né su `/api/export/*`, e
   le `vbk_`/`vex_` non valgono sul modulo (ambito diverso → 401).
5. Origini autorizzate (CORS), facoltative, per organizzazione: una per riga,
   `http(s)://host[:porta]` senza percorso, query né `*`; si salvano nella
   forma canonica di `URL.origin` (minuscolo, porta di default tolta),
   senza duplicati, massimo 20. Una riga non valida → 422 con le righe.
6. Il `GET` restituisce prefisso, date di creazione e ultimo uso della chiave
   attiva (mai l'hash né il testo in chiaro), le origini e l'URL del modulo.
7. Interfaccia i18n es/en/it; la scheda si vede solo a owner/admin.

### US2 — Il sito invia una richiesta (P1)
`POST /api/public/site-requests`, header `X-Site-Key: vsk_…`, body JSON.

**AC**
1. Body (Zod, `.strict()`): `name` (1–120), `phone?` (≤ 40), `email?`
   (email valida, ≤ 254, minuscolo), `message` (1–4000), `pageUrl?` (URL
   http/https, ≤ 500), `locale?` (tag BCP 47 corto), `fields?` (oggetto
   stringa→stringa, ≤ 20 chiavi, chiave 1–40, valore ≤ 500), `website?`
   (honeypot). Almeno uno tra `phone` ed `email`, altrimenti 422.
2. Telefono: si tolgono spazi, `-`, `.`, `(`, `)`; `+` o `00` iniziale =
   prefisso internazionale; restano 7–15 cifre senza 0 iniziale; poi
   `normalizeMx` (521→52), come l'alta manuale e il webhook. Un numero
   locale (es. `0412…`) → 422 `invalid_body` con il motivo: senza prefisso
   non coinciderebbe mai con il WhatsApp della stessa persona.
3. Contatto, sempre dentro l'organizzazione della chiave:
   - con telefono: si cerca per `wa_identity` o `phone` = telefono
     normalizzato; se non c'è e c'è un'email, per `email`;
   - solo email: si cerca per `email`;
   - se non esiste e c'è il telefono: si crea con `wa_identity = phone =`
     telefono normalizzato, `email`, `source = "sito"` e la sua identità
     WhatsApp (doppia scrittura 005, come l'alta manuale);
   - **se non esiste e c'è solo l'email: 422 `phone_required`** (vedi D1);
   - un contatto esistente **non si modifica**: `phone`, `wa_identity`,
     `email`, nome e `source` restano come sono, anche se il modulo porta
     altri valori (finiscono solo nel testo del messaggio); due contatti non
     si uniscono mai. L'unica scrittura è riattivarlo se era archiviato.
     Motivo: il modulo è pubblico e non verificato, e la lista di accesso
     dell'agente (PR #8, `src/server/ai/allowlist.ts`) autorizza per
     `wa_identity` **o** `phone`: un modulo non deve poter dare un'identità
     a nessuno.
4. Conversazione: quella reale del contatto (una per contatto fino a R3,
   ADR D6), creata se manca con `getOrCreateConversation`.
5. Messaggio in entrata con `channel = "web"`, `type = "text"`,
   `wa_message_id` ed `external_message_id` NULL, testo formattato
   (titolo, nome, telefono, email, messaggio, campi, pagina) con le
   etichette nella lingua `locale` se è es/en/it, altrimenti quella di
   default dell'istanza.
6. La conversazione si segna non letta (`unread_count + 1`) e sale in cima
   (`last_message_at`); **`last_inbound_at` NON cambia**: la finestra di
   24 h di WhatsApp non si apre. Si pubblicano `message.new` e
   `conversation.updated`, gli stessi eventi SSE della posta.
7. Lead: come un messaggio in entrata (`onLeadActivity`): se il contatto non
   ha lead si crea nella prima fase aperta (con il suo evento nella
   bitacora, origine `sistema`); se ce l'ha, si aggiorna `last_activity_at`.
8. Risposta `202 { ok: true }` senza ID interni.
9. **L'agente IA non risponde**: la rotta non chiama `maybeRunAgentTurn`, e
   `runAgentTurn` ignora i messaggi `web` quando cerca l'ultimo messaggio in
   entrata (difesa in profondità: un turno già in coda, o la prossima
   modifica, non risponde per WhatsApp a una richiesta web). Una
   conversazione che ha solo messaggi web non prende nemmeno l'handoff
   «ventana». Il team risponde a mano (plantilla, telefono, email).

### US3 — Protezioni del modulo pubblico (P1)

**AC**
1. Ordine: `Content-Type` → `Content-Length` dichiarato → chiave → origine
   per l'organizzazione della chiave → limiti per chiave e per IP → lettura
   del body (≤ 16 KiB) → validazione → honeypot → scrittura. Nessuna
   scrittura prima di aver passato tutti i controlli.
2. **Chiave**: assente, sconosciuta, revocata o di un altro ambito → 401
   `unauthorized`. I fallimenti contano per IP (stesso contatore a due soglie
   delle chiavi di servizio: 401 sotto la soglia morbida, 429 sopra, 429
   senza toccare la base dati sopra la soglia dura).
3. **CORS**: il preflight `OPTIONS` risponde 204 con
   `Access-Control-Allow-Origin` = l'origine, `Allow-Methods: POST, OPTIONS`,
   `Allow-Headers: content-type, x-site-key`, `Max-Age: 600`, `Vary: Origin`
   SOLO se l'origine è autorizzata da qualche organizzazione (il preflight
   non porta la chiave: il browser non la manda). Altrimenti 403 senza
   intestazioni CORS. Il `POST` con un header `Origin` che **non** è tra le
   origini dell'organizzazione della chiave → 403 `origin_not_allowed`,
   niente scritto; se è autorizzata, la risposta porta
   `Access-Control-Allow-Origin`. Senza `Origin` (chiamata da server) si
   accetta: l'origine non è un'autenticazione.
4. **Limiti** (in memoria, come il resto dell'app): 30 richieste al minuto per
   chiave; 10 ogni 10 minuti per IP del client e organizzazione. Oltre → 429
   `rate_limited`, niente scritto.
5. **Honeypot** `website`: se ha testo, risposta identica al successo (202
   `{ ok: true }`) e niente scritto (il bot non capisce che è stato
   scartato).
6. **Body**: massimo 16 KiB (`Content-Length` dichiarato o letto a flusso) →
   413 `payload_too_large`; `Content-Type` diverso da JSON → 415.
7. **Log**: mai la chiave né il body; solo codici ed eventi («[sito]
   richiesta scartata: honeypot»).

### US4 — Snippet da incollare nel sito (P2)
La pagina «Sito web» mostra un modulo HTML e uno script `fetch` da copiare.

**AC**
1. Il modulo ha `name`, `phone` (obbligatorio, vedi D1), `email`, `message`,
   il campo honeypot `website` nascosto (fuori schermo, `tabindex=-1`,
   `autocomplete=off`) e un'area per l'esito.
2. Lo script invia JSON con `X-Site-Key`, `pageUrl = location.href` e
   `locale = document.documentElement.lang`, mostra il messaggio d'errore
   del server o «Grazie», e svuota il modulo dopo il successo.
3. Subito dopo la creazione lo snippet contiene la chiave vera; dopo, un
   segnaposto `vsk_LA_TUA_CHIAVE` (la chiave non si può rileggere).
4. Lo snippet ricorda di aggiungere l'origine del sito tra quelle
   autorizzate.

## Sicurezza

- **La chiave è pubblicata** nell'HTML del sito: non è un segreto forte. Chi
  la copia può inviare richieste da un server (senza `Origin`). Difese:
  limiti per chiave e per IP, honeypot, tetto del body, nessun effetto
  verso l'esterno (niente WhatsApp, niente IA, niente email), rotazione in
  un clic. Della chiave si salva solo lo SHA-256.
- **Telefono ed email non verificati.** Un contatto creato dal modulo ha
  `source = "sito"`: è il marcatore (senza colonne nuove) che telefono ed
  email li ha scritti un visitante. Il telefono diventa `wa_identity` come
  nell'alta manuale: se poi quella persona scrive su WhatsApp, Meta ne
  verifica il numero e il contatto è lo stesso. Rischio residuo,
  documentato: se un owner mette in lista di accesso (007) un numero che
  esiste **solo** come contatto creato dal modulo, l'autorizzazione vale
  comunque solo per i messaggi WhatsApp che arrivano da quel numero (il
  modulo non invia nulla per WhatsApp e non fa partire l'agente).
- **Contatti esistenti intoccabili** (US2 AC3): il modulo non cambia
  identità, email o nome, e non unisce contatti. Chi conosce il telefono o
  l'email di un contatto può solo aggiungere un messaggio (marcato «Sito
  web») alla sua conversazione: il team lo vede come richiesta web.
- **Isolamento**: l'organizzazione viene solo dalla chiave; le ricerche del
  contatto filtrano per `organization_id`; il preflight non rivela altro che
  «questa origine è registrata da qualcuno».
- **Log**: mai la chiave, mai il body.

## Livello canali (005) — come si rappresenta una richiesta web

- **Messaggio**: `message.channel` ha un valore nuovo, `web`. Solo il
  messaggio: `channel_account` e `contact_identity` restano con i quattro
  canali dell'ADR (un modulo web non è un account né un'identità).
  `MESSAGE_CHANNELS = [...CHANNEL_KINDS, "web"]` in `schema.ts`. La
  migrazione sostituisce `message_channel_ck` con la versione allargata
  **NOT VALID** (solo catalogo, come `0013`); la fase B del runner la valida
  già oggi per nome (`VALIDATE CONSTRAINT "message_channel_ck"`), senza
  toccare `scripts/migrate-channels.mjs`.
- **Contatto**: solo con telefono. `wa_identity` = telefono normalizzato,
  come l'alta manuale (`POST /api/contacts`): è l'identità WhatsApp vera di
  quella persona se ha WhatsApp, e se poi scrive su WhatsApp il webhook trova
  lo stesso contatto. Identità WhatsApp scritta nella stessa transazione
  (`insertContactIfAbsent`) → V3 = 0.
- **Conversazione**: quella reale del contatto, con l'account WhatsApp
  dell'organizzazione come ogni conversazione reale (V4 = 0).
- **Nessuna** identità finta in `wa_identity` (`email:…`): l'ADR 0001 (§3.9,
  vincolo di schema per M1.6) ha scartato proprio questa forma per
  Instagram.
- V1/V2 (account), V5 (`wa_message_id` NULL → nessun controllo), V6
  (isolamento) e V7 (Wapi) non sono toccati.
- Rollback a `83c6a13`: il codice vecchio scrive solo `whatsapp` (CHECK più
  largo: compatibile), ignora `contact.email` e `site_request_config`, e
  legge i messaggi web come testo normale.

## Decisioni aperte

- **D1 — Richieste solo email (BLOCCATA).** Un contatto che non ha telefono
  non ha un'identità WhatsApp, e fino a R3 `contact.wa_identity` è
  `NOT NULL`. Le strade: (a) `wa_identity` NULL (la decisione dell'ADR per
  M1.6, che richiede il codice di R2 e rende insicuro il rollback a R1);
  (b) un'identità finta `email:…` (scartata dall'ADR); (c) aspettare il
  canale email (M4) e salvare un'identità `email`. Fino alla decisione,
  una richiesta solo email **si accetta se l'email è di un contatto
  esistente**, altrimenti 422 `phone_required` con un messaggio chiaro
  (il sito lo mostra, nessuna perdita silenziosa). Lo snippet rende il
  telefono obbligatorio.
- **D2 — Valore `web` in `message.channel`.** È un'estensione del livello
  canali fuori dall'ADR (che prevede «valore nuovo + adattatore»): qui non
  c'è adattatore perché il web non riceve risposte. Da confermare
  dall'orchestratore/owner; alternativa: un canale `form` o un tipo di
  messaggio, con le stesse garanzie.
- **D3 — Fase della pipeline**: un lead già in «Vinto»/«Perso» resta lì
  (si aggiorna solo l'attività), come per WhatsApp. Riaprirlo è una
  decisione di prodotto.

## Fuori ambito
- Risposte automatiche per email al visitatore (Costituzione II: niente
  servizi email in v1).
- Idempotenza del doppio invio (servirebbe una chiave d'idempotenza nel body
  e l'indice `message_org_channel_ext_uq` come arbitro, creato in fase B:
  non garantito in R1 «avvisa»).
- CAPTCHA (servizio esterno, Costituzione II).
- Allegati dal modulo.

## Test
- Unità: validazione del body, normalizzazione del telefono e delle origini,
  formattazione del messaggio, snippet, ambito `site` delle chiavi.
- Golden (PostgreSQL reale, file nuovo con asserzioni esplicite, nessuna
  istantanea nuova): crea vs riusa il contatto, isolamento tra A e B, chiave
  revocata → 401, CORS, honeypot, limiti, nessun turno dell'agente (anche con
  l'agente acceso e la finestra aperta), V1–V6 = 0 dopo le scritture.
- Inventario dei ruoli: politica nuova `site-key` (`authenticateSiteKey`),
  `OPTIONS` pubblica.
- E2E (`scripts/e2e-selftest.mjs`, sezione «008-sito»).
- Sabotaggi: una per guardia.
