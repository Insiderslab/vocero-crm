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

## Aggiornamento — rebase dopo il merge della PR #8 (`origin/main` = `0bc731e`)

- `site-leads` ribasato su `0bc731e` (rebase pulito, due conflitti risolti a mano):
  - `drizzle/meta/_journal.json`: preso quello di `main`, tolta la mia 0015 e **rigenerata** con `drizzle-kit generate --name richieste_sito` → `0015_richieste_sito`, `idx 15`; `0015_snapshot.json.prevId` = id dello snapshot 0014 (catena verificata). L'SQL generato contiene solo le mie istruzioni; poi riapplicati a mano `SET LOCAL lock_timeout`, i commenti e lo scambio NOT VALID del CHECK. Un secondo `drizzle-kit generate`: «No schema changes».
  - `scripts/e2e-selftest.mjs`: tenute entrambe le sezioni (007 e 008-sito), nell'ordine 007 → 008 → 009.
  - `src/server/ai/pipeline.ts`: unione automatica; controllate entrambe le guardie: prima la lista di accesso (007, prima di leggere lo storico), poi l'ultimo entrante **non web**, e i messaggi web fuori dal contesto del modello.
- Nuovo golden: accesso riservato attivo con risposta per gli esterni + richiesta web + `runAgentTurn` forzato → nessuna chiamata IA, nessun invio Graph, nessun messaggio in uscita (la risposta fissa partirebbe solo con la finestra aperta, cioè dopo un WhatsApp vero).
- Gate rifatti: `tsc` e `eslint` verdi; unità **1167/1167** (68 file); golden su base nuova `vocero_golden_web2` **132/132** (107 di `main` + 25 di 008), `git diff origin/main -- tests/golden/__golden__` vuoto; `next build` verde; E2E su base nuova `vocero_web_e2e2` (con `SUPERADMIN_EMAILS` per la sezione 007) **193/193**, poi V1–V6 = 0 e, al riavvio del runner, V1–V7 = 0; nessuna «doppia scrittura … fallita» e nessuna `vsk_` nel log.
- Sabotaggi dopo il rebase: `runAgentTurn` senza `isAllowedIdentity` → golden 007: 4 rossi; `runAgentTurn` senza la guardia `web` → golden 008: 1 rosso. Ripristinati, albero pulito.

## Aggiornamento — correzioni della revisione avversaria della PR #10

Base: `feat/008-richieste-dal-sito` = `site-leads` @ `d3f29d2`. Un commit per correzione, niente push.

