# 016 — Modalità ascolto e lettura per Heili Core

Branch `claude/ascolto-orbit` · pacchetto `.coordinamento/pacchetti/modalita-ascolto.json` · specifica
`specs/custom-heili/016-modalita-ascolto-e-feed-core.md` · 2026-10-31.

## Obiettivo

1. Una modalità ascolto per organizzazione: accesa, Orbit non invia nulla da solo a un cliente finale
   (agente AI, automazioni, cervello esterno). Le risposte delle persone dalla Posta restano libere.
2. Un feed di sola lettura per Heili Core, `/api/export/core/*` (`orbit.core-feed/v1`), con la chiave `vex_`.

## Cosa ho fatto

- **Schema e migrazione:** tabella `listening_mode` (`lsm_…`, `organization_id` UNIQUE con cascade, `enabled`,
  `enabled_at`, `enabled_by`, `updated_at`). `pnpm db:generate --name modalita_ascolto` ha prodotto la sola
  `0020_modalita_ascolto.sql` (+ snapshot e journal). Ho aggiunto l'intestazione e `SET LOCAL lock_timeout`
  come in 0013-0019. Un secondo `db:generate` risponde «No schema changes».
- **Unica fonte:** `src/server/listening/mode.ts` (`isListeningMode`, `getListeningState`, `setListeningMode`,
  `listeningModeError`). Nessun altro file conosce la tabella, tranne la rotta GET/PUT che passa da qui.
