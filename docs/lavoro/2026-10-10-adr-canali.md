# Registro di lavoro — 2026-10-10 — M1.1: ADR e specifica del livello canali

**Mandato:** piano CRM multicanale, pacchetto M1.1 (`docs/piani/PIANO-CRM-MULTICANALE.md` §3).
**Esecutore:** Claude (Opus 5.5).
**Branch locale:** `notte/adr-canali`, creato da `origin/claude/keen-ptolemy-l0kv8g` @ `810272a`.
**Tipo:** solo documenti.
**Vincoli rispettati:** nessun push, nessuna PR, nessuna chiamata a Meta o a Wapi, nessun dato reale letto.
**Stato dell'ADR:** **Proposto**. L'owner deve approvarlo (D1) prima di M1.2.

## Ripresa

Il worktree esisteva già (ripresa dopo il riavvio del container). C'erano due bozze non committate:
- `docs/adr/0001-livello-canali.md`, 561 righe, con le parti (a)–(g) e rischi/decisioni;
- `specs/005-livello-canali/spec.md`, 164 righe.

Mancavano `plan.md` e `tasks.md`. Le bozze sono state rilette, verificate a campione contro il codice (righe di `schema.ts`, della route del webhook, di `send.ts`, di `ingest.ts`, di `heili-dm`) e **completate**, non riscritte.

## Cosa è stato fatto

**ADR `docs/adr/0001-livello-canali.md`**
- **(b)** `wapi_credentials` di C3 (letta con `git show notte/c3-wapi`, `6146791`): decisa come credenziale di *trasporto* dell'organizzazione, non account di canale. In M1 non si migra.
  - Nuova guardia richiesta: trasporto deciso **per canale**, perché senza di essa una chiamata Instagram andrebbe a Wapi con la chiave del gateway.
  - Sesta verifica del backfill: `wapi_credentials` invariata.
- **(d)** Riepilogo dell'inventario aggiornato: `wapi_credentials`; moduli `inbox`/`whatsapp`/`ai` con 28 file importatori in `src/` e 12 file di test.
- **(h)** §3.8 nuovo, ordine di lavoro corretto con Meta: sviluppo in modalità sviluppo, prova reale, video, poi App Review.
  - Verifica sui documenti di heili-dm: «Dm Heili» è *Live* ma con solo accesso **Standard**, e **nessuna review fatta** (`heili-dm/PROGETTO-STATO.md:25`, `:67`, `:69`, `:81`; `docs/setup.md:202-218`; `GUIDA-OPERATIVA.md:116`; `MIGLIORIE-ROADMAP.md:55`; `META_APP_REVIEW.md` contiene solo bozze).
  - Vincolo di un solo URL di callback per oggetto e per app: il CRM non può ricevere i webhook Instagram dell'app di heili-dm.
- **(i)** §3.9 nuovo, validazione con due canali reali in M1: pacchetto **M1.6**, adattatore Instagram in modalità sviluppo, spento in produzione.
  - Criteri «astrazione validata»: suite di contratto, nucleo non toccato, test negativi, guardia del trasporto, prova reale dell'owner o dichiarazione che non è stata fatta.
  - **Vincolo di schema:** `wa_identity DROP NOT NULL` per i contatti solo-Instagram prima di R3, con il passo di rollback relativo.
- **(j)** Sezione rischi e decisioni rinumerata. D2 ora vale prima di M1.6. D6 precisato: l'unione dei contatti fino a R3 ha un limite. Nuove decisioni D13–D17 e 5 rischi nuovi.

**Spec `specs/005-livello-canali/spec.md`**
- Storia 6 (secondo canale reale, 7 scenari).
- FR-015…FR-020, SC-007 e SC-008.
- Casi limite per C3 e per i contatti senza identità WhatsApp; fuori ambito e supposti aggiornati.

**Piano `specs/005-livello-canali/plan.md`** (nuovo)
- Contesto tecnico e Constitution Check: II e VIII non conformi per M1.6, giustificati nel tracciamento della complessità.
- Struttura proposta del codice.
- **Inventario esatto file:riga** (§5.1–5.11):
  - `wa_identity`: 20 righe di codice in 8 file;
  - `wa_message_id`: 23 righe in 7 file, più mock e script E2E;
  - `meta_credentials`: 6 funzioni, 11 file chiamanti;
  - `wapi_credentials` (C3);
  - `/api/webhooks/wa`;
  - export e importatori di `src/server/inbox/*`, `src/server/whatsapp/*`, `src/server/ai/*`;
  - 17 punti di scrittura per la doppia scrittura;
  - consumatori della finestra e sandbox.
