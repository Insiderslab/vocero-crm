# Registro di lavoro — 2026-10-11 — 009 «Usabilità P1/P2» (test di usabilità E1–E10)

**Mandato:** correggere i rilievi di priorità 1/2 del test di usabilità di Heili CRM, fatto sulla produzione `e23332e`. Ogni rilievo è stato ricontrollato su `main` prima di toccare il codice. Spec `specs/custom-heili/009-usabilita-p1.md`. **Esecutore:** Claude (subagente). **Worktree:** `/home/user/crm-ux`, **branch locale:** `ux-p1`, base `origin/main` @ `0bc731e`, poi **ribasato su `4911355`** (PR #11, Sintesi e «Primi passi»). Nessun push, nessuna PR, nessuna chiamata a Meta o a un provider IA, nessun dato reale: PostgreSQL 16 usa e getta su `127.0.0.1:5433`, basi `vocero_ux_*`.

## Commit (dopo il rebase)

| # | Commit | Rilievo |
|---|---|---|
| 1 | `de48a47` fix(i18n): titolo della scheda | E9 |
| 2 | `403435f` docs(spec): 009 | — |
| 3 | `c6061bd` fix(inbox): ordine deterministico dei messaggi | E4 |
| 4 | `f4796e2` feat(E1): secondo tentativo, cortesia, posta, avviso | E1 |
| 5 | `883b4ec` fix(E2): lingue mescolate | E2 |
| 6 | `86462ef` fix(E3/E6): stati di caricamento, `loading.tsx` | E3/E6 |
| 7 | `7f574fc` fix(E5): niente raffiche di prefetch `?_rsc=` | E5 |
| 8 | `d238529` fix(E7/E8/E10): rifiniture visive | E7, E8, E10 |
| 9 | `fd38f70` fix(E6): il clic prima dell'idratazione non si perde | E6 |
| 10 | `206b049` test(e2e): sezione 009 e auto-test nel browser | tutti |
| 11 | `16e3ab8` fix(E2): la Sintesi (PR #11) mostra le fasi tradotte | E2 (dopo il rebase) |
| 12 | questo registro e lo stato della spec | — |

## Cosa è stato fatto

### E1 (CRITICO) — il provider IA fallisce e il cliente non riceve risposta
Su `main` il comportamento era quello del rilievo: `runAgentTurn` passava a un umano con motivo `error` in silenzio.

- **(a) Secondo tentativo.** Con `provider_error` in una conversazione reale il turno **non** passa a un umano: programma **un** secondo tentativo dopo `AGENT_RETRY_MS`.
  - Default 60 000 ms; `0` lo spegne. La variabile è in `.env.example`, `docker-compose.yml` e `tests/golden/env.ts`.
  - Il timer è in memoria, come il coalesce, in una mappa separata (`__agentRetry`), così chi aspetta «il lavoro in corso» non resta appeso un minuto.
  - Il turno di ripresa passa dallo stesso lucchetto per conversazione (`runExclusive`).
  - **Non si ripete:** le decisioni pure stanno in `src/server/ai/failure.ts`. Un turno `retry` o `manual` non riprogramma mai.
  - **Non risponde due volte:** un entrante nuovo annulla il tentativo (`scheduleAgentTurn` → `cancelAgentRetry`). Al momento di ripartire, il tentativo controlla che l'ultimo messaggio sia ancora quell'entrante: se intanto ha risposto l'operatore, non fa nulla. Se c'è già un turno in corso o in attesa, salta: quel turno risponde a tutto.
  - `invalid_output` resta come prima: ha già fatto i 3 tentativi di `chatJson`. Il Laboratorio fa handoff subito, senza secondo tentativo.
- **(b) Messaggio di cortesia.**
  - `agent_profile.error_reply`: migrazione `drizzle/0015_agent_error_reply.sql`, generata con `drizzle-kit generate`. Ha `SET LOCAL lock_timeout = '5s'` come 0013/0014; lo snapshot 0015 discende da 0014 e un secondo `generate` dice «No schema changes».
  - Si invia **una volta**, con `sendText` (finestra 24 h, sandbox, credenziali). Parte solo se il turno ha fatto davvero la transizione a umano e se dopo l'ultimo entrante non c'è già un uscente con quel testo.
  - Vuoto = spento. Se l'invio non riesce, resta nel log.
  - Campo nella sezione «Comportamento» della pagina Agente IA, in es/en/it. L'API accetta `errorReply` (trim, ≤ 1000, vuoto → null).
- **(c) Posta.**
  - Filtro «Assistenza umana» con conteggio, accanto a Tutte e Non lette.
  - Le conversazioni con handoff vanno in cima (ordinamento stabile, lato client).
  - Etichetta con il motivo: per `error` è «Errore del provider IA», in rosso. Aggiunto anche il motivo `hostilidad`, che prima non aveva testo.
  - Pulsante «Riprova risposta IA» nel pannello. Usa `POST /api/conversations/[id]/agent-retry` con `withAuth`: owner, admin e member, come «Riattiva IA». La rotta è nell'inventario dei ruoli.
  - Risposte della rotta: 404 se la conversazione non è dell'organizzazione o è del Laboratorio; 409 `ai_not_configured` o `agent_disabled`, senza cambiare nulla; altrimenti 202. In quel caso toglie l'handoff e lancia un turno subito, con `after()`. Se il provider è ancora giù, l'handoff `error` è immediato e la cortesia non si ripete.
- **(d) Avviso in app.**
  - Nuovo evento SSE `conversation.handoff` `{ conversationId, reason, contactName }`. Lo pubblicano `applyHandoff` e `/api/bot/handoff`.
  - In ogni pagina compare un toast con link alla conversazione (`/inbox?conversation=`).
  - Nessun servizio esterno.
  - In più: `useEvents` ora condivide **una** connessione SSE per scheda. Prima la barra laterale, la posta e il Laboratorio aprivano ognuno la propria.
- `applyHandoff` agisce solo nella **transizione** (`handoff_at IS NULL`): non sovrascrive motivo e ora di un handoff già attivo.

### E2 (ALTO) — lingue mescolate (+ E9)
- **Fasi.**
  - Un'organizzazione nuova nasce nella lingua di chi la crea. Alla registrazione la lingua viene da `localeFromHeaders`: cookie, poi `Accept-Language`, poi il default `it`. Dal pannello admin è la lingua del super-admin.
  - In visualizzazione, una fase che conserva **esattamente** un nome di fabbrica, in una qualsiasi delle tre lingue, si mostra tradotta (`src/lib/stages.ts`). Una fase rinominata si mostra com'è. Vale per pipeline, gestore, pannello, cassetto, posta, contatti e Sintesi.
  - Il gestore non rinomina se si lascia l'etichetta tradotta (`isStageRename`). La demo trova le fasi per chiave.
  - **Nessun dato esistente riscritto.**
- **Default di un'organizzazione nuova.**
  - Valuta EUR per l'italiano, altrimenti il default dell'istanza (MXN): `defaultCurrencyFor`, data-driven. Viene scritta nella marca alla creazione e solo se `metadata` è vuota. Le organizzazioni esistenti non cambiano: si modifica in Impostazioni → Marca.
  - Il nome iniziale («Attività di …») segue la lingua.
  - Il segnaposto del nome del modello WhatsApp è tradotto. Lingua e corpo del modello erano già per lingua su `main`.
- **Formati e testi.**
  - Date e importi con `Intl` nella lingua dell'interfaccia (`intlLocale`): posta, separatore, pipeline, Laboratorio, automazioni, chiavi API. Prima era tutto fisso su `es-MX`.
  - Tradotti: la scheda del lead (prima tutta in spagnolo: «Ficha / Todavía vacía», anche Sì/No), i nomi delle persone del Laboratorio (per chiave) e l'etichetta dell'interruttore del tema.
- **E9.** La causa non era l'i18n lato server. `getT()` funziona: la chiave chiamata non esisteva. Il layout chiedeva `meta.titleSuffix` e `meta.description`, ma le chiavi vivono in `common.meta.*`, e `translate()` restituisce la chiave cruda quando non la trova. C'è un test nuovo che esige che **ogni** chiave letterale `t("…")` del codice esista in es/en/it: oggi trova solo quelle due.

### E3/E6 — stati di caricamento e primo clic perso
- **E3.** Scheletri (`role="status"`, `data-loading`) in contatti, posta (lista e filo appena scelto), pipeline, agente, Laboratorio e automazioni. Mai più lo stato vuoto («Nessun contatto») durante il caricamento. Se il primo caricamento fallisce, compaiono il messaggio e «Riprova»: prima l'agente restava su «Caricamento…» per sempre.
- `src/app/(app)/loading.tsx`: la navigazione mostra subito lo scheletro. È anche un confine di Suspense attorno alla pagina.
- **E6, causa.** Due meccanismi, entrambi verificati:
  1. **Prefetch fallito = navigazione a pagina intera.** In `next/dist/client/components/router-reducer/fetch-server-response.js` (riga ~123), una risposta RSC non 200 diventa `doMpaNavigation(url)`. Il risultato resta nella cache dei prefetch, e al clic `navigate-reducer.js` (riga ~222) fa `handleExternalUrl`, cioè ricarica tutto il documento. In produzione i `?_rsc=` di prefetch tornavano 503 (E5): la «navigazione» successiva era quindi un ricaricamento completo.
  2. **Clic prima dell'idratazione.** Dopo un caricamento completo, l'HTML del server si vede, ma finché il JS non è caricato e React non ha idratato nessuno ascolta. Il primo clic su «Gestisci fasi» o sull'accordion si perdeva.
- **E6, correzione.** `src/lib/click-replay.ts` è uno script inline nel `<head>`. Prima dell'idratazione conserva e ferma l'ultimo clic su un controllo senza comportamento nativo: pulsanti fuori dai moduli, `role=button/switch/tab`. Quando `HydrationMark` segnala l'idratazione, lo ripete una volta, se l'elemento c'è ancora e il clic ha meno di 5 s. Link e pulsanti di modulo non si toccano.
- **Prova nel browser** (Playwright + Chromium, clic subito dopo il `commit` della navigazione su «Gestisci fasi»):

  | Ambiente | Base `0bc731e` | Questo branch |
  |---|---|---|
  | `next dev`, senza lo script (sabotaggio) | — | **0/6** |
  | `next dev`, con lo script | — | **6/6** |
  | build di produzione, cache fredda, rete 150 ms / 200 KB/s, CPU ×6 | **0/8** | **8/8** |
  | build di produzione, cache calda, rete 150 ms / 200 KB/s, CPU ×6 | **7/8** (perso il primo, a cache vuota) | 8/8 |
  | build di produzione, localhost senza rallentamenti | 10/10 | 10/10 |

### E4 — ordine dei messaggi
- **Causa.** Il filo si ordinava solo per `created_at`, senza un secondo criterio. Lo storico di coexistence (e la demo) scrive `created_at` = timestamp di Meta, **al secondo**. Una domanda e una risposta nello stesso secondo tornavano quindi in ordine fisico, cioè arbitrario: la risposta prima della domanda. Il client non riordina: aggiunge per SSE nell'ordine di pubblicazione e sostituisce col refetch.
- I messaggi in tempo reale hanno `created_at = now()` del DB (microsecondi). Un `wa_timestamp` al secondo serve solo a mostrare l'ora.
- **Correzione:** `MESSAGE_CHRONOLOGY` = `created_at`, poi direzione (`in` prima di `out`: una risposta non può precedere ciò a cui risponde), poi `id`. Si usa in API, anteprima, contesto dell'IA, trascrizione del Laboratorio ed export.

### E5 — `?_rsc=` risponde 503 in produzione
- **Dal codice:** né l'app né Next producono un 503 per una pagina o un RSC.
  - `grep` su `node_modules/next/dist/server`: nessun `503`.
  - Nell'app il 503 esiste solo in `/api/health` (DB giù) e per `meta_unavailable`.
  - Non c'è `middleware.ts`. Il rate limit (`lib/rate-limit`) risponde 429 ed è solo su login e API key.
  - Il `HEALTHCHECK` del Dockerfile non c'entra.
  - **Il 503 lo produce il proxy davanti all'app** (il Caddy condiviso del VPS, la cui configurazione non è nel repo).
- **Cosa hanno di diverso queste richieste:**
  - sono **raffiche**: al caricamento di ogni pagina, il build di base apriva **7 `?_rsc=` in parallelo**, uno per ogni link del menu (misurato con Chromium sul build di produzione);
  - in pipeline e contatti c'era anche un `<Link>` per scheda o riga;
  - ognuna è un render dinamico: sessione, marca, organizzazioni.
- **Ipotesi principale:** un limite di concorrenza o un health check passivo del Caddy (`unhealthy_request_count`, `max_conns`, `fail_duration`, `lb_try_duration`) risponde 503 alle richieste che superano la soglia. **Da confermare in produzione.**
- **Mitigazione nel codice:**
  - il menu laterale precarica solo per intenzione (puntatore, focus, tocco): una richiesta alla volta, al massimo una per link ogni 30 s (`lib/intent-prefetch.ts`);
  - i link per scheda o riga e quello dell'avviso hanno `prefetch={false}`;
  - misurato sul build di produzione: **0** `?_rsc=` al caricamento di `/pipeline`, `/contacts` e `/inbox`, contro **7** della base.
- **Comandi per l'owner, in sola lettura** (container e servizi come in `docs/mandati/PROMPT-DEPLOY-FASE4.txt`; adattare i nomi):
  ```bash
  # 1. Configurazione del proxy: cercare limiti e health check
  docker ps --format '{{.Names}}\t{{.Image}}' | grep -i caddy
  docker exec <caddy> cat /etc/caddy/Caddyfile | grep -n -A15 'crm.heili.cloud'
  docker exec <caddy> cat /etc/caddy/Caddyfile | grep -n -E 'unhealthy_request_count|max_conns|fail_duration|lb_try_duration|health_|rate_limit|unhealthy_latency'
  # 2. I 503 nei log del proxy (servono i log di accesso attivi) e nell'app
  docker logs <caddy> --since 2h 2>&1 | grep -E '"status": ?503|" 503 ' | grep -c '_rsc='
  docker logs <caddy> --since 2h 2>&1 | grep -E '503' | head -20
  docker logs vocero-app --since 2h 2>&1 | grep -iE 'error|uncaught' | tail -50
  docker inspect --format '{{json .State.Health}}' vocero-app
  # 3. Un RSC singolo e poi una raffica di 8 (GET in sola lettura; il cookie di
  #    sessione si copia dal browser: non incollarlo in chat né nei log)
  C='better-auth.session_token=<dal browser>'
  curl -sI 'https://crm.heili.cloud/pipeline?_rsc=probe' -H 'RSC: 1' -H 'Next-Router-Prefetch: 1' -H "Cookie: $C"
  for p in inbox pipeline contacts automations agent lab settings admin; do
    curl -s -o /dev/null -w "$p %{http_code} %{time_total}s\n" "https://crm.heili.cloud/$p?_rsc=probe$RANDOM" \
      -H 'RSC: 1' -H 'Next-Router-Prefetch: 1' -H "Cookie: $C" &
  done; wait
  ```
  Se la richiesta singola dà 200 e la raffica dà dei 503, la causa è il limite del proxy. Il codice nuovo non produce più raffiche; se si vuole, si può anche alzare il limite nel Caddy.

### E7/E8/E10 — rifiniture visive
- **E7.**
  - Ora, insegne e spunte dentro la bolla in uscita usano token propri: `--bubble-out-meta` 4,8:1 in chiaro e 9,7:1 in scuro; la spunta di lettura `--bubble-out-tick-read` 4,2:1. Prima erano `--text-4`: **1,28:1** sul verde.
  - Allo stesso modo posizione e contatti allegati nella bolla in uscita.
  - Il separatore della data era tagliato perché il filo parte già scrollato in fondo: il separatore restava a metà sul bordo. Ora è figlio diretto del contenitore con scroll ed è `sticky`, come in WhatsApp. Verificato con screenshot a 390 px.
- **E8.** Il piede della barra laterale è su due righe: nome e ruolo, poi lingua, tema ed esci. Prima in 224 px stavano avatar, nome, ruolo e tre pulsanti, e la lingua copriva «Proprietario». Il nome ha `title`; un admin non appare più come «Team».
- **E10.** `src/components/ui/switch.tsx`: `role="switch"`, `aria-checked`, nome accessibile, `aria-describedby` sul testo «Acceso/Spento». La manopola si vede in entrambi gli stati: da spento è grigia su un binario chiaro con bordo, da acceso bianca sull'accento. Prima era bianca su `bg-secondary`, quindi invisibile. Usato nella pagina Agente e nel pannello del contatto.
- **Pipeline.** Il piede della colonna non si mostra se nessuna scheda ha un importo (chiave `pipeline.footer.empty` tolta).

## Test

- **Unità**, 74 nuovi in 8 file:
  - `i18n-keys`, `agent-failure`, `inbox-handoff`, `i18n-locale-defaults`, `loading-states`, `intent-prefetch`, `visual-polish` (contrasto WCAG calcolato dai token CSS), `click-replay` (lo script vero su un DOM minimo);
  - il fixture di `bot-profile` ha `errorReply`.
- **Golden con PostgreSQL reale:** `tests/golden/usabilita.golden.test.ts`, 16 casi con asserzioni esplicite, senza istantanee:
  - E4: due casi;
  - E1: sei sul secondo tentativo (riesce; fallisce con cortesia una volta ed evento SSE; senza cortesia; entrante nuovo; risposta dell'operatore; Laboratorio), tre su «Riprova» e uno sulla transizione;
  - E2: quattro (it, es, marca già salvata, demo su fasi italiane).
  - Il harness ha `aiWillFail(n)` e `recordedSse()`, e in teardown annulla i tentativi programmati.
- **E2E API** (`scripts/e2e-selftest.mjs`, sezione «009», 18 controlli), contro `next dev` con mock su porta 3300, `AGENT_COALESCE_MS=500` e `AGENT_RETRY_MS=4000`. L'ai-mock risponde 503 ai testi `mock-proveedor-caido` (sempre) e `mock-proveedor-intermitente` (prime 3 chiamate).
- **E2E nel browser** (`scripts/e2e-usabilita.mjs`, Playwright + Chromium, 36 controlli): scheletri con l'API trattenuta, primo clic, filtro, etichetta e «Riprova», toast in un'altra pagina e il suo link, contrasto calcolato dagli stili, separatore visibile, piede senza sovrapposizioni, interruttore, fasi tradotte in it/en, titolo.

### Gate (binari diretti, niente `pnpm`), sullo stato finale ribasato su `4911355`
- `tsc --noEmit` e `eslint .`: verdi.
- `vitest run`: **79 file, 1167 test** (1093 di `main` + 74 nuovi).
- Golden su una base **nuova** (`vocero_ux_golden_final`): **137/137** (121 di `main` + 16 nuovi).
- `next build`: verde.
- E2E API su base nuova (`vocero_ux_e2e_final`): **170/170**. Dopo: `channels_legacy_check()` V1–V6 = 0; nel log nessuna «doppia scrittura … fallita».
- E2E nel browser sulla stessa istanza: **36/36**.

### Golden modificati (dichiarati)
`tests/golden/__golden__/agent.json`: **+18 / −0**. Nei due casi con handoff (`modelo`, `ventana`) compare un evento SSE in più, `conversation.handoff` con `contactName: "Ana Golden"`. Nessun altro campo cambia. È additivo e serve all'avviso E1d: un evento proprio, invece di dedurre un handoff dalla forma di un `conversation.updated`. Gli altri `__golden__` sono identici a `origin/main`.

## Sabotaggi

Metodo: uno script nello scratchpad (non versionato) cambia **un** frammento, esegue i test indicati e rimette il file com'era. A fine corsa `git status` è pulito.

| Sabotaggio | Test che lo vede |
|---|---|
| E9: layout con `meta.titleSuffix` | unità i18n-keys: 4 rossi |
| E4: ordine solo per `created_at` (filo, anteprima) | golden: 1 rosso |
| E4: ordine discendente solo per `created_at` (contesto IA) | golden: 1 rosso |
| E1: `retry` e `manual` riprogrammano (ciclo) | golden: 5 rossi; unità: 1 |
| E1: secondo tentativo senza `retryStillValid` | golden: 1 rosso (l'operatore risponde) |
| E1: un entrante nuovo non annulla il tentativo | golden: 1 rosso |
| E1: cortesia senza il controllo «già inviata» | golden: 1 rosso |
| E1: `applyHandoff` senza `isNull(handoff_at)` | golden: 1 rosso |
| E1: cortesia anche nel Laboratorio | unità: 1 rosso |
| E1: nessun evento `conversation.handoff` | golden: 2 rossi |
| E1: «Riprova» senza il controllo sull'agente spento | golden: 1 rosso |
| E1: handoff subito (secondo tentativo tolto) | golden: 6 rossi |
| E1: rotta `agent-retry` con `withAdminAuth` | unità route-roles (AST): 1 rosso |
| E2: semina sempre in spagnolo | unità 1, golden 1 |
| E2: `stageLabel` non traduce | unità: 3 rossi |
| E2: valuta sempre MXN | unità 1, golden 1 |
| E2: la semina sovrascrive una marca salvata | golden: 1 rosso |
| E2: demo senza ricerca per chiave | golden: 1 rosso |
| E2: cookie di lingua ignorato | unità: 1 rosso |
| E2: il gestore rinomina con l'etichetta tradotta | unità: 1 rosso |
| E3: contatti che partono da `[]`; Laboratorio senza attesa; pipeline senza scheletro | unità: 1 rosso ciascuno |
| E5: prefetch per intenzione senza deduplica; link del menu con prefetch di default; schede della pipeline con prefetch | unità: 1 rosso ciascuno |
| E6: lo script non ferma il clic / non lo ripete | unità: 1 rosso ciascuno; browser senza script 0/6 |
| E7: token della meta col grigio di prima; ora in `text-4` | unità: 1 rosso ciascuno |
| E8: admin mostrato come «Team» | unità: 1 rosso |
| E10: manopola con lo stesso colore acceso e spento | unità: 1 rosso |
| Piede della colonna vuoto ripetuto | unità: 1 rosso |

## Rebase su `origin/main` @ `4911355` (PR #11)

Due conflitti:
1. `src/components/automations/automations-client.tsx`: la firma con `onboarding` di PR #11 contro il mio `const { t, locale } = useT()`. Tenute entrambe.
2. `scripts/e2e-selftest.mjs`: `sintesiSection` (PR #11) e `usabilitySection` (009) aggiunte nello stesso punto. Tenute entrambe, nell'ordine Sintesi → 007 → 009 → coexistence.

Dopo il rebase la pagina Sintesi mostrava le fasi col nome grezzo: commit 11. Nuova voce `/dashboard` del menu: passa dallo stesso `NAV`, quindi ha il prefetch per intenzione (la vigilanza lo controlla). Gate rifatti sullo stato finale (sopra).

## Aree degli altri lavori in corso

- PR #10 (`src/server/site-requests/*`, `src/app/api/public/*`, `src/app/api/settings/site/*`): **non toccate**.
- Refactor R2 (`src/server/inbox/ingest.ts`, `send.ts`, `src/server/whatsapp/*`): **non toccati**. Toccato solo `src/server/inbox/queries.ts`, a cui il refactor non fa riferimento: aggiunte `MESSAGE_CHRONOLOGY` e `MESSAGE_CHRONOLOGY_DESC` e cambiato l'`orderBy` di `listMessages` e dell'anteprima.
- Toccato anche `src/app/api/bot/handoff/route.ts`, per pubblicare l'avviso.

## Decisioni
- Il secondo tentativo scatta solo con `provider_error`, non con `invalid_output`, come chiesto.
- «Riprova» con il provider ancora giù fa handoff subito: il clic **è** il secondo tentativo.
- Cortesia e secondo tentativo esclusi dal Laboratorio: valuta il comportamento, non deve aspettare un minuto.
- L'avviso si mostra per ogni handoff deciso dall'agente o dal cervello esterno. La pausa per risposta dal telefono (`manual_reply`) no: la decide il proprietario stesso, e la sua pubblicazione è in `ingest.ts`, area R2.
- La traduzione delle fasi riconosce i nomi di fabbrica di **tutte e tre** le lingue, non solo lo spagnolo. Così un'organizzazione nata in italiano si legge in inglese per chi usa l'inglese.
- Valuta: solo `it → EUR`; per `es`/`en` resta il default dell'istanza (MXN), come chiesto.

## Rischi, cose non verificate, domande aperte
- **Numerazione 0015.** Anche la PR #10 (`/home/user/crm-web`) ha una `drizzle/0015_richieste_sito.sql`. Chi entra per secondo deve rinumerare: rigenerare la migrazione e snapshot/journal.
- **E5 non confermato in produzione:** servono i comandi sopra. La mitigazione riduce le raffiche ma non cambia il limite del proxy.
- **Tempi in memoria:** un secondo tentativo programmato si perde se il container riparte durante l'attesa. Il turno resta allora senza risposta e senza handoff, finché il cliente non scrive di nuovo o un operatore non lo vede in posta. Con più repliche ognuna ha i propri timer.
- `next dev` e la build di produzione sono stati provati in locale con Chromium (Playwright c'è nell'immagine: `/opt/pw-browsers/chromium-1194`). Non sono stati provati Safari, Firefox o un telefono reale, né il proxy di produzione.
- Le persone del Laboratorio sono tradotte nel nome; i **copioni** (i testi del cliente simulato) e la KB demo restano in spagnolo, perché sono dati che vede il modello.
- Le organizzazioni **esistenti** senza valuta salvata restano in MXN finché il proprietario non la cambia in Marca: è una scelta voluta, per non riscrivere dati.
- La CI su GitHub non è stata eseguita (nessun push).