- **Blocchi:**
  - `ai/trigger.ts`: il turno non si pianifica (l'organizzazione si legge dalla riga della conversazione, per chiave primaria).
  - `channels/core/send.ts`: `sendText` con `aiGenerated` → `SendError("listening_mode")` prima di `prepareSend`.
  - `channels/errors.ts`: nuovo codice. Le due mappe `SendError → HTTP` (messages, media) lo traducono in 409.
  - `api/bot/messages` e `api/bot/typing`: 409 `listening_mode` prima di ogni lettura o chiamata a Graph. `messages` mappa anche l'errore di `sendText`.
  - `automations/engine.ts`: l'organizzazione si salta; nuovo campo `skippedListening` nelle statistiche (`orgs` resta 1).
- **Impostazioni:** `GET/PUT /api/settings/listening` (`withAdminAuth`, Zod `.strict()`, `enabled_by` = utente della sessione),
  pagina `/settings/listening` con interruttore, voce nel menu (solo owner/admin), testi es/en/it.
  Riaccendere da acceso non sposta `enabled_at`; spegnere lo conserva.
- **Posta:** striscia informativa in `inbox/page.tsx` (server component) quando la modalità è accesa.
- **Feed Core:** `state`, `contacts`, `conversations`, `messages` + `src/server/listening/feed.ts` (cursore, limite, busta).
  - Cursore `base64url(<ISO>|<id>)`, validato con regex ISO e regex id; malformato → 422 `invalid_cursor`, limite fuori 1..1000 → 422 `invalid_limit`, entrambi prima del database.
  - **Precisione dei microsecondi.** L'ISO del cursore esce da `to_char(..., 'US')`, non da `Date`. Con i millisecondi di JS una riga `…123456` sarebbe sempre «dopo» il cursore `…123` e tornerebbe a ogni pagina. Condizione unica: `(ts, id) > ($ts::timestamp, $id)` (`keysetAfter`).
  - `changed_at` dei contatti = `greatest(updated_at, archived_at, (select max(created_at) from contact_identity ...))`, la sottoquery è `scoped()`.
  - Contatto archiviato → `{ id, deleted: true, changedAt }`. Mai `notes`, `ficha`, tag, trattativa.
- **File fuori dal perimetro iniziale, dichiarato:** `src/server/export/handler.ts` (commit `af0c949`, solo `.coordinamento/…json`):
  il tipo del gestore era `{id, name}`, mi serve `ExportOrg` (con `slug`) per `organizationSlug`. Il valore a runtime lo conteneva già.
  Cambio di una riga, solo di tipo.
- **Test helper** `tests/unit/helpers/route-roles.ts`: 5 righe nuove nell'inventario delle rotte (richieste dal guardarraíl AST).

## Decisioni da rivedere

- `nextCursor` = cursore dell'ULTIMO elemento restituito; `null` solo se la pagina è vuota. Con «null a fine corsa» il Core
  non saprebbe da dove ripartire al pull successivo. Il consumatore ripete finché `nextCursor` non torna `null` o `items` è vuoto.
- `listening` nelle liste è un booleano letto a ogni richiesta (una query in più per pagina, `scoped()`).
- `maybeRunAgentTurn` fa una query in più per conversazione (org dalla riga). Non ho toccato `ingest.ts` (fuori perimetro).
- Un turno già in volo o un secondo intento già armato (`agent_retry_at`) può ancora chiamare il modello: l'invio è bloccato
  da `sendText`, quindi nessun messaggio parte, ma il costo del modello c'è. Il turno termina con un `console.error` in `executeTurn`.
  Chiudere anche questo richiede di toccare `ai/pipeline.ts` (fuori perimetro). Non l'ho fatto.
- `bot/media/[mediaId]` (scarica un allegato da Meta) non è bloccato: è una lettura, non parla al cliente.

## Prove

Controlli (tutti sull'albero finale, `NODE_USE_ENV_PROXY=1` solo per `pnpm build`, vedi sotto):

```
$ pnpm typecheck   → tsc --noEmit, nessun errore
$ pnpm lint        → eslint ., nessun errore
$ pnpm build       → verde (compare /settings/listening, /api/export/core/*)
$ pnpm test        → Test Files 107 passed (107) · Tests 1782 passed (1782)   (baseline 1683)
$ pnpm db:generate → «No schema changes, nothing to migrate»
$ node scripts/coordina.mjs verifica → OK: modalita-ascolto (claude) tocca solo il suo perimetro
```

Test nuovi, per punto della specifica:

| # | Test | File |
|---|---|---|
| 1 | turno non pianificato (A) / pianificato (B, spenta) / conversazione assente / IA non configurata | `listening-agent-trigger.test.ts` |
| 2 | `sendText` aiGenerated → `listening_mode`, adattatore e inserimenti a zero; B parte | `listening-send.test.ts` |
| 3 | `/api/bot/messages` e `/typing` → 409, `sendText`/Graph/DB mai chiamati; B passa; mappa difesa in profondità | `listening-bot-routes.test.ts` |
| 4 | automazioni: nessun `sendTemplate` né credenziali per A; sì per B | `listening-automations.test.ts` |
| 5 | invio di una persona (testo, posizione) in ascolto → permesso | `listening-send.test.ts` |
| 6 | `PUT` da member/«»/Owner/viewer → 403; 401 senza sessione; corpi con campi in più o sbagliati → 422; owner/admin scrivono per la PROPRIA org | `listening-settings-route.test.ts` |
| — | `mode.ts`: A acceso non accende B, query con `organization_id = $1`, `organizationId` vuoto → nessuna query | `listening-mode.test.ts` |
| — | feed: forma esatta, niente `notes`/`ficha`/tag, archiviato, `is_test` escluso, B non legge A, cursore (7 malformati), limiti, keyset | `export-core-feed.test.ts` |
| — | estese le 4 rotte nuove in `export-routes-scoped.test.ts` (proxy SQL e test strutturale, ora ricorsivo) | `export-routes-scoped.test.ts` |
| — | striscia nella Posta e voce di menu per ruolo | `listening-ui.test.ts` |

Il test strutturale di `export-routes-scoped` ha accusato un mio errore: avevo scritto `.from(c)` con alias e la regex non vedeva le
tabelle. Ho corretto le rotte (nomi `schema.<tabella>` espliciti), non il test. `core/state` non ha query nella rotta: è l'unica eccezione
dichiarata nel test (`WITHOUT_QUERIES`), coperta dal blocco di comportamento con l'SQL reale.

**Prova su PostgreSQL 16 vero** (cluster usa e getta in una cartella temporanea, porta 54329, già smontabile; nessun dato reale):
- `scripts/migrate.mjs` applica 0020, V1..V7 = 0, esito 0; la tabella ha indice univoco e FK con cascade come da schema.
- Test temporaneo (non committato) con le rotte vere: 5 messaggi con lo STESSO `created_at` a microsecondi, pagine da 2 →
  `msg_1..msg_5` senza ripetizioni né perdite; messaggio del Laboratorio e di un'altra org esclusi; contatto con `notes: "SEGRETO"` non esce;
  un'identità aggiunta dopo fa ricomparire il contatto con le identità; l'archiviazione dà `{id, deleted, changedAt}`;
  `enabledAt` resta stabile riaccendendo da acceso; la chiave di B vede solo B.

`pnpm build` qui fallisce senza il proxy per Node: `next/font/google` scarica i font con `fetch` di Node, che non usa `HTTPS_PROXY`
(errore in `src/app/layout.tsx`, file non toccato). Con `NODE_USE_ENV_PROXY=1` è verde. Non ho verificato la build senza proxy.

## Sabotaggi

Per ciascuno ho cambiato una riga, lanciato i test indicati, annotato i falliti e ripristinato (il file è tornato identico, i test verdi).

| # | Guardia invertita | Test che fallisce |
|---|---|---|
| 1 | `trigger.ts`: `(await isListeningMode(organizationId))` → `false` | «organizzazione in ascolto: nessun turno pianificato» |
| 2 | `core/send.ts`: `if (input.aiGenerated && ...)` → `if (false)` | «aiGenerated in ascolto → SendError listening_mode, adattatore mai chiamato...» |
| 3a | `bot/messages`: guardia → `if (false)` | «in ascolto → 409 listening_mode; né sendText né database» |
| 3b | `bot/typing`: guardia → `if (false)` | «in ascolto → 409 listening_mode e Graph mai chiamato» |
| 3c | `bot/messages`: mappa `err.code === "listening_mode"` tolta | «difesa in profondità...» |
| 4 | `engine.ts`: salto → `if (false)` | «in ascolto: nessun sendTemplate, nemmeno le credenziali...» |
| 5 | `core/send.ts`: tolto `input.aiGenerated &&` (blocca anche le persone) | «testo senza aiGenerated: parte e si salva» |
| 6a | `PUT` con `withAuth` invece di `withAdminAuth` | 4 test «rol … → 403» (member, vuoto, Owner, viewer); più il guardarraíl AST |
| 6b | `.strict()` tolto | 2 test «corpo … → 422» |
| 7 | `mode.ts`: `scoped(...)` → `undefined` | 4 test di `listening-mode` (compreso lo strutturale) |
| 8 | `feed.ts`: `>` → `>=` nel keyset | «nextCursor ... condizione keyset» e «confronto di tupla ... strettamente maggiore» |
| 9 | `core/messages`: tolto `is_test = false` | «campi esatti, hasMedia ...; is_test escluso» |
| 10 | `core/conversations`: tolto `is_test = false` | «campi esatti e channel; is_test escluso» |
| 11 | `core/contacts`: sottoquery identità senza `scoped` | `/api/export/core/contacts` (isolamento SQL) e «sottoquery acotada» |
| 12 | `core/contacts`: archiviato espone i dati | «archiviato: solo { id, deleted: true, changedAt }» |
| 13 | `feed.ts`: tolta la regex ISO del cursore | «cursore malformato "Oct 2 2026..."». Dopo la prima passata questo sabotaggio NON era visto da nessun test (Date.parse accetta altri formati): ho aggiunto il caso e ora fallisce |
| 14 | `core/messages`: join `conversation` senza `scoped` | isolamento SQL e test strutturale |

Il sabotaggio 8 nella prima passata mancava il bersaglio (sostituiva un commento): rifatto sulla riga giusta.

## Cosa non ho verificato

- **E2E con i mock** («accendo l'ascolto → arriva un messaggio → l'agente non risponde → l'operatore risponde dalla Posta»):
  NON eseguito. Non ho avviato l'app con Playwright e i mock; `tests/e2e/` e `scripts/e2e-selftest.mjs` sono invariati.
  Il comportamento è coperto da test unitari e dal Postgres vero solo per migrazione e feed.
- L'aspetto della striscia nella Posta e della pagina Impostazioni: nessuno screenshot. Non so se `h-full` dentro il contenitore flex
  della striscia si comporta come prima nel layout reale.
- Il percorso `ingest → maybeRunAgentTurn → pipeline` con la modalità accesa su un database vero e il turno già in volo (vedi decisioni).
- `pnpm build` senza `NODE_USE_ENV_PROXY=1` (limite dell'ambiente, vedi sopra).
- Prestazioni: nessun `EXPLAIN` sul keyset. L'espressione `greatest(...)` dei contatti non usa un indice; su basi grandi
  l'ordinamento è per ogni pagina. Andrebbe misurata.
- La sovrapposizione di 5 minuti del consumatore (lato Core) è nel contratto, non testabile qui.

## Cosa deve controllare il revisore

1. L'interpretazione di `nextCursor` (ultimo elemento, `null` solo a pagina vuota).
2. Che `maybeRunAgentTurn` legga l'org dalla riga della conversazione per chiave primaria (unica query non filtrata per org: serve proprio a ricavarla).
3. Il costo del modello dei turni già in volo (pipeline fuori perimetro): se vale la pena un pacchetto a parte.
4. Il tipo `ExportOrg` in `withExport` (unica modifica fuori dal perimetro iniziale, dichiarata nel JSON).
5. L'eccezione `WITHOUT_QUERIES` per `core/state` nel test strutturale.
6. Che `bot/media/[mediaId]` possa restare attivo in ascolto.

## Verifica avversaria e correzioni (orchestratore, 31/10)

Verificatore separato (agente `crm-verificatore`, Opus), in un worktree e con un Postgres usa e getta suoi.
Verdetto **NON REGGE**, con 0 problemi Critici e 0 Alti. Le correzioni sono in un commit sopra `896a6a4`.

| # | Gravità | Problema | Correzione | Test e sabotaggio |
|---|---|---|---|---|
| 1 | Medio | La precisione in µs del cursore non era protetta (`US` → `MS` lasciava i test verdi) | `MICRO_ISO_FORMAT` esportata, `microIso` la usa | Nuovo test sul formato e sull'SQL generato; `US`→`MS` lo fa fallire |
| 2 | Medio | Automazioni: l'ascolto acceso a giro iniziato non fermava gli invii | Rilettura di `isListeningMode` prima di ogni `sendTemplate` | Test «accesa a giro iniziato»; togliendo la rilettura fallisce |
| 3 | Medio | `core/messages` e `core/conversations` esponevano un contatto archiviato | Join `scoped` con `contact.archived_at IS NULL` in entrambe | Test sull'SQL; togliendo la condizione fallisce |
| 4 | Medio | Mancava l'E2E | Sezione `listeningSection` nell'harness, 19 controlli | Vedi «E2E» sotto |
| 5 | Basso | Una data impossibile nel cursore dava 500 | `isRealInstant`: niente anno 0, andata e ritorno fino ai secondi | 3 casi più la rotta → 422 senza query; togliendo il controllo falliscono 3 test |
| 6 | Basso | `listening` fisso a vero e il controllo del base64 senza test | — | 2 test nuovi; ciascun sabotaggio ne fa fallire 1 |
| 7 | Basso | Contatti e conversazioni su `updated_at` possono perdere le transazioni lente | Il contratto chiede **5 minuti di sovrapposizione su tutte e tre le liste**; deduplica per `id` | Contratto `heili-platform:docs/contratti/crm-core.md` e spec aggiornati |
| 8 | Basso | Prestazioni: niente indice dedicato; `greatest()` sui contatti | Rinviato: volumi del pilota piccoli. Da rivedere con `EXPLAIN` sui dati veri | — |
| 9 | Basso | In ascolto l'IA poteva ancora chiamare il modello e scrivere nel CRM (turno pianificato prima, `agent_retry_at`, «Riprova») | Guardia all'inizio di `runAgentTurn`: un turno reale in ascolto esce subito, il Laboratorio prosegue | `listening-pipeline.test.ts` (4 test); togliendo la guardia falliscono 2 test, bloccando anche il Laboratorio ne fallisce 1 |
| 10 | Basso | Procedura di ritorno indietro della 0020 non scritta | Vedi sotto | Il verificatore l'ha provata su Postgres |

`src/server/ai/pipeline.ts` entra nel perimetro per il punto 9 (dichiarato nel JSON del pacchetto).

### Ritorno indietro della migrazione 0020
1. `DROP TABLE IF EXISTS listening_mode;`
2. Togliere la riga della 0020 da `drizzle.__drizzle_migrations` (hash della 0020).
3. Fare il deploy del commit precedente.

Nessun'altra tabella dipende da `listening_mode`. Il verificatore ha provato il rollback e la riapplicazione su Postgres 16.

### E2E (Definizione di Hecho)
Ambiente:
- Postgres 16 usa e getta su `127.0.0.1:55440`;
- `next dev` con i mock: `WA_MOCK_ENABLED=true`, wa-mock e ai-mock;
- `OPENROUTER_MODEL=mock/model`, `SUPERADMIN_EMAILS=e2e@vocero.test`, `AGENT_COALESCE_MS=500`, `AGENT_RETRY_MS=4000`, come nei registri precedenti (`docs/lavoro/2026-10-14-m1.3-r2.md`).

```
origin/main (worktree pulito, stesso ambiente):  ===== 278/278 checks OK, 0 fallos =====
claude/ascolto-orbit:                            ===== 297/297 checks OK, 0 fallos =====
== 016: modalità ascolto ==  (19 controlli, tutti OK)
  in ascolto l'agente NON risponde · il cervello esterno riceve 409 listening_mode · anche «sta scrivendo» → 409
  niente è partito verso il cliente · l'operatore risponde dalla Posta · …e il suo messaggio parte
  feed: state dice listening.enabled = true · messaggi con direction e origin · contatto senza note né scheda
  feed senza chiave → 401 · cursore malformato → 422 · ascolto spento: l'agente torna a rispondere
```

Lezione dell'ambiente: senza `OPENROUTER_MODEL` l'agente non risponde mai. In quel caso «in ascolto l'agente NON
risponde» risulterebbe vero per la ragione sbagliata. Per questo la sezione chiude spegnendo l'ascolto e
verificando che l'agente torni a rispondere. Al primo giro quel controllo ha rivelato proprio questo problema.

Controlli finali sull'albero corretto:
- `pnpm typecheck`: ok;
- `pnpm lint`: ok;
- `pnpm test`: 108 file, **1793 test** passati;
- `NODE_USE_ENV_PROXY=1 pnpm build`: ok;
- `pnpm db:generate`: «No schema changes».

## Ciclo EGM del 01/11: review indipendente e correzione P1

Metodo: Elephant-Goldfish adottato dall'owner il 01/11 (policy `heili-platform:docs/metodo-egm-heili.md`, PR #89
in bozza, letta al commit `db42098`). Il plugin EGM 0.1.0 **non è installato** nella sessione cloud che ha fatto
questo ciclo: nessuna skill `egm-*` invocata. È un percorso documentale equivalente, non un'esecuzione del plugin.

### Percorso
- Il pacchetto 016 è un cambio cross-module, contrattuale, dati e sicurezza, quindi per la matrice va la review di
  design completa. Il codice però precede l'adozione: la review di design pre-codice EGM **non è stata svolta** e non
  si dichiara a posteriori. Esiste la review G7 del progetto (`heili-platform:docs/analisi/2026-10-31-…` §14).
- Passi svolti: review indipendente post-codice di `1277633` (mai riverificato dopo la verifica del 31/10), poi
  correzione del finding P1 con **percorso ridotto** (piccolo bug circoscritto che riporta il codice alla spec; nessun
  cambio di contratto o di design), poi review indipendente del diff.

### Revisori (Goldfish)
Subagent nuovi, senza la chat dell'autore, tipo `Plan` (senza Edit/Write; la sola lettura è imposta dal brief, non da
una sandbox). Non è stato possibile impostare `omitClaudeMd:true`. Brief con fonti fissate per SHA e vincoli espliciti.

| # | Oggetto | Durata | Tool | Verdetto |
|---|---|---|---|---|
| 1 | `c5c4d37..1277633` + contratto `heili-platform@8ba71cd` | 331 s | 35 | REGGE con riserve: 0 Critici, 0 Alti, 4 Medi, 6 Bassi |
| 2 | `af2f125` (correzione P1) | 212 s | 26 | REGGE: 0 Alti; 1 Medio (stesso tipo di P1) e Bassi |

Budget: 3 invocazioni su 20 (con il re-audit sotto), circa 12 minuti su 30.

### P1 — correzione
In ascolto il secondo intento (`claimAgentRetry`) e «Riprova» (`claimManualRetry`, anche `aiEnabled: true`) toglievano
il passaggio a una persona prima della guardia di `runAgentTurn`, poi il turno usciva senza fare nulla.
- `af2f125`: guardia in `fireAgentRetry` prima del reclamo; `prepareManualRetry` → 409 `listening_mode`; codice e testi
  es/en/it nel pannello; `manual-retry.ts` dichiarato nel pacchetto.
- Commit successivo (finding Medio della review 2): la guardia di `fireAgentRetry` sale subito dopo la lettura della
  conversazione. Copre anche il ramo «entrante più nuovo dell'atteso», che in ascolto lasciava una marca scaduta senza
  turno che la consumasse. Controllo E2E spostato con l'agente acceso e su `aiEnabled`. Spec §A aggiornata.

### Re-audit di `20971a2` (Goldfish, unico consentito per lo stadio)
155 s, 20 tool. Verdetto **REGGE**: la guardia copre ogni ramo di `fireAgentRetry` in ascolto, il Laboratorio prosegue,
fuori ascolto nessun cambio osservabile (una query in più per secondo intento). Quattro Bassi, corretti nel commit
successivo: il controllo E2E su `aiEnabled` non poteva fallire (ora l'IA della conversazione si spegne prima e si
verifica che resti spenta); commento E2E impreciso; questi due riferimenti nel registro.

### Sabotaggi (eseguiti, `tests/unit/listening-retry.test.ts`, 6 test)
| Sabotaggio | Esito |
|---|---|
| Tolta la guardia in `fireAgentRetry` | 2 test falliscono |
| Guardia anche sul Laboratorio (`!isTest` tolto) | 1 test fallisce |
| Tolta la guardia in `prepareManualRetry` | 1 test fallisce |

Prima della correzione i test nuovi fallivano su `1277633` (2 su 4, versione iniziale del file, eseguita), e quello del ramo «entrante più nuovo» su `af2f125` (eseguito prima di spostare la guardia).

### Prove (container cloud usa e getta, Postgres 16 locale, `.env` con soli valori sintetici)
```
pnpm typecheck                      → ok
pnpm lint                           → ok
pnpm test                           → 109 file, 1799 test passati (baseline 1793)
pnpm test:golden (Postgres 16)      → 24 file, 270 test passati
pnpm test:e2e (next dev + mock, META_APP_SECRET/APP_ID/ES_CONFIG_ID sintetici, base nuova)
                                    → ===== 299/299 checks OK, 0 fallos =====, 0 SKIP (prima: 297/297)
NODE_USE_ENV_PROXY=1 pnpm build     → ok
pnpm db:generate                    → No schema changes
node scripts/coordina.mjs verifica  → OK
```

### CI
`vocero-crm` è un **fork**: GitHub non esegue i workflow di un fork finché non vengono abilitati nella scheda Actions.
API al 01/11: workflow `CI` «active», **0 esecuzioni** in tutta la storia del repository. Tutte le prove sopra sono
locali. Non verificato: che `actions/checkout@v7`, `actions/setup-node@v7`, `pnpm/action-setup@v6` esistano
(`heili-platform` usa le v4).

### Aperti, non corretti in questo ciclo
- **Contratto (P2, P3, Medi):** semantica di `nextCursor` non scritta nel contratto; cursore «opaco» incompatibile con
  la sovrapposizione di 5 minuti chiesta al Core. Si decide con il guardiano del Cervello (Codex), con review di design
  completa: è un cambio di contratto.
- **P4 (Medio, decisione dell'owner):** l'archiviazione in Orbit si annulla (anche da sola, con un nuovo entrante), il
  contratto la tratta come cancellazione a cascata nel Core. I contatti del Laboratorio escono come `deleted`.
- **`bot/reset` in ascolto (Medio, preesistente):** il cervello esterno può togliere il passaggio a una persona e
  riaccendere l'IA; nessuna guardia di ascolto. L'`UPDATE` della riga 54 filtra solo per `id`, senza `scoped()` (la
  SELECT prima è filtrata). Fuori dal diff di questo ciclo.
- **Bassi:** controllo dell'ascolto e reclamo non atomici (finestra di millisecondi, accettata); in ascolto il secondo
  intento toglie la marca senza `conversation.handoff` (come oggi con l'agente spento); «Riprova» visibile in ascolto;
  P5–P10 della review 1 (contratto più largo su `/api/bot/*`, `invalid_limit`, `enabledAt` da spento,
  `organizationSlug` nullable, nessun indice del feed, `isListeningMode` senza catch nella Posta).

### Cosa non ho verificato
- La CI su GitHub (vedi sopra).
- `EXPLAIN` del feed; rendering reale della UI (nessuno screenshot).
- Il comportamento sotto concorrenza reale della finestra tra controllo e reclamo.
