# Registro di lavoro — 2026-10-11 — 008 «Richieste dal sito web nella posta»

**Mandato:** il modulo di contatto o di prenotazione del sito di un cliente (es. La Bambola, tour in barca in Venezuela) invia al CRM; la richiesta compare nella posta come contatto + conversazione e nella pipeline come lead, come un lead WhatsApp. Spec `specs/custom-heili/008-richieste-dal-sito.md`. **Esecutore:** Claude (subagente). **Worktree:** `/home/user/crm-web`, **branch locale:** `site-leads`, base `origin/main` @ `83c6a13`. Nessun push, nessuna PR, nessuna chiamata a Meta o a un provider AI, nessun dato reale: PostgreSQL 16 usa e getta su `127.0.0.1:5433`, basi `vocero_golden_web` e `vocero_web_e2e`.

## Commit

1. `docs(spec): 008 …` — la spec, scritta prima del codice (in italiano, come chiesto; nota: le spec 006 e 007 sono in spagnolo).
2. `feat(008): …` — chiave del sito, origini, rotta pubblica, ingesta, guardia dell'agente, interfaccia, migrazione, test unità e golden.
3. `test(e2e): …` — sezione «008-sito» di `scripts/e2e-selftest.mjs`.
4. `test(golden): …` e `test(008): …` — due casi aggiunti durante i sabotaggi (Content-Length dichiarato; chiave `vsk_` con riga di un altro ambito).
5. questo registro.

## Migrazione: numerazione provvisoria

`drizzle/0015_richieste_sito.sql` (journal `idx 15`, snapshot `0015_snapshot.json`). Il nome salta `0014` di proposito: **la PR #8 aggiunge `drizzle/0014_*`**. Dopo il merge della PR #8 questa migrazione **va rigenerata o rinumerata** (journal e snapshot di Drizzle: lo snapshot 0015 discende da 0013, non da 0014). Contenuto, solo catalogo:
- tabella nuova `site_request_config` (una riga per organizzazione, `allowed_origins text[]`);
- `contact.email` (nullable, senza default);
- `message_channel_ck` sostituito con la versione che ammette `web`, **NOT VALID**. Lo valida la fase B del runner, che ha già il passo `VALIDATE CONSTRAINT "message_channel_ck"` per nome: `scripts/migrate-channels.mjs` non cambia. Verificato: dopo il runner `convalidated = true`.

`drizzle-kit generate` dopo le modifiche: «No schema changes».

## Cosa è stato fatto

### 1. Chiave del sito e origini
- Riuso del modello delle chiavi di servizio: tabella `bot_api_key`, `scope = "site"`, prefisso `vsk_`, cabecera `X-Site-Key`, SHA-256, `last_used_at`. `API_KEY_SCOPES` ha ora `header` e `instanceEnv` (null per il sito: nessuna chiave di istanza). Una `vbk_`/`vex_` non vale sul modulo e una `vsk_` non vale su bot/export.
- **Una chiave attiva per organizzazione**: `POST /api/settings/site/key` revoca le attive e crea la nuova nella stessa transazione (creare = ruotare); `DELETE` revoca. Il testo in chiaro esce solo nella risposta del `POST` (`no-store`).
- `GET/PUT /api/settings/site`: stato (prefisso, date, mai hash né chiave), origini, URL del modulo. Origini normalizzate a `URL.origin`, niente percorso/query/`*`, deduplicate, massimo 20; una riga non valida → 422 con le righe.
- Tutte e quattro con `withAdminAuth`; nell'inventario dei ruoli; il test di comportamento dei ruoli le esegue con member → 403 senza toccare la BD.
- Interfaccia Impostazioni → «Sito web» (solo owner/admin): stato della chiave, crea/ruota/revoca con conferma, chiave mostrata una volta, origini, snippet. i18n es/en/it.

