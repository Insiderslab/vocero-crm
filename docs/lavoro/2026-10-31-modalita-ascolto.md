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
