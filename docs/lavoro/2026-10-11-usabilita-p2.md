# Registro di lavoro — 2026-10-11 — 010 «Sintesi» e «Primi passi» (usabilità P2)

**Mandato:** prompt `PROMPT-DEEPSEEK-USABILITA-P2.md` (interventi di priorità 2 del
test di usabilità di Heili CRM: pagina «Sintesi» e checklist di primo avvio).
**Esecutore:** DeepSeek via OpenCode, sul PC di Stefano. **Cartella:** `heili-p2`,
**branch:** `feat/usabilita-p2-sintesi-avvio`, base `origin` @ `0bc731e`.
Nessun dato reale, nessuna chiamata a Meta o a provider, nessun tocco alla
produzione, nessuna cartella `heili-r2` toccata.

## Commit

1. `docs(spec): 010 …` — la spec (carril ligero), scritta prima del codice.
2. `test(sintesi): …` — golden su PostgreSQL vero + unità, prima del codice.
3. `feat(sintesi): …` — pagina, grafici, rotta degli aggregati, i18n es/en/it, voce di menu.
4. `test(avvio): …` — golden e unità della checklist, prima del codice.
5. `feat(avvio): …` — «Primi passi», avviso in Automazioni, riapertura dalle Impostazioni.
6. questo registro.

## Cosa è stato fatto

### 1. Pagina «Sintesi» (`/dashboard`)

- Voce «Sintesi» **prima** del menu, visibile a **qualsiasi membro**; la pagina
  iniziale dopo il login **non cambia** (resta la posta).
- `GET /api/dashboard/summary?days=7|30|90` (default 30; qualsiasi altro valore
  → 422). La rotta è nell'inventario `tests/unit/helpers/route-roles.ts` con
  politica `member` e il guardrail AST la verifica.
- `src/server/dashboard/summary.ts` calcola, in **cinque query aggregate in
  parallelo** e sempre con `scoped(...)`:
  1. conversazioni reali per **fase attuale** del lead del contatto, con il nome
     della fase **come salvato** (le fasi vuote escono in 0, ordinate per posizione);
  2. **prima risposta**: per conversazione, dal primo entrante del periodo alla
     prima saliente successiva; mediana e p90 con `percentile_cont`, in minuti;
  3. salientes IA (`ai_generated` vero/falso) + conversazioni con `handoff_at`
     nel periodo, divise per `handoff_reason`;
  4. **conversioni**: lead distinti che entrano a una fase `won` nel periodo,
     da `lead_stage_event` (`to_stage_kind = 'won'`), come da schema;
  5. **andamento**: entranti/salienti per giorno (`to_char` di `created_at`, UTC).
- Le conversazioni di test (`is_test`) sono escluse in ogni blocco; il periodo
  usa `created_at` per i messaggi, `handoff_at` per gli handoff, `occurred_at`
  per gli eventi di fase.
- UI: selettore 7/30/90, **scheletri** durante il caricamento (mai un falso
  zero), stato d'errore con «Riprova», stati vuoti espliciti. Grafici CSS a mano
  (vietate dipendenze nuove), con `aria-label` che porta i numeri e lista
  `sr-only` per il grafico giornaliero; tema chiaro/scuro e 390 px. Date e
  numeri con `Intl` nella lingua dell'interfaccia; etichette i18n es/en/it
  (moduli nuovi `dashboard` e, sotto, `onboarding`; nelle nav si aggiunge solo
  la chiave nuova).

### 2. «Primi passi» (checklist di primo avvio)

- `src/server/onboarding/checklist.ts`: **unica funzione** (`getOnboardingChecklist`)
  con una sola query di cinque `EXISTS`, sempre con `scoped(...)`:
  1. connessione attiva (`meta_credentials.status = 'connected'` **e**
     `app_disconnected_at` nullo — la coexistence staccata non conta);
  2. almeno una `template` `approved`;
  3. agente configurato: `instructions` non vuote **e** almeno una voce `kb_entry`;
  4. almeno una corsa del Laboratorio **terminata** (`agent_test_run.status = 'done'`);
  5. agente acceso (`agent_profile.enabled`).
- Componente `PrimiPassi` in cima a **Sintesi** e **Automazioni**, solo
  owner/admin, finché manca un passo; `showOnboardingChecklist` (con test) è
  l'unica regola di visibilità. È un componente **sincrono** (riceve `t` dal
  server) così i test delle pagine con `renderToStaticMarkup` non sospendono.
- **Riapertura dalle Impostazioni**: link in `settings/whatsapp` verso
  `/dashboard?primi-passi=1`, che forza la checklist anche se completa. Nessuno
  stato nuovo (niente cookie, niente BD, niente migrazione).
- In **Automazioni** il pulsante «Crea regola», quando è disabilitato, dice cosa
  manca: passi 1–2 (stessi booleani della checklist) più i campi del modulo.

## Test