| # | Rilievo | Correzione | Test nuovi | Sabotaggio (poi ripristinato) |
|---|---|---|---|---|
| 1 | ALTO: una IP con la chiave pubblica esauriva il limite per chiave dell'organizzazione (consumato in `authenticateApiKey` prima di origine e limite per IP) | `authenticateApiKey(..., { consumeOrgLimit: false })` per il sito; la rotta consuma il limite della chiave dopo origine (403) e limite per IP (`consumeSiteKeyLimit`) | golden: 40 richieste con origine estranea + 35 da una IP già limitata → un visitatore legittimo riceve 202 | autenticazione che consuma di nuovo: golden 2 rossi, unità 1 |
| 2 | Un modulo registra il telefono di un altro con un nome inventato, che resta quando quella persona scrive su WhatsApp | per un contatto `source = sito` **senza alcun entrante WhatsApp**, il primo entrante in vivo (`ingestInboundMessage`, `verifiedInbound`) mette il nome verificato: rubrica → profilo → telefono, una sola volta. L'email resta; nel pannello «dal modulo web, non verificata» (es/en/it) | golden P1 (nome iniettato → «Ana Golden»; dopo, il nome dell'operatore si rispetta), rubrica che vince, contatto non `sito` invariato | `verifiedInbound: false`: golden 2 rossi; senza «una sola volta»: golden 1 rosso |
| 3 | Nome e chiavi su più righe, caratteri invisibili | `sanitizeSingleLine` (nome, chiavi, telefono, email, URL, locale) e `sanitizeMultiLine` (messaggio, valori): via bidi U+202A–202E/U+2066–2069, larghezza zero U+200B–200D/U+FEFF, C0/C1; `\r\n`, tab, U+2028/2029 → spazio (una riga) o `\n` | unità: 7 casi | senza i separatori di riga: unità 1 rosso; senza i bidi: unità 5 rossi |
| 4 | Visitatori rifiutati per metadati facoltativi; testo Zod al visitatore | `locale` non valido scartato (`en_US` → `en-US`); `pageUrl` senza query e poi troncata, o scartata se non http(s); lo snippet manda ogni `name` sconosciuto in `fields` (i file no); 422 con testo i18n nella lingua della richiesta (`locale`, poi `Accept-Language`) | unità 5 (lo snippet si esegue con un DOM minimo e il body catturato passa lo schema), golden 1 | locale non scartato: unità 1 rosso; testo Zod restituito: golden 1 rosso |
| 5 | Le richieste web spingevano fuori la cronologia WhatsApp (LIMIT 20 prima del filtro) | `ne(channel, 'web')` nella query, prima del LIMIT; il filtro in memoria resta come seconda barriera | golden: 1 WhatsApp + 25 richieste web → il modello riceve il testo WhatsApp e nessun `WEB-` | senza `ne()`: golden 1 rosso |
| 6 | Preflight: limite prima dell'origine; mappe in memoria senza tetto | cache dell'origine 30 s (tetto 1 000, svuotata quando si salvano le origini); il limite del preflight conta solo le consultazioni alla BD. `lib/rate-limit`: tetto 50 000 chiavi, espulsione O(1) della meno recente (ogni uso reinserisce la chiave) | golden: una IP che inventa origini arriva a 429 ma l'origine vera (in cache) resta 204; unità: tetto e cache | limite prima della cache: golden 1 rosso; senza tetto: unità 1; senza svuotare la cache: golden 2 |
| 7 | `/api/export/messages` senza canale | campo `channel` nel JSON e colonna `canal` nel CSV. **Nessun golden esistente cambia** (l'export non ha istantanea) | golden: json e csv con `web` e `whatsapp` | campo tolto: golden 1 rosso |
| 8 | Rotazioni concorrenti → due chiavi attive | indice univoco parziale `bot_api_key_site_active_uq` (`scope='site' AND revoked_at IS NULL`) nella 0015 + `pg_advisory_xact_lock` per organizzazione in rotazione/revoca. La 0015 è stata **rigenerata** con `drizzle-kit generate`: `prevId` = snapshot 0014, un secondo `generate` dice «No schema changes» | golden: 6 rotazioni in parallelo → 1 attiva e solo l'ultima funziona; un INSERT di una seconda attiva fallisce sull'indice | senza lock: golden 1 rosso; senza indice: golden 1 rosso |
| 9 | Documentazione | spec: note di rollback (il codice vecchio manda al modello il testo web e mostra le richieste come WhatsApp; **prima del rollback revocare la chiave del sito**, con la query), riattivazione degli archiviati, avvertenza CDN/`X-Forwarded-For` | — | — |

Nota di metodo: durante il sabotaggio della correzione 1 un `git checkout` ha ripristinato anche le modifiche non ancora committate di `auth.ts`; rifatte e verificate prima del commit. Da lì in poi ogni sabotaggio è partito da un albero già committato.

### Gate dopo le correzioni
- `tsc --noEmit` e `eslint .`: verdi
- unità: **1179/1179** (68 file)
- golden su base nuova `vocero_golden_web3`: **142/142** (107 di `main` + 35 di 008); `git diff origin/main -- tests/golden/__golden__` vuoto
- `next build`: verde
- E2E su base nuova `vocero_web_e2e3`: **193/193**; dopo: V1–V6 = 0; runner riavviato: V1–V7 = 0; nessuna «doppia scrittura … fallita» e nessuna `vsk_` nel log

### Rischi rimasti
- Il nome verificato sostituisce anche un nome messo dall'operatore **prima** del primo WhatsApp di un contatto `sito` (scelta voluta: il nome del modulo non è affidabile).
- Il limite per IP vale solo dietro un proxy che riscrive `X-Forwarded-For` (spec, US3 AC4).
- La cache del preflight è per processo: con più repliche un cambio di origini si vede negli altri processi entro 30 s.