- Comandi per rigenerare l'inventario; sequenza delle migrazioni; elenco dei golden per file; sabotaggi; D-CI.

**Compiti `specs/005-livello-canali/tasks.md`** (nuovo): T001–T057 per fase (M1.2 → M1.6, poi R3), con test negativi e sabotaggi per ogni guardia nuova.

## Controlli prima del commit

| Comando | Esito |
|---|---|
| `pnpm install --frozen-lockfile` | ok (lockfile invariato) |
| `pnpm typecheck` | verde |
| `pnpm lint` | verde |
| `pnpm test` | 45 file, 349 test verdi |
| `pnpm build` | verde |
| `pnpm db:generate` | non eseguito: nessuno schema cambiato (solo documenti) |

**Test negativi e di sabotaggio:** nessuno in questo pacchetto, perché non aggiunge codice né guardie. Sono **specificati** per i pacchetti successivi: `plan.md` §7.1–7.4 e `tasks.md` T007, T009–T011, T021, T032, T034, T037, T043–T044, T051.

## Non verificato

- **Stato attuale dell'app «Dm Heili» nella console Meta.** Ho letto solo i documenti di heili-dm, al 31/08 e al 05/10. Una richiesta di review fatta dopo non risulterebbe. L'owner controlla (D14).
- **Vincoli Meta citati a memoria e non riconfermati qui** (nessun accesso a Meta né al web, per mandato), da riconfermare in K0:
  - un solo callback per oggetto webhook e per app;
  - esistenza e comportamento delle «app di test» derivate;
  - capacità di Instagram e Messenger (finestra, lunghezza del testo, tag);
  - nomi dei permessi Messenger.
- **Numeri di riga:** esatti su `810272a` e su `6146791` (C3) al momento della scrittura, ricavati con `grep` e controllati a campione con `sed`. Cambiano a ogni commit: `plan.md` §5.12 dà i comandi per rigenerarli.
- **Rollback di R1 con il migratore Drizzle** (immagine vecchia su DB con migrazione più recente): non provato. È un compito di M1.2 (T020).
- **Durata della migrazione ed `EXPLAIN`:** non misurati (M1.2).
- **ID deterministici del backfill:** `md5` troncato a 20 caratteri; collisioni teoricamente possibili, non calcolate. Da valutare in M1.2.

## Falle e segnalazioni (Legge Zero, inazione)

1. **Già segnalate dal registro C3, ancora presenti su `810272a`:**
   - `src/app/api/settings/whatsapp/route.ts:34` (`PUT`) non controlla il ruolo: un `member` può sostituire numero e token Meta;
   - `src/app/api/settings/webhook/route.ts:7-16` restituisce a qualunque ruolo l'URL con il segreto `META_WEBHOOK_VERIFY_TOKEN` e lo stesso valore in `verifyToken`. Senza `META_APP_SECRET` chi lo conosce può iniettare eventi.

   Con il livello canali (ADR §3.5) gli URL per canale riusano lo stesso segreto per i canali Meta. La pagina «Canali» (K1) deve mostrarli solo a owner e admin. Non corretto qui: fuori perimetro.
2. `message.wa_message_id` è univoco **sull'istanza** (`src/lib/db/schema.ts:349`) e l'ingesta fa `onConflictDoNothing` su quella colonna (`src/server/inbox/ingest.ts:307`, `:395`). Lo stesso `wamid` in due organizzazioni farebbe scartare in silenzio il messaggio della seconda. Improbabile con Meta, non verificato. Chiuso in R3 dall'indice per organizzazione (ADR §3.2).
3. Codice morto: `getOrCreateContact` (`src/server/inbox/ingest.ts:149-161`) non ha chiamanti. Da rimuovere con un `refactor:` dedicato (T057).
4. **Correzione al piano** (D15): `PIANO-CRM-MULTICANALE.md` mette M3 e K3/K4 «dopo l'App Review», ma la review richiede la funzione già funzionante. Non ho modificato il piano: un altro pacchetto (`notte/app-review`) lavora in parallelo sui materiali della review. Va corretto dopo l'approvazione dell'ADR.

## Decisioni per l'owner (dettaglio in ADR §6)