- **Unità** (`vitest run --minWorkers=1 --maxWorkers=4`): **1081/1081 verdi**,
  70 file. Nuovi: `dashboard-charts` (5), `dashboard-summary-days` (2),
  `onboarding-visibility` (4); aggiornati `app-nav-roles` (voce prima e ruolo) e
  `admin-only-pages` (mock della checklist, il calcolo ha i suoi test).
- **Golden scritti, non eseguiti** (manca Docker su questo PC, come da prompt):
  `tests/golden/dashboard-summary.golden.test.ts` (7 casi, assert espliciti e
  numeri a mano: mediana 20 / p90 28 su risposte a 10/20/30 min; periodi 7 vs 90;
  isolamento A/B) e `tests/golden/onboarding-checklist.golden.test.ts` (6 casi,
  inclusa la connessione staccata e l'isolamento). Nessuna istantanea toccata.
- **Gate:** `tsc --noEmit` verde; `eslint .` verde; `vitest run` verde (sopra);
  `next build` verde (rotta `/dashboard` presente).
- **E2E e screenshot:** non eseguiti (senza Docker/PostgreSQL non parte l'app).

### Nota sul gate `pnpm test` "liscio"

Con il default di vitest e 12 core, due test **preesistenti e non miei**
(`GET /api/settings/whatsapp` e `wapi-key` per il ruolo `member`) possono andare
in timeout a 5 s per il carico (import dinamico delle rotte): passano in
isolamento e con worker limitati (1081/1081). Un terzo caso locale — non un
timeout — era un artefatto **CRLF di Windows**: `agent-form-sync.test.ts` legge
`agent-client.tsx` con regex ancorate a `$` e il file era `w/crlf` (indice LF).
Ho normalizzato **solo i fine riga nel working tree** di quel file (contenuto
identico all'indice, `git status` pulito): su Linux/CI era già verde.

## Sabotaggi

Metodo: script nello scratchpad (non versionato) che cambia **un** frammento,
esegue il test indicato e rimette il file com'era (ripristino verificato,
`git status` pulito).

| Sabotaggio | Test che lo vede |
|---|---|
| inventario: `dashboard/summary` da `member` ad `admin` | unità `settings-routes-guard` (AST): rosso |
| inventario: riga della rotta rimossa | unità `settings-routes-guard`: rosso |
| `showOnboardingChecklist` senza `isOrgAdmin` | unità `onboarding-visibility`: rosso |
| voce «Sintesi» con `adminOnly` (member non la vede) | unità `app-nav-roles`: rosso |
| `StageChart` senza `aria-label` | unità `dashboard-charts`: rosso |

**Non eseguibili qui** (richiedono PostgreSQL; dichiarati nella PR): scoping per
organizzazione e esclusione dei test nelle query della Sintesi, e i passi della
checklist — le difese hanno i casi golden scritti apposta (B con dati propri,
conversazioni `is_test`, connessioni staccate).

## Decisioni e domande aperte

- **Conversioni**: la fase «cliente» si identifica dallo schema come ancora
  `kind = 'won'` (il seme di `provisionOrganization` la chiama «Cliente»); si
  contano **lead distinti** e si includono gli eventi `approximate` (lo schema
  dice: contano per i totali, mai per i tempi).
- **Prima risposta**: solo conversazioni con risposta; la risposta può arrivare
  anche dopo il periodo (il primo entrante definisce il periodo). Senza questa
  scelta il p90 sarebbe dominato da conversazioni mai risposte.
- **Laboratorio** «valutazione eseguita» = corsa `done`; `running`/`failed` no.
- **Riapertura**: parametro di query. Se il team la vuole persistente per
  dispositivo, è il punto naturale per una coccola successiva (nessuna BD ora).
- **Indici**: candidati naturali `message (organization_id, created_at)` e
  `conversation (organization_id, handoff_at)`; **non creati** (nessuna
  migrazione, dati attuali piccoli). Da fare quando i volumi lo chiedano.
- **Ambiente**: Node 24 locale (il repo dichiara `>=20`; il prompt diceva 22);
  `pnpm` via `corepack pnpm` — `corepack enable` richiede permessi admin su
  `C:\Program Files\nodejs`.

## Rischi e cose non verificate

- **Golden e2e non eseguiti** (Docker assente): le query della Sintesi e la
  checklist sono verificate solo per compilazione e unità finché qualcuno non
  lancia `pnpm test:golden` su PostgreSQL 16 (nome base con «golden», porta 5434
  come da prompt). Numeri attesi scritti a mano: se un caso è sbagliato si vedrà
  lì, non qui.
- **Interfaccia non provata con clic reali** (niente app senza BD): grafici,
  scheletri e riapertura sono coperti da test di render e unità.
- **`pnpm test` default su questa macchina**: vedi nota sopra (flakiness da
  carico e artefatto CRLF), non un problema del codice.
- CI GitHub non eseguita prima del push.

## Verifica su PostgreSQL vero (Claude, worktree `crm-p2`, branch `p2-fix`)

Base: testa PR `fcadbae` + `0196222` (date come testo ISO con `::timestamp`
nelle query della Sintesi). PostgreSQL 16 usa e getta su `127.0.0.1:5433`.

### Cosa falliva e perché

- **7 golden rossi** (6 Sintesi, 1 checklist), tutti con «Received an instance
  of Date». **Bug dei TEST**: le fixture SQL passavano un `Date` come parametro
  grezzo a postgres-js, che con i serializzatori installati da Drizzle non lo
  accetta. Corretto passando testo ISO con `::timestamp` (come scrive Drizzle:
  colonne `timestamp` senza zona, ora UTC). Nessun numero atteso cambiato:
  ricalcolati a mano (mediana 20 e p90 28 su 10/20/30 min con
  `percentile_cont` lineare: 20 + 0,8·10; IA 3 / persona 1; handoff cliente 2,
  ventana 1; won = 2 lead distinti in A, 1 in B; giorni UTC). Dopo la
  correzione nessuna asserzione era sbagliata e il codice dava gli stessi numeri.
- **Bug di PRODOTTO** trovati in revisione:
  1. **Prestazioni/scoping**: le quattro query su `message` filtravano solo
     `conversation.organization_id`; `EXPLAIN` (400k messaggi, 20 org) mostrava
     un **Seq Scan su tutti i messaggi di tutte le organizzazioni**. Ora anche
     `message.organization_id` via `scoped(...)`: piano su `message_org_conv_idx`.
  2. **Andamento**: i giorni senza messaggi sparivano e due barre di giorni
     lontani uscivano attaccate → serie continua con zeri (`fillDailyGaps`).
  3. **Accessibilità**: la lista `sr-only` del grafico giornaliero stava dentro
     `role="img"` (figli presentazionali, quindi muta) → il ruolo avvolge solo
     le barre.
  4. **Fuso**: il raggruppamento per giorno è UTC (scelta documentata nel
     codice); ora il titolo dice «(UTC)». Il testo vuoto delle fasi non parla più
     di «periodo» (sono lo stato attuale, non filtrato per periodo).
  5. **Ruoli**: `/dashboard` interrogava la checklist anche per un member (poi
     scartata). Ora come in Automazioni; test della pagina nuovo.
- Test aggiunti: golden IA/handoff con conversazione `is_test`; unità
  `dashboard-charts` (+5), `dashboard-page-primi-passi` (7); E2E sezione 010 (15).
- Rivisti senza difetti: `days` in lista bianca (7/30/90) e mai interpolato
  (solo la data ISO come parametro) — niente iniezione; ogni query con
  `scoped(...)`; `is_test` in ogni blocco su conversazioni (le conversioni non
  ne hanno bisogno: i contatti del Laboratorio non generano lead).

### Gate (binari diretti, niente `pnpm`)

- `tsc --noEmit` verde · `eslint .` verde
- `vitest run`: **71 file, 1093 test** verdi
- golden su base nuova (`vocero_golden_p2fix_all`): **13 file, 121/121**;
  `git diff origin/main -- tests/golden/__golden__` vuoto
- `next build` verde (`/dashboard`, `/api/dashboard/summary`)
- E2E `scripts/e2e-selftest.mjs` su base nuova (`vocero_p2fix_e2e`, migrata con
  `MIGRATIONS_DIR=./drizzle node scripts/migrate.mjs`) contro `next dev` con mock
  (porta 3310, `SUPERADMIN_EMAILS` = operatore E2E, Embedded Signup sintetico):
  **182/182**; dopo la corsa `channels_legacy_check()` V1–V6 = 0, nessun errore
  nel log del server.

### Sabotaggi (uno alla volta, file ripristinato)

| Sabotaggio | Esito |
|---|---|
| Sintesi: `conversationScope` senza organizzazione (e `messageScope` neutro) | golden «aislamiento»: rosso |
| Sintesi: conversioni senza `scoped(...)` | golden «conversiones»: rosso |
| Sintesi: `is_test` tolto da `conversationScope` | golden prima risposta, IA/handoff, andamento: 3 rossi |
| `showOnboardingChecklist` senza `isOrgAdmin` | unità `onboarding-visibility`: rosso (la pagina regge comunque: non calcola la checklist per un member) |
| pagina `/dashboard` calcola la checklist per tutti | unità `dashboard-page-primi-passi`: 4 rossi |

### Aperto

- **Prima risposta**: conta come risposta anche una saliente `failed` e un
  modello inviato da un'automazione; e un template di automazione conta come
  «persona» in IA contro persona (la spec dice solo `ai_generated`). Da decidere.
- Il controllo `messageScope` è di prestazioni: l'isolamento lo garantisce già
  `conversationScope`, quindi nessun golden lo vede se sparisce (lo vede solo
  `EXPLAIN`).
- Il giorno UTC non è il giorno locale dell'organizzazione (Messico/Italia): un
  fuso per organizzazione è il passo successivo.
- In Automazioni l'avviso «Manca: …» compare anche quando il pulsante è
  abilitato (WhatsApp non connesso ma modulo completo): informativo, non bloccante.
- Interfaccia ancora non provata con clic reali nel browser.
