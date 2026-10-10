# Registro di lavoro — 2026-10-10 — M1.2, fase 1 «Preparazione» (golden di WhatsApp)

**Mandato:** `specs/005-livello-canali/tasks.md`, compiti T001–T007 (fase 1 di M1.2), con ADR 0001 approvato dall'owner il 10/10/2026. **Esecutore:** Claude (subagente dell'orchestratore). **Worktree:** `/home/user/crm-m1`, **branch locale:** `m1-golden`, base `origin/main` @ `126d20a` (PR #4 coexistence e PR #5 già dentro). Nessun push, nessuna PR, nessuna chiamata a Meta, a Wapi o a un provider AI, nessun dato reale.

## In breve

- Il comportamento di WhatsApp **di oggi** è fissato in 77 casi golden, in 9 file, eseguiti con un PostgreSQL vero e con le funzioni vere del CRM. Sono stati registrati sul codice **non modificato**: in questa fase `src/` non è stato toccato.
- Comando nuovo: `pnpm test:golden` (`vitest.golden.config.ts`). Senza `DATABASE_URL_GOLDEN` fallisce con un messaggio chiaro, non si salta.
- La CI ha un servizio `postgres:16` e il passo `test:golden`.
- Sabotaggi: ogni guardia elencata in T007, invertita, fa diventare rosso almeno un golden (tabella sotto).

## Cosa cambia rispetto al piano (da sapere per la fase 2)

1. **Numero della migrazione.** `main` contiene già `drizzle/0012_quiet_warpath.sql` (coexistence, PR #4: `wa_address_book_entry`, `meta_credentials.onboarding_mode`, `meta_credentials.app_disconnected_at`). La migrazione del livello canali (T013, fase A) sarà quindi **`0013`**, non `0012`. Dove `tasks.md` e `plan.md` §6 dicono «`drizzle/0012_*.sql`» e «immagine precedente su DB a `0012`», si legga `0013`.
2. **`channel_account` non ha i campi della coexistence.** L'ADR §3.2 è stato scritto prima della PR #4. Oggi `Credentials` (la vista pubblica di `src/server/whatsapp/credentials.ts`) espone anche `onboardingMode` e `appDisconnectedAt`, e li usano `history`, `smb_app_state_sync` e `account_update`. Se in R2 `Credentials` diventa la vista di `channel_account`, questi due campi devono esserci (colonne o `config`), devono essere nella doppia scrittura e nel confronto campo per campo di V2. I golden li registrano: se si perdono, diventano rossi. **Decisione per l'orchestratore:** colonne dedicate o `config` jsonb.
3. **Punti di scrittura nuovi** (da aggiungere a T015–T017 e a plan §5.9):
   - `src/server/inbox/coexistence.ts:192` — insert a lotti di `message` dallo storico, con `created_at` = `wa_timestamp` e `ON CONFLICT (wa_message_id)`: serve la doppia scrittura di `channel` e `external_message_id` anche qui (T017), e in R3 il nuovo arbitro;
   - `src/server/whatsapp/credentials.ts:152` — `setAppDisconnected` (update di `meta_credentials` per WABA, modo e numero): doppia scrittura come `markReconnectRequired` (T014);
   - `src/server/whatsapp/embedded-signup.ts:231` — chiama `saveCredentials` con `onboardingMode`: coperto dalla doppia scrittura di `credentials.ts`, ma deve copiare anche il modo;
   - `src/server/inbox/coexistence.ts:358-367` — SQL a mano che aggiorna `contact.name` confrontando `c.wa_identity`: niente doppia scrittura (non cambia l'identità), ma **R3** deve riscriverlo prima di togliere `wa_identity`;
   - `src/server/inbox/identity.ts:159-174` — `lookupAddressBookName` legge `wa_address_book_entry.wa_identity`. La tabella è una rubrica del telefono WhatsApp, con la stessa chiave di `contact.wa_identity`: resta WhatsApp e fuori dal livello canali in M1 (da confermare nell'ADR).
4. **Route del webhook.** Oltre ai punti di plan §5.5, la usa anche `tests/unit/helpers/route-roles.ts:131` (elenco delle route senza sessione). M1.3 (T029), spostando la cartella, deve aggiornare quell'elenco. Anche il gestore smista ora **sei** `field` (`messages`, `smb_message_echoes`, `message_template_status_update`, `history`, `smb_app_state_sync`, `account_update`), non tre: `whatsappAdapter.webhook.parse` (T027) deve coprirli tutti.
5. **Golden dell'invio a livello di servizio.** I golden chiamano `sendText`, `sendMediaMessage`, `sendStructured`, `sendTemplate` e registrano il `SendError`/`TemplateError` (`code`, messaggio). La traduzione in risposta HTTP delle route `/api/conversations/[id]/messages*` (che richiedono una sessione Better Auth) **non** è nei golden: la coprono i test unitari esistenti (`send-errors.test.ts`, `route-roles-behavior.test.ts`).
6. **File golden diversi dal piano §7.1:**
   - `send-wapi.golden.test.ts` è separato da `send.golden.test.ts`: `WAPI_BASE_URL` cambia la configurazione di tutta l'istanza, e mescolarlo avrebbe registrato gli altri invii in una configurazione diversa da quella senza gateway;
   - `coexistence.golden.test.ts` è nuovo (mandato dell'orchestratore): eco, storico, rubrica, `account_update`;
   - `migration.golden.test.ts` non c'è: appartiene alla fase 2 (T008–T011).
7. **Nome del job CI invariato** («typecheck · lint · test · build»): se è un controllo richiesto nella protezione del branch, cambiarlo romperebbe la regola. Il passo `test:golden` è dentro lo stesso job.

## T001 — Inventario rigenerato (comandi di plan §5.12 su `126d20a`)

Comandi eseguiti così come sono in plan §5.12 (righe trovate: `wa_identity` 39, `wa_message_id` 69, `meta_credentials` 41, `webhooks/wa` 5, moduli `inbox|whatsapp|ai` importati da 63 file, finestra 35, Wapi 77). Differenze di riga rispetto a plan §5 (base `810272a`); **non** corrette nel piano, come chiede la nota del piano.

**§5.1 `wa_identity`.** `identity.ts`: matcher `:79→:82`, `bsuid:` `:83→:86`, insert `:120→:125` (valore `:129`), target `onConflictDoNothing` `:126→:138`, rilettura `:138→:150`; commento `:68` invariato. `lib/meta/client.ts` commento `:130→:319`. Invariati: `schema.ts:119`, `:148`; `bot/context/route.ts:12,24,26,27,52,59,106`; `export/contacts/route.ts:57`; `contacts/route.ts:166,171`; `start-conversation/route.ts:37`; `lab/runner.ts:246,251`; `seed/demo.ts:191`. **Nuovi:** `schema.ts:776-785` (`wa_address_book_entry.wa_identity`), `identity.ts:169` (lettura della rubrica), `coexistence.ts:332,343,350,364-366` (rubrica e SQL su `contact.wa_identity`).

**§5.2 `wa_message_id`.** `ingest.ts` (`:193,230,292,299,307,361,381,388,395`), `status.ts:43`, `bot/typing/route.ts:52,59,64`, `seed/demo.ts:220`, `schema.ts:349` invariati. `send.ts`: `:117→:123`, `:134→:140`, `:175/:185→:181/:191`, `:251/:261→:257/:267`, `:291→:299`, `:339/:361→:347/:369`. `templates.ts`: `:358→:371`, `:384→:397`. Mock: `wa-mock/graph/[...path]/route.ts:155,158,168→:188,191,201`; `wa-mock-state.ts` commento `:58→:72`. **Nuovi:** `coexistence.ts:52,126,198,216` (storico).

**§5.3 `meta_credentials`.** Tabella `schema.ts:435-460→:435-476` (due colonne in più); indici `:456→:473`, `:458→:475`. `credentials.ts`: `getCredentialsByPhoneNumberId :38→:46`, `getCredentialsByWabaId :51→:59`, `getCredentialsByOrg :63→:71`, `saveCredentials :75→:83` (insert `:102`, upsert `:117`, modo con `CASE` `:100`), `markReconnectRequired :116→:173` (update `:178`), `tokenLast4 :127→:184`; **nuovo** `setAppDisconnected :142` (update `:152`). Chiamanti: `send.ts` import `:6-10→:11-15`, `:88→:94`, `:276→:282`, `:393→:401`; `templates.ts` `:75→:82`, `:123→:130`, `:184→:194`, `:200→:210`, `:249→:262`, `:341→:354`; `media.ts:211→:226`; `engine.ts:74`, `bot/typing:67`, `bot/media:25`, wa-mock `inbound:41`, `echo:40`, `status:38` invariati; `settings/whatsapp/route.ts:13→:14`. **Nuovi chiamanti:** `coexistence.ts:7-9,141,294,404`, `embedded-signup.ts:9,231`, `wa-mock/coexistence/route.ts:4,29`.

**§5.5 `/api/webhooks/wa`.** `route.ts`: GET `:21-37→:26-42`, POST `:39-69→:44-74`, `processPayload :71-86→:76-100` (sei `field`). `settings/webhook/route.ts:9→:13`. `.env.example:33`, `tests/e2e/us1-inbox.md:74`, `wa-mock-inbound.ts:15` invariati. **Nuovo:** `tests/unit/helpers/route-roles.ts:131`.

**§5.6–5.8 moduli.** `src/server/inbox/` ora ha **9** file e 1995 righe (era 8 e 1511): nuovo `coexistence.ts` (415); `identity.ts` 151→180, `send.ts` 406→417, `webhook.ts` 110→139. `src/server/whatsapp/`: 7 file, 1419 righe; nuovo `embedded-signup.ts` (253); `credentials.ts` 129→186, `media.ts` 307→322, `templates.ts` 408→421. `src/server/ai/`: 504 righe; `prompts.ts` 90→91 (PR #5: regola della lingua del cliente), «asistente de WhatsApp» resta a `:33`, il giudice passa da `:68` a `:69`.

**§5.9 punti di scrittura.** `credentials.ts:86→:102`, `:121→:178`; `identity.ts:116→:125` (insert), `:107→:110` (update); `send.ts:129→:135`; `templates.ts:379→:392`; invariati `ingest.ts:169,294,383`, `contacts/route.ts:160`, `lab/runner.ts:182,192,241`, `seed/demo.ts:187,205,216`, `pipeline.ts:242`. Nuovi: vedi «Cosa cambia», punto 3.

**§5.10 finestra.** `send.ts:81→:87`; `composer.tsx:421→:422`; gli altri invariati (`pipeline.ts:125`, `queries.ts:130-131`, `engine.ts:161`, `bot/context:116-117`, `start-conversation:60`).

**§5.11 sandbox.** `send.ts:74→:80`, `templates.ts:333→:346`, `pipeline.ts:216` invariato.

## T002–T004 — Infrastruttura dei golden

- **`vitest.golden.config.ts`** + script `test:golden` in `package.json`. Esegue solo `tests/golden/**/*.golden.test.ts`, un file per volta (una sola base di dati). `pnpm test` non li include.
- **`tests/golden/setup.ts`:** `DATABASE_URL_GOLDEN` obbligatoria, e il nome della base deve contenere «golden» (il comando **cancella** lo schema `public`: così non può puntare per errore a una base con dati; `vocero_e2e`, `vocero_up`, `vocero`, `postgres` sono rifiutate). Schema pulito, poi le migrazioni con il **runner vero** (`scripts/migrate.mjs`): quando la fase 2 aggiungerà la riconciliazione al runner, i golden la eseguiranno senza toccare questo file. Prima di ogni caso: tabelle vuote e organizzazioni A e B, ognuna con il suo numero, salvate con `saveCredentials` (la funzione vera, che in R1 farà la doppia scrittura).
- **`tests/golden/env.ts`:** ambiente sintetico, senza ereditare nulla dalla shell (un `META_APP_SECRET` o un `WAPI_BASE_URL` locali cambierebbero ciò che si registra). Host finti `graph.golden.test`, `wapi.golden.test`, `ai.golden.test`.
- **`tests/golden/harness.ts`:** chiama i gestori veri (route `GET`/`POST` del webhook, `sendText`, `sendMediaMessage`, `sendStructured`, `sendTemplate`, `runAgentTurn`); `fetch` intercettato (Graph, Wapi, AI; **qualunque altro host è bloccato** e finisce nell'istantanea); `after()` di Next messo in coda ed eseguito a risposta chiusa, come in produzione; eventi SSE letti con `subscribe` (nessun mock del bus); attesa del lavoro in background (scaricamento allegati, turno dell'agente). L'istantanea contiene: righe di `contact`, `conversation`, `message`, `media_asset`, `lead`, `lead_stage_event`, `template`, `wa_address_book_entry`; le credenziali lette con `getCredentialsByOrg` (l'API pubblica, che in R2 diventa la vista di `channel_account`); le richieste in uscita (destinazione, metodo, percorso, body, **tipo** di bearer); gli eventi SSE; la risposta o l'errore; il numero di `console.error`.
- **Scelte che proteggono le fasi successive:**
  - colonne **esplicite** di oggi (non `select *`): le colonne aggiunte da R1 non cambiano i golden;
  - campi additivi dei DTO solo se dichiarati in `DECLARED_ADDITIVE_KEYS` (`normalize.ts`, oggi vuoto): T033 aggiungerà `channel` lì e lo scriverà nel suo registro;
  - l'import della route del webhook è in un solo punto (`harness.ts`): T029 cambia quella riga, non i file golden.
- **`tests/golden/normalize.ts`:** ID casuali → segnaposto stabili (`<ct#1>`); orologio fisso dei golden (`Date` congelata al 2030-01-01T12:00:00Z) → orari relativi (`<now-1m>`), `<db-now>` per i `DEFAULT now()` di PostgreSQL; token e chiavi → solo il tipo (`meta_token(org_golden_a)`); un segreto che comparisse fuori da un'intestazione resterebbe visibile come `<secret:…>`.
- **Fixture (`tests/golden/fixtures/whatsapp/`, 35 JSON):** sintetiche, dalla forma di `src/server/dev/wa-mock-inbound.ts` e da quella documentata da Meta; origine e costanti in `index.ts`. Nessun payload reale (D12).
- **Registrazione:** `GOLDEN_UPDATE=1 pnpm test:golden` scrive `tests/golden/__golden__/*.json`. Senza la variabile, un caso senza golden **fallisce** (non si crea mai in silenzio).

## T005 — Casi registrati (77, sul codice invariato)

| File | Casi |
|---|---|
| `inbound` (13) | testo da `521…` → identità `52…`, conversazione, lead e SSE · solo BSUID · telefono + BSUID con contatto BSUID esistente (stesso contatto) · duplicato nello stesso payload e riconsegna · immagine (scaricata da Graph) · documento con nome · posizione · contatti · allegato rotto (Graph 404 → asset `failed`, messaggio conservato) · tipi non supportati · senza identità · più `entry`/`changes` per A e B · contatto archiviato che riscrive (riattivato, nome dell'operatore rispettato) |
| `status` (5) | `sent→delivered→read` · `delivered` tardivo dopo `read` · `failed` con codice tradotto · **wamid di A sul numero di B** · stati e messaggi nello stesso `change` (prima gli stati) |
| `echo` (7) | testo a un lead (uscente `manual`, IA in pausa `manual_reply`, la finestra non si apre) · numero nuovo (contatto e conversazione senza finestra né lead) · immagine · duplicato · senza `to` · variante con la chiave `messages` · handoff precedente non sovrascritto |
| `coexistence` (14) | storico: fili importati con `created_at` = `wa_timestamp`, senza finestra, non letti, lead né IA · storico dopo un messaggio nuovo (non arretra `last_message_at`) · storico riconsegnato (idempotente) · storico su connessione manuale (ignorato) · storico con contatto archiviato (non riattivato) · storico rifiutato (2593109) · rubrica (nomi solo ai contatti con nome di riempimento, aggiunta e rimozione, nessun contatto creato) · rubrica su connessione manuale · contatto nuovo con il nome della rubrica · `account_update` `PARTNER_REMOVED` con numero su WABA condivisa (solo quel numero) · `ACCOUNT_OFFBOARDED` senza numero (tutta la WABA in coexistence, mai una connessione manuale) · `ACCOUNT_RECONNECTED` · altro evento ignorato · ricollegare lo stesso numero a mano conserva il modo e toglie il taglio |
| `routing` (4) | stato del modello per WABA (solo la sua organizzazione) · `phone_number_id` sconosciuto · **payload per B non tocca A** · `field` sconosciuto |
| `webhook-auth` (10, con `META_APP_SECRET`) | token dell'URL errato 404 · firma errata 401 · firma assente 401 · firma di un altro segreto 401 · firma valida 200 · body illeggibile 200 senza effetti · GET 200 con il challenge · GET con token errato 403 · GET con `hub.mode` diverso 403 · GET con segmento errato 404 |
| `send` (17) | testo · immagine con didascalia (upload poi invio) · documento con nome · upload fallito (messaggio `failed` conservato, `upload_failed`) · posizione · contatti · modello con variabili · modello con variabile vuota (nessun `fetch`) · destinatario solo BSUID · finestra chiusa · token scaduto 190 (`reconnect_required`, credenziale marcata, l'invio successivo non chiama Graph) · Meta 5xx (`meta_unavailable`) · Meta 4xx (`meta_error`) · **organizzazione A su conversazione di B** (testo, posizione, modello: rifiutati senza `fetch`) · Laboratorio (testo, allegato, modello: `sandbox_violation` senza `fetch`) · organizzazione mai collegata (`not_connected`) · allegato troppo grande o di tipo sconosciuto |
| `send-wapi` (3, con `WAPI_BASE_URL`) | A con chiave propria → Wapi con la chiave di A, B senza chiave → Meta diretto con il token di B · allegato in entrata e in uscita di A via Wapi · chiave di A revocata → Meta diretto con il token di A |
| `agent` (4, IA sintetica) | messaggio reale → turno → risposta inviata (`aiGenerated`) · il modello chiede handoff con saluto · finestra chiusa → handoff `ventana` senza modello né Graph · Laboratorio: risposta salvata in sandbox, nessuna richiesta a Graph |

Le istantanee sono state lette una per una dopo la registrazione (nessun `console.error` inatteso, nessun host bloccato, nessun segreto fuori dalle intestazioni). Stabilità: tre esecuzioni di fila senza `GOLDEN_UPDATE`, 77/77 verdi ogni volta.

Il prompt di sistema dell'agente (PR #5) è dentro il golden `agent` (body della richiesta al modello): M1.5 (T040) lo cambierà e dovrà aggiornare quel golden **in modo dichiarato**.

## T006 — CI

`.github/workflows/ci.yml`: servizio `postgres:16` (utente, password e base di prova, `pg_isready` come controllo di salute) e passo `test:golden` con `DATABASE_URL_GOLDEN=postgres://vocero:vocero@localhost:5432/vocero_golden`, dopo `test`, che gira anche se un passo precedente fallisce (come gli altri). **Non eseguito su GitHub** (nessun push in questo mandato): YAML validato solo in locale.

## T007 — Sabotaggi

Metodo: uno script (non versionato, nello scratchpad) sostituisce **una** riga di `src/`, esegue tutta la suite golden, conta i casi rossi e rimette il file com'era. Alla fine controlla che `git diff -- src` sia vuoto (lo era). 20 inversioni, **tutte catturate**.

**Guardie richieste da T007 (ADR §3.7):**

| Guardia invertita | Dove | Golden rossi | Caso che la vede |
|---|---|---|---|
| sandbox nell'invio (`isTest` ignorato) | `send.ts:80` | 1/77 | send › Laboratorio → `sandbox_violation` senza `fetch` |
| sandbox nei modelli | `templates.ts:346` | 1/77 | stesso caso (la parte modello) |
| sandbox nella risposta dell'agente | `pipeline.ts:216` | 1/77 | agent › Laboratorio, nessuna richiesta a Graph |
| ordine stati → messaggi (stati spostati dopo i messaggi) | `ingest.ts:212-214` | 1/77 | status › stati e messaggi nello stesso `change` |
| `normalizeMx` nell'identità (telefono non normalizzato) | `identity.ts:51` | 47/77 | quasi tutti i casi con `521…` |
| `onConflictDoNothing` dei messaggi in entrata | `ingest.ts:395` | 1/77 | inbound › duplicato (il secondo messaggio del payload si perde) |
| `onConflictDoNothing` degli echi | `ingest.ts:307` | 1/77 | echo › duplicato (lo vede il conteggio di `console.error`: l'errore viene inghiottito, le righe restano uguali) |
| `onConflictDoNothing` dello storico | `coexistence.ts:216` | 1/77 | coexistence › storico riconsegnato |
| monotonìa degli stati (`n > c` → `n !== c`) | `status.ts:22` | 1/77 | status › `delivered` tardivo dopo `read` |
| filtro per organizzazione degli stati | `status.ts:42` | 1/77 | status › wamid di A sul numero di B |
| pausa AI sull'eco | `ingest.ts:335` | 5/77 | echo › testo, numero nuovo, immagine, duplicato, variante `messages` |

**Guardie in più, stesso metodo:**

| Guardia invertita | Dove | Golden rossi |
|---|---|---|
| segmento segreto dell'URL (capa 1) | `webhook.ts:20` | 2/77 (POST e GET con token errato) |
| firma (capa 2) | `webhook.ts:33` | 3/77 (firma errata, assente, di un altro segreto) |
| finestra di 24 h nell'invio | `send.ts:87` | 1/77 |
| organizzazione della conversazione nell'invio | `send.ts:76` | 1/77 (A su conversazione di B) |
| finestra chiusa → handoff `ventana` nell'agente | `pipeline.ts:125` | 1/77 |
| storico solo con connessione coexistence | `coexistence.ts:148` | 1/77 |
| `account_update` solo su connessioni coexistence | `credentials.ts:162` | 1/77 |
| `account_update` limitato al numero | `credentials.ts:163` | 1/77 |
| lo storico non apre la finestra (aggiunto `lastInboundAt`) | `coexistence.ts:231` | 4/77 |

Nota: il sabotaggio dell'`onConflictDoNothing` degli echi non cambia nessuna riga (l'errore di chiave duplicata è catturato e registrato con `console.error`). Senza il conteggio di `console.error` nell'istantanea non sarebbe stato visto: per questo il conteggio è parte dei golden.

Le guardie nuove della fase 2 (FK composte, indici univoci, riconciliazione, V2, modalità `blocca`) hanno i loro sabotaggi in T021 e T032.

## Verifiche prima del commit

Binari chiamati direttamente (niente `pnpm`, per non reinstallare `node_modules` nel worktree):

- `tsc --noEmit`: verde;
- `eslint .`: verde, nessun avviso;
- `vitest run` (unitari): 65 file, 993 test verdi (uguale a prima: nessun test unitario toccato);
- `vitest run -c vitest.golden.config.ts` con `DATABASE_URL_GOLDEN=postgres://vocero@127.0.0.1:5433/vocero_golden` (PostgreSQL 16 usa e getta): 9 file, 77 test verdi, circa 27 s;
- senza `DATABASE_URL_GOLDEN`: la corrida esce con codice 1 e il messaggio «[golden] Falta DATABASE_URL_GOLDEN…»;
- `next build`: verde;
- schema invariato: nessuna migrazione, `db:generate` non necessario;
- `git diff -- src`: vuoto.

## Non verificato

- La CI con PostgreSQL non è stata eseguita su GitHub (nessun push).
- `pnpm test:e2e` (app viva + mock) non eseguito: in questa fase il codice dell'app non cambia; resta obbligatorio dalla fase 2.
- Le route HTTP dell'invio (con sessione) non sono nei golden (vedi «Cosa cambia», punto 5).
- I log (`console.warn`/`console.log`) non sono registrati, solo il numero di `console.error`: un refactor che cambia il testo di un avviso non fa fallire i golden.
- La descrizione dei body `multipart` dell'upload registra nome, tipo e dimensione del file, non i byte.
- I golden girano con un orologio congelato: non provano il passare del tempo reale (per esempio la coalescenza di `AGENT_COALESCE_MS` è a 0 nei golden dell'agente).
- Le fixture sono sintetiche: nessun payload reale anonimizzato (D12 facoltativo).