- **D1:** approvare l'ADR.
- **D2:** emendare la costituzione prima del merge di M1.6.
- **D13:** aggiungere M1.6 a M1. Cambia la visione, che dice «WhatsApp come unico adattatore» in M1.
- **D14:** quale app Meta per il CRM (proposta: un'app propria) e controllo nella console dello stato di review di «Dm Heili».
- **D15:** correggere l'ordine nel piano.
- **D16:** chi fa la prova reale con Meta e su quale ambiente.
- **D17:** Instagram spento in produzione fino a R3.
- Restano aperte D3–D12 della bozza.

---

## Terza tornata — rilievi della verifica su `0b5acd3`

**Mandato:** chiudere tutti i rilievi della verifica avversaria (esito «non regge»: un rilievo alto, uno medio, tre bassi). **Tipo:** solo documenti; commit nuovo sopra `0b5acd3`, nessuna riscrittura. Nessun push, nessuna chiamata a Meta o Wapi, nessun dato reale.

**Nota sulle sezioni precedenti di questo registro:** i conteggi d'inventario scritti sopra («20 righe in 8 file», «28 file importatori», ecc.) sono la cronaca di ciò che era stato fatto. La fonte è **solo** `plan.md` §5; l'ADR ora rimanda e basta.

### Rilievi e chiusura

| # | Gravità | Rilievo | Chiusura | Dove |
|---|---|---|---|---|
| 1 | alto | Rollback di R1 e recupero in R2 non sicuri per gli **aggiornamenti**: il backfill con `ON CONFLICT DO NOTHING` recupera solo gli inserimenti, e la verifica 1 conta soltanto le righe | **Riconciliazione all'avvio**: ogni immagine che legge le strutture nuove, prima di servire traffico, le riallinea alle colonne vecchie, **anche negli aggiornamenti** (due `UPDATE` su `channel_account`, il primo libera i numeri cambiati per tollerare lo scambio tra organizzazioni), e verifica V1–V7. Non dipende dal registro delle migrazioni. Modalità come costante del rilascio: R1 `avvisa`, R2/R3 `blocca`. Nuova **V2** campo per campo. Stop-first nei passaggi che coinvolgono R0 (D18). Alternative (trigger temporanei, divieto di rollback) valutate e scartate con motivazione | ADR §3.3 («Riconciliazione all'avvio», «Verifiche V1–V7»), §4, §6 (D18, rischi); spec Storia 3 (scenari 3–6), FR-006, SC-002; plan §3, §6 (prove 3–6), §7.1; tasks T011, T013b, T019–T021, T032, T054 |
| 2 | medio | Variabili d'ambiente di Instagram non definite | `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `INSTAGRAM_REDIRECT_URI`, `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`, ricavate dal codice di heili-dm (`lib/env.ts:32-37`, `:81-84`; `app/api/webhook/route.ts:22`; `app/api/instagram/connect/route.ts:27`). Firma solo con `INSTAGRAM_APP_SECRET`, mai ripiego su `META_APP_SECRET`; canale spento (404) se una variabile manca o non è valida; blocco `.env.example` con `REEMPLAZA_...` e guida, come chiede `CLAUDE.md`. Test e sabotaggi | ADR §3.5, §3.6 («Configurazione d'istanza»), §3.9, §6; spec Storia 6 (scenari 3 e 8), FR-021, supposti; plan §3, §7.3, §7.4; tasks T047, T048, T051 |
| 3 | basso | Sabotaggio mancante per `UNIQUE (channel, external_account_id)` e `UNIQUE (organization_id, channel, external_id)` | Aggiunti in ADR §3.7, T010 (test anche per l'indice delle identità) e T021 (due sabotaggi). Provati qui sul prototipo (sotto) | ADR §3.2, §3.7; tasks T010, T021; plan §7.1 |
| 4 | basso | Incoerenze: cinque/sei verifiche; inventario in due copie; vincoli Meta citati come fatti | Verifiche con nome (V1–V7) e **un solo elenco** in ADR §3.3: gli altri documenti rimandano per nome, senza numero. ADR §3.4 senza righe né conteggi, rimanda a `plan.md` §5 (unica fonte); tolto anche «28 file» da `plan.md` §4. «Da riconfermare in K0» accanto al vincolo del callback unico (§3.8, D14, rischi), alle capacità di Messenger (§3.6) e al segreto di firma di Instagram (§3.5) | ADR §3.3, §3.4, §3.5, §3.6, §3.8, §6; spec Storia 2/3, SC-002, supposti; plan §4, §6; tasks |
| 5 | basso | `message.channel`, CHECK e indici univoci in una sola migrazione transazionale | Scoperto in più: Drizzle 0.38.4 applica **tutte** le migrazioni pendenti in **una** transazione (`node_modules/…/drizzle-orm/pg-core/dialect.js:60-71`), quindi `CONCURRENTLY` è impossibile in un file Drizzle. Migrazione divisa in **fase A** (Drizzle, solo catalogo: `ADD COLUMN`, `CHECK … NOT VALID`, FK `NOT VALID`, `lock_timeout` 5 s), **fase B** (runner, fuori transazione: `CREATE UNIQUE INDEX CONCURRENTLY`, `VALIDATE CONSTRAINT`, gestione degli indici `INVALID`), **fase C** (riconciliazione a lotti). Tabella dei lock con le durate misurate | ADR §3.2, §3.3 («Sequenza dei lock»), §4; spec Storia 3 (scenario 7), FR-022; plan §2, §6; tasks T013, T013b, T020 |

### Prove sul prototipo (PostgreSQL 16.14 usa e getta)

Cluster temporaneo con `initdb` in una cartella di `/tmp` di proprietà dell'utente `postgres` (lo scratchpad non è raggiungibile da quell'utente), porta 55433, solo dati sintetici; fermato e cancellato a fine lavoro. Migrazioni `0000`–`0010` applicate con `scripts/migrate.mjs` del repo. Gli script del prototipo (fasi A, B e C, funzioni, scenari) stanno nello scratchpad della sessione e non sono committati: le funzioni sono riportate nell'ADR §3.3.