### 2. Rotta pubblica `POST /api/public/site-requests` (+ `OPTIONS`)
- Ordine dei controlli: `Content-Type` (415) → `Content-Length` dichiarato (413) → chiave (401/429, contatore dei fallimenti per IP condiviso con le altre chiavi) → origine dell'organizzazione della chiave (403 `origin_not_allowed`) → limite per IP (10/10 min per organizzazione) → lettura del body con tetto reale a 16 KiB anche senza `Content-Length` (413) → Zod `.strict()` (422) → honeypot `website` (202 identico al successo, niente scritto) → scrittura. Il limite per chiave (30/min) lo consuma l'autenticazione.
- Preflight: il browser non manda la chiave, quindi risponde 204 con le cabecere CORS solo a un'origine registrata da **qualche** organizzazione; il `POST` la ricontrolla contro l'organizzazione della chiave. Senza `Origin` (chiamata da server) il `POST` si accetta.
- Log: solo «[sito] richiesta scartata: honeypot» ed errori con il solo messaggio. Mai chiave né body (test golden che legge tutti i `console.*`).

### 3. Ingesta
- Telefono: cifre + `normalizeMx` (come alta manuale e webhook); `+`/`00` = prefisso internazionale; un numero con 0 troncale (es. `0412…`) → 422 col motivo.
- Contatto per telefono (`wa_identity` o `phone`), poi per email, sempre con `scoped()` sull'organizzazione della chiave.
- **Vincolo dell'orchestratore (arrivato durante il lavoro):** la lista di accesso dell'agente (PR #8) autorizza per `wa_identity` **o** `phone`, quindi un modulo pubblico non deve mai scrivere né sovrascrivere `phone`, `wa_identity` o `email` di un contatto **esistente**, né unire contatti. Applicato: su un contatto esistente l'unica scrittura è riattivarlo se archiviato; nome ed email diversi restano solo nel testo del messaggio. Golden dedicato: modulo con il telefono di un contatto esistente (forma 521) e nome/email diversi → `phone`, `wa_identity`, `email` e nome identici a prima, nessuna riga nuova se non il messaggio. Altri due golden: riuso per sola email senza aggiungere telefono; telefono nuovo + email esistente → messaggio al contatto dell'email, il telefono nuovo non viene scritto e non nasce un secondo contatto.
- Contatto nuovo (solo con telefono): `wa_identity = phone =` telefono normalizzato, `email`, `source = "sito"`, identità WhatsApp nella stessa transazione (`insertContactIfAbsent`). `source = "sito"` è il marcatore «telefono ed email non verificati, scritti in un modulo» (nessuna colonna nuova); il rischio residuo è scritto nella spec (§ Sicurezza).
- Solo email e nessun contatto con quell'email → **422 `phone_required`** (decisione aperta D1, sotto).
- Conversazione reale del contatto (`getOrCreateConversation`, con l'account WhatsApp come tutte: V4 = 0). Messaggio in entrata `channel = "web"`, `type = "text"`, senza ID di provider, con testo formattato (etichette nella lingua `locale` se es/en/it, altrimenti quella di default). `unread_count + 1`, `last_message_at`; **`last_inbound_at` non cambia** (finestra 24 h chiusa). SSE `message.new` + `conversation.updated`. Lead con `onLeadActivity` (prima fase aperta, evento `sistema` nella bitacora).
- `serializeMessage` aggiunge `channel: "web"` **solo** ai messaggi web: il contratto dei messaggi WhatsApp (e i golden) non cambiano. Nella posta il messaggio ha l'etichetta «Sito web»; il pannello contatto mostra l'email.

### 4. L'agente non risponde
- La rotta non chiama `maybeRunAgentTurn`.
- `runAgentTurn` cerca l'ultimo entrante **non web**: una conversazione con sole richieste web non ha turno (e nemmeno l'handoff «ventana»).
- I messaggi web non vanno al modello nemmeno quando il turno risponde a un WhatsApp della stessa conversazione (contengono email, pagina e campi del modulo).

### 5. Snippet
`src/lib/site-snippet.ts` (puro): modulo HTML + script ES5 con `fetch`, `X-Site-Key`, `pageUrl`, `locale`, campi extra `fields[chiave]`, honeypot fuori schermo, messaggio d'esito. Escape HTML e JS (non si può chiudere lo `<script>`), JS verificato con `new Function`. Con la chiave vera solo subito dopo la creazione, altrimenti un segnaposto.

## Livello canali (005)
- Nessuna identità finta in `wa_identity` (l'ADR 0001 §3.9 ha scartato `ig:<IGSID>` per lo stesso motivo): da qui il blocco D1.
- `web` è un valore solo di `message.channel` (`MESSAGE_CHANNELS = [...CHANNEL_KINDS, "web"]`); `channel_account` e `contact_identity` restano con i quattro canali.
- Dopo l'E2E: `channels_legacy_check()` V1–V6 = 0; il runner riavviato sulla stessa base: V1–V7 = 0. **Rollback**: il runner di `83c6a13` (cartella `drizzle/` senza 0015) sulla base con 0015 applicata: nessuna migrazione, V1–V7 = 0, exit 0.

## Test

- **Unità:** `tests/unit/site-requests.test.ts`, 62 casi (telefono, schema, campi vuoti, caratteri di controllo, honeypot, formattazione, origini, preflight, body a flusso, ambito `site` delle chiavi, snippet). Aggiornati: `contact-source.test.ts` (catalogo chiuso delle fonti: + `sito`, voluto), `api-keys-rate-limit.test.ts` (solo il tipo), inventario `tests/unit/helpers/route-roles.ts` (politica nuova `site-key` → `authenticateSiteKey`; `OPTIONS` pubblica con motivo).
- **Golden con PostgreSQL reale:** `tests/golden/site-requests.golden.test.ts`, 24 casi con asserzioni esplicite, senza istantanee: creazione (fonte, identità, finestra chiusa, testo, lead, bitacora, V1–V6 = 0), SSE solo in A, riuso per telefono/email con identità intatta, solo email → 422, archiviato riattivato, isolamento A/B (stesso telefono in B, `organizationId` nel body, chiave di B), chiave revocata/ruotata/inventata/di bot → 401, chiave mai nei log, CORS (preflight e POST), honeypot, limite per IP e per chiave, body (413 dichiarato e reale, 415, 422), agente acceso: nessuna chiamata al modello, nessun invio, nessun handoff, anche chiamando `runAgentTurn` a mano; con un WhatsApp + una richiesta web il modello vede solo il WhatsApp.
- **E2E** (`scripts/e2e-selftest.mjs`, sezione «008-sito», 26 controlli) contro `next dev` sulla porta 3400 con wa-mock e ai-mock, base nuova (`MIGRATIONS_DIR=./drizzle node scripts/migrate.mjs`), agente **acceso** durante la sezione. **Esito: 151/151** (125 di prima + 26). Nel log del server: nessuna «doppia scrittura … fallita», nessuna `vsk_`.

### Gate (binari diretti, niente `pnpm`)
- `tsc --noEmit`: verde · `eslint .`: verde
- `vitest run`: 66 file, **1091** test verdi (prima: 65 file, 993)
- golden con `DATABASE_URL_GOLDEN=…/vocero_golden_web`: **118/118** = 94 di prima + 24 nuovi. `git diff 83c6a13 -- tests/golden/__golden__`: **vuoto**.
- `next build`: verde (anche sullo stato finale)
- E2E: 151/151

## Sabotaggi

Metodo: script nello scratchpad (non versionato) che cambia **un** frammento, esegue i test indicati e rimette il file con `git checkout`. A fine corsa `git status` pulito. 23 sabotaggi, **tutti visti**. Due erano inizialmente invisibili e hanno portato a un test nuovo (righe 1 e 8).

| # | Sabotaggio | Test che lo vede |
|---|---|---|
| 1 | chiave accettata senza controllo dell'ambito della riga | unità: 1 rosso (*test aggiunto*: prima la `vbk_` cadeva per prefisso e il controllo non era esercitato) |
| 2 | chiave revocata accettata (senza `revoked_at`) | golden: 2 rossi |
| 3 | `POST` senza controllo dell'origine | golden: 2 rossi |
| 4 | preflight a qualunque origine | golden: 2 rossi |
| 5 | honeypot ignorato | golden: 2 rossi |
| 6 | limite per IP tolto | golden: 1 rosso |
| 7 | limite per chiave 30 → 3000 | unità 1, golden 1 |
| 8 | `Content-Length` dichiarato ignorato | golden: 1 rosso (*caso aggiunto*) |
| 9 | tetto in lettura del body tolto | golden: 1 rosso |
| 10 | ricerca del contatto senza `organization_id` | golden isolamento: 1 rosso |
| 11 | il modulo sovrascrive email e nome di un contatto esistente | golden: 3 rossi |
| 12 | `runAgentTurn` senza la guardia `web` | golden: 1 rosso |
| 13 | messaggi web mandati al modello | golden: 1 rosso |
| 14 | la richiesta apre la finestra 24 h | golden: 1 rosso |
| 15 | la rotta chiama `maybeRunAgentTurn` (guardia intatta) | golden: 2 rossi (con un WhatsApp recente il turno parte davvero) |
| 16 | 15 + 12 insieme | golden: 4 rossi |
| 17 | `PUT /api/settings/site` con `withAuth` | unità guardia dei ruoli (AST): 1 rosso |
| 18 | la chiave nel log | golden: 1 rosso |
| 19 | schema senza `.strict()` | unità 1, golden 1 |
| 20 | telefono senza `normalizeMx` | unità 2, golden 1 |
| 21 | origine confrontata senza forma canonica | unità 1, golden 1 |
| 22 | rotazione senza revocare la precedente | golden: 1 rosso |
| 23 | CHECK della migrazione senza `web` | golden: 11 rossi |

## Decisioni aperte

- **D1 — Richieste solo email (BLOCCATA, da decidere).** Senza telefono non c'è un'identità WhatsApp e `contact.wa_identity` è `NOT NULL` fino a R3. Le strade: `wa_identity` NULL (la decisione dell'ADR per M1.6, che richiede il codice di R2 e rende insicuro il rollback a R1), un'identità finta `email:…` (scartata dall'ADR), oppure aspettare il canale email (M4). Oggi: accettata se l'email è di un contatto esistente, altrimenti 422 `phone_required` col messaggio per il visitatore; lo snippet rende il telefono obbligatorio. Nessuna perdita silenziosa.
- **D2 — Valore `web` in `message.channel`.** Estensione del livello canali fuori dall'ADR («valore nuovo + adattatore»): senza adattatore perché al sito non si risponde. Da confermare; si può rinominare (es. `form`) finché non è in produzione.
- **D3 — Lead già in «Vinto»/«Perso»:** resta lì (si aggiorna solo l'attività), come per WhatsApp.
- **Corrispondenza per email:** chi conosce l'email (o il telefono) di un contatto può aggiungere un messaggio, marcato «Sito web», alla sua conversazione. Non cambia nulla del contatto né apre la finestra; è il prezzo di «trova il contatto per email». Da confermare.

## Rischi e cose non verificate

- **Numerazione della migrazione** (sopra): da rigenerare/rinumerare dopo la PR #8. Va ricontrollata anche l'interazione con `src/server/ai/allowlist.ts` della PR #8: la guardia `web` di `runAgentTurn` e il controllo della lista stanno nella stessa funzione e il merge può confliggere.
- **Interfaccia**: la pagina «Sito web», l'etichetta «Sito web» nel filo e l'email nel pannello non sono state provate con clic reali nel browser (nessun Playwright installato in questo ambiente); coperte dalla build, dall'E2E delle API e dai test puri dello snippet. Lo snippet non è stato incollato in una pagina reale su un'altra origine: CORS provato con richieste costruite a mano, non con un browser vero.
- `next start` non serve i mock: l'E2E gira su `next dev`, come nelle fasi precedenti.
- I limiti sono in memoria per processo (come il resto dell'app): con più repliche si moltiplicano.
- Doppio invio del modulo → due messaggi (stesso contatto, stessa conversazione, stesso lead). Idempotenza fuori ambito (spec).
- Il preflight rivela solo se un'origine è registrata da qualche organizzazione dell'istanza.
- La CI su GitHub non è stata eseguita (nessun push).