1. **Riconciliazione degli aggiornamenti.** Organizzazioni A e B con numero, C senza. Dopo R1, scritture «del codice vecchio» in SQL: A e B si **scambiano i numeri** (passando da un numero temporaneo, come imporrebbe `meta_credentials_phone_uq`), token di B ruotato, A in `reconnect_required`, C collega un numero, nuovi contatto, conversazione e messaggio.
   - Prima della riconciliazione: V1 = 1, **V2 = 2**, V3 = 1, V4 = 1, V5 = 1, V6 = 0.
   - Dopo: V1–V6 = 0; `channel_account` = (mcA, pB, cA, `reconnect_required`), (mcB, pA, cB2, `connected`), (mcC, pC); la conversazione di C ha il suo account.
2. **Sabotaggi della riconciliazione** (stesso scenario):
   - senza i due `UPDATE` (cioè il vecchio `DO NOTHING`): **V2 = 2**, la verifica lo vede;
   - senza il primo `UPDATE` (liberazione dei numeri): errore `duplicate key … channel_account_channel_ext_uq`, cioè fallisce chiuso;
   - senza i due `UPDATE` **e** senza V2: tutte le verifiche a 0 e `channel_account` con mcA → pA, mcB → pB, mentre `meta_credentials` dice il contrario. È il difetto del rilievo 1, e con lo scambio è peggio di uno scarto: i messaggi del numero pA, ora di B, andrebbero ad A (Legge Zero).
3. **Indici univoci:**
   - con l'indice, lo stesso numero in un'altra organizzazione è rifiutato (`channel_account_channel_ext_uq`), e una seconda identità con lo stesso ID esterno nella stessa organizzazione è rifiutata (`contact_identity_org_channel_ext_uq`); lo stesso ID esterno in un'altra organizzazione è ammesso;
   - **sabotaggio**, indici tolti: entrambi gli inserimenti passano (`INSERT 0 1`).
4. **FK verso un indice univoco:** la FK composta `contact_identity (organization_id, contact_id)` → `contact (organization_id, id)` si crea con il solo indice univoco creato `CONCURRENTLY`.
5. **Rollback di R1 e migratore:** su un DB con una migrazione registrata più recente di quelle dell'immagine (riga finta in `drizzle.__drizzle_migrations`), `scripts/migrate.mjs` di `810272a` stampa «migraciones aplicadas», esce con 0 e non applica nulla.
6. **Lock**, su 1 000 003 messaggi (279 MB), con una sonda (lettura + inserimento con `lock_timeout = 200 ms`) ogni 0,2 s:
   - migrazione della bozza di `0b5acd3` in un'unica transazione: `ADD COLUMN … CHECK` 0,19 s, `CREATE UNIQUE INDEX` 1,14 s, `UPDATE` 22,5 s, quindi **23,9 s di `ACCESS EXCLUSIVE`**; la sonda di lettura e quella di scrittura sono rifiutate per lock;
   - fase A ≈ 25 ms in tutto; fase B: indice `CONCURRENTLY` 1,35 s, `VALIDATE` del CHECK 0,20 s; fase C: account e conversazioni 11 ms, messaggi 29 s in 201 lotti da 5 000, verifiche 0,11 s. **0 sonde bloccate su 125**;
   - fase A con una transazione lunga aperta su `message`: l'`ALTER TABLE message` rinuncia dopo il `lock_timeout` (1 s nella prova) e l'intera fase A si annulla (`channel_account` non esiste).
7. **Lettura del codice:** nessun `.set(` con `waIdentity` in `src/`; gli `UPDATE` su `message` toccano solo `status` (`src/server/inbox/status.ts:58`) e `media_asset_id` (`src/server/inbox/ingest.ts:130`); `meta_credentials` si scrive solo in `saveCredentials` (upsert per organizzazione) e `markReconnectRequired` (`src/server/whatsapp/credentials.ts:75-124`), mai cancellata fuori dalla cascata. Per questo la riconciliazione riallinea gli aggiornamenti solo su `channel_account`, e le altre divergenze le fermano V3 e V5.

### Controlli prima del commit

| Comando | Esito |
|---|---|
| `pnpm install --frozen-lockfile` | ok (lockfile invariato) |
| `pnpm typecheck` | verde |
| `pnpm lint` | verde |
| `pnpm test` | verde: 45 file, 349 test |
| `pnpm build` | verde (exit 0) |
| `pnpm db:generate` | non eseguito: nessuno schema cambiato (solo documenti) |

**Guardie nuove o toccate:** in questo pacchetto nessuna guardia di codice. Le guardie progettate (riconciliazione, V2, i due indici, modalità `blocca`, variabili di Instagram) hanno test e sabotaggio **specificati** (ADR §3.7; plan §6, §7; tasks T010, T011, T021, T032, T048, T051) e quelle di DB sono già provate sul prototipo (sopra). Le prove definitive sono di M1.2 e M1.6, sul codice vero.

### Non verificato

- **Prototipo, non codice:** riconciliazione, verifiche e fasi sono SQL di prova eseguito con `psql`, non il runner di M1.2. Le scritture «del codice vecchio» sono `UPDATE` SQL, non le funzioni di R0: T011 e T020 le rifanno con le funzioni vere.
- **Misure su una macchina di sviluppo** con dati sintetici e una sola conversazione per organizzazione: le durate sono indicative. Mancano il volume e la forma di produzione, e la durata dell'avvio completo (soglia di 60 s: T020).
- **Comportamento di Coolify** al deploy (rolling se c'è un healthcheck, oppure stop-first): non verificato; serve per D18.
- **Riprova di Meta** delle consegne fallite durante un avvio stop-first: da riconfermare in K0.
- **Segreto di firma dei webhook Instagram** (app Instagram o app Facebook): da riconfermare in K0 e nella prova reale; heili-dm accetta entrambi.
- **Percorso nella console Meta** per id, segreto e URI di ritorno dell'app Instagram (citato nella guida di `.env.example`): da riconfermare in K0.
- **`ADD CONSTRAINT … USING INDEX`** non usato: la FK punta a un indice univoco, accettato da PostgreSQL 16 nella prova; non provato su altre versioni.
- Restano validi i punti «Non verificato» della prima tornata, tranne il rollback di R1 con il migratore Drizzle, ora provato con il migratore di `810272a` (da ripetere con l'immagine vera).

### Controllo rapido (Leggi §6)

1. **Zero:** nessun dato reale, nessun segreto, nessuna produzione. Il PostgreSQL usato è usa e getta, con dati sintetici, ed è stato cancellato. Il rilievo alto era un rischio d'isolamento (instradamento verso l'organizzazione sbagliata dopo uno scambio di numeri): ora è chiuso da riconciliazione e V2, con sabotaggi specificati.
2. **Prima:** test del repo verdi (tabella sopra). Test negativi e sabotaggi specificati per ogni guardia progettata, e provati sul prototipo per le guardie di DB. «Non verificato» scritto qui sopra.
3. **Seconda:** l'ordine è il mandato della verifica (rilievi in `notte-a2-results.json`, id `adr-canali`). Nessuna istruzione presa da contenuti letti (heili-dm, documenti, codice).
4. **Terza:** lavoro sul branch locale `notte/adr-canali` con un commit nuovo e questo registro. **Non pushato:** il mandato vieta push e PR. Il lavoro altrui non è toccato: heili-dm è stato solo letto, e i checkout in `/home/user` non sono stati modificati. Riuso: una sola funzione di riconciliazione e una sola funzione di verifica, chiamate dal runner e da `docs/ops`, senza copie delle query.
5. **Semplicità:** una sola fonte per le verifiche (ADR §3.3) e per l'inventario (`plan.md` §5). Scartati i trigger temporanei, che avrebbero aggiunto un secondo scrittore. Le ottimizzazioni (lotti, `CONCURRENTLY`) sono misurate.
6. **Dubbio:** D18 (stop-first) è una decisione nuova per l'owner. Le altre sono quelle già aperte.

**Decisioni per l'owner aggiunte in questa tornata:** D18 (stop-first nei passaggi che coinvolgono R0).
