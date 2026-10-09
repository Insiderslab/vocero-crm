---

description: "Compiti del livello canali comune (M1.2–M1.6)"
---

# Compiti: Livello canali comune (005-livello-canali)

**Input**: [spec.md](spec.md), [plan.md](plan.md), [ADR 0001](../../docs/adr/0001-livello-canali.md)

**Prerequisiti**:
- D1 (ADR approvato);
- C3 integrato (`notte/c3-wapi`, migrazione `0011`);
- per R3: M0.4 (backup e ripristino provati) e D10;
- per M1.6: D2, D13, D14.

**Test**: obbligatori. La spec li richiede (FR-012, FR-013), e le Leggi chiedono test negativi con due organizzazioni e un sabotaggio per ogni guardia nuova.

**Organizzazione**: fasi per pacchetto del piano (M1.2 → M1.6). Ogni compito indica la storia della spec che serve. Un pacchetto = un worktree, un esecutore e un registro in `docs/lavoro/`.

## Formato: `[ID] [P?] [Storia] Descrizione`

- **[P]**: parallelizzabile (file diversi, nessuna dipendenza aperta).
- **[US1..US6]**: storie di `spec.md`.

**Controllo prima di ogni commit (tutti i pacchetti):**
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build`;
- `pnpm db:generate` con `DATABASE_URL` fittizia se cambia lo schema, e migrazione committata;
- da T005 in poi, `pnpm test:golden` su un PostgreSQL usa e getta.

---

## Fase 1: Preparazione (M1.2, primo commit, codice applicativo invariato)

**Scopo:** fissare il comportamento di oggi prima di toccarlo.

- [ ] T001 [US1] Rigenera l'inventario con `plan.md` §5.12 su main+C3 e annota nel registro le differenze di riga rispetto a `plan.md` §5
- [ ] T002 [US1] Configura `vitest.golden.config.ts` e lo script `test:golden` in `package.json`. Senza `DATABASE_URL_GOLDEN` il test fallisce con un messaggio chiaro (niente `skip`)
- [ ] T003 [P] [US1] Crea `tests/golden/setup.ts` (migrazioni su DB pulito, organizzazioni A e B, ognuna con il suo numero) e `tests/golden/normalize.ts` (segnaposti per ID e orari, bearer → tipo)
- [ ] T004 [P] [US1] Crea fixture **sintetiche** in `tests/golden/fixtures/whatsapp/` partendo da `src/server/dev/wa-mock-inbound.ts` e dalla forma documentata da Meta (nessun payload reale, D12)
- [ ] T005 [US1][US2] Scrivi e **registra** i golden di `plan.md` §7.1 (inbound, status, echo, routing, webhook-auth, send, agent) sul codice invariato. Nello stesso commit: `__golden__/*.json`
- [ ] T006 [US1] Aggiungi alla CI il servizio `postgres:16` e il passo `pnpm test:golden` in `.github/workflows/ci.yml` (D-CI)
- [ ] T007 [US1] Sabotaggio dei golden di T005, uno per guardia di ADR §3.7 (sandbox, ordine stati→messaggi, `normalizeMx`, `onConflictDoNothing`, monotonìa, filtro organizzazione degli stati, pausa AI sull'eco): ogni inversione fa fallire almeno un golden. Esito nel registro

**Checkpoint:** golden verdi sul codice di oggi; CI con PostgreSQL verde.

---

## Fase 2: R1 — espandi (M1.2) 🎯 fondazione

**Scopo:** tabelle e colonne nuove, backfill, doppia scrittura; letture invariate.

### Test prima del codice

- [ ] T008 [P] [US2] `tests/golden/migration.golden.test.ts`: backfill su A e B. Ogni conversazione punta a un account della **sua** organizzazione; contatto e identità uno a uno
- [ ] T009 [P] [US2] Test della FK composta: un'identità di A con contatto di B → errore del DB; una conversazione di A con account di B → errore del DB
- [ ] T010 [P] [US2] Test di `UNIQUE (channel, external_account_id)`: lo stesso `phone_number_id` in B → rifiutato
- [ ] T011 [P] [US3] Test di idempotenza del backfill (due esecuzioni, nessun duplicato) e del recupero dopo scritture «vecchie» simulate

### Implementazione

- [ ] T012 [US2] `src/lib/db/schema.ts`: `channelAccount`, `contactIdentity`, `conversation.channelAccountId`, `message.channel` e `message.externalMessageId`, `UNIQUE (organization_id, id)` su `contact` e `channel_account`; prefissi `cha`/`ci` in `src/lib/db/ids.ts`
- [ ] T013 [US3] `pnpm db:generate`, poi completa a mano `drizzle/0012_*.sql` con FK composte, CHECK e il backfill di ADR §3.3 (senza `RAISE`). `wapi_credentials` non si tocca (FR-015)
- [ ] T014 [US1] Doppia scrittura in `src/server/whatsapp/credentials.ts:86`, `:121` (stessa transazione)
- [ ] T015 [US1] Doppia scrittura delle identità: `src/server/inbox/identity.ts:116`, `src/app/api/contacts/route.ts:160`, `src/server/lab/runner.ts:241`, `src/server/seed/demo.ts:187`
- [ ] T016 [US1] Doppia scrittura delle conversazioni: `src/server/inbox/ingest.ts:169`, `src/server/seed/demo.ts:205` (Laboratorio escluso)
- [ ] T017 [US1] Doppia scrittura dei messaggi: `src/server/inbox/ingest.ts:294`, `:383`, `src/server/inbox/send.ts:129`, `src/server/whatsapp/templates.ts:379`, `src/server/seed/demo.ts:216`
- [ ] T018 [US1] Aggiorna i mock della tabella nei test unitari toccati (es. `tests/unit/credentials.test.ts:22`) **senza** indebolire le asserzioni
- [ ] T019 [US3] Scrivi `docs/ops/rilascio-canali.md`: passi di R1, R2 e R3, le 6 query di verifica, il rollback per rilascio, le misure
- [ ] T020 [US3] Prove su PostgreSQL usa e getta (`plan.md` §6, punti 1–4 e 6): da zero ×2; dati simulati (≥ 100 000 messaggi, 2 organizzazioni); **immagine precedente su DB a `0012`**; backfill dopo scritture vecchie; durata ed `EXPLAIN`. Esiti e misure nel registro
- [ ] T021 [US2] Sabotaggi: togli `organization_id` dalla FK composta; togli la condizione `ca.organization_id = cv.organization_id` dal backfill; togli una doppia scrittura. Ognuno deve far fallire un test

**Checkpoint:** golden **invariati** e verdi; `pnpm test:e2e` verde; 6 verifiche a 0 su dati simulati. **Rilascio R1** (owner).

---

## Fase 3: R2 — adattatore WhatsApp e letture nuove (M1.3)

**Scopo:** WhatsApp dietro il contratto, comportamento identico; route per canale.

### Test prima del codice

- [ ] T022 [P] [US4] `tests/unit/channels/contract.ts`: suite di contratto (`plan.md` §7.2)
- [ ] T023 [P] [US4] `tests/unit/channels/fake/fake.test.ts`: un `FakeChannelAdapter` (solo nei test) passa la suite e l'ingesta del nucleo (US4, scenari 1–4)
- [ ] T024 [P] [US1] Golden puri `tests/unit/channels/whatsapp/parse.test.ts`: fixture → `InboundEvent[]`, ordine stati→messaggi
- [ ] T025 [P] [US4] Test della route `[channel]`: slug sconosciuto 404 senza leggere il body; token errato 404; firma errata 401

### Implementazione

- [ ] T026 [US4] `src/server/channels/types.ts` (ADR §3.1) e `src/server/channels/registry.ts`
- [ ] T027 [US1] `src/server/channels/whatsapp/{parse,send,capabilities,adapter}.ts`, spostando la logica di `src/server/inbox/ingest.ts:195-356`, `src/server/inbox/send.ts:373-406` e `src/server/whatsapp/template-events.ts`, a comportamento identico
- [ ] T028 [US1] `src/server/channels/core/*`: ingesta, identità, invio (ordine dei controlli di `send.ts:52-112`), stati, account, finestra da capacità (WhatsApp = `WINDOW_MS`)
- [ ] T029 [US1] `src/app/api/webhooks/[channel]/[webhookToken]/route.ts` con lo slug `wa`; rimuovi `src/app/api/webhooks/wa/` (stesso URL, ADR §3.5)
- [ ] T030 [US1] Letture nuove nei punti di `plan.md` §5.1–5.3 (`identity.ts`, `status.ts:43`, `bot/context`, `bot/typing`, `start-conversation`, `credentials.ts` come vista di `channel_account`). I contratti pubblicati restano invariati (FR-010)
- [ ] T031 [US1] `src/server/inbox/*` e `src/server/whatsapp/*` diventano moduli sottili con le stesse firme esportate (`plan.md` §4); nessun chiamante cambia import in questo pacchetto
- [ ] T032 [US3] `drizzle/0013_*.sql`: backfill ripetuto + `RAISE EXCEPTION` con le 6 verifiche. Sabotaggio: una riga disallineata → la migrazione fallisce e il container non parte
- [ ] T033 [US1] DTO dei messaggi: campo **additivo** `channel` in `serializeMessage` (`src/server/inbox/ingest.ts:437`); i golden HTTP accettano solo campi additivi dichiarati nel registro
- [ ] T034 [US1] Sabotaggi di `plan.md` §7.3: slug sconosciuto, ordine nel gestore, sandbox nel nucleo

**Checkpoint:** golden **senza modifiche** verdi; suite di contratto verde per WhatsApp e finto; `pnpm test:e2e` verde; test C3 verdi. **Rilascio R2** (owner) dopo D10.

---

## Fase 4: Scheda contatto per canale (M1.4)

- [ ] T035 [P] [US5] Badge e filtro del canale nella bandeja (`src/components/inbox/`), con stringhe es/en/it
- [ ] T036 [US5] Scheda contatto con più identità; proposta di unione con **conferma** di owner o admin; tabella `contact_merge_event` (audit). Fino a R3 l'unione di due contatti che hanno **entrambi** una conversazione reale è rifiutata (ADR D6). Test negativi: unire contatti di due organizzazioni → rifiutato (anche a livello di DB); unire due contatti con conversazioni reali prima di R3 → rifiutato, nessun dato perso
- [ ] T037 [US5] Sabotaggio: togli il controllo di ruolo dall'unione → un test fallisce

---

## Fase 5: L'agente AI conosce le capacità (M1.5)

- [ ] T038 [US5] La finestra si legge dalle capacità dell'account della conversazione in `src/server/inbox/send.ts:81`, `src/server/ai/pipeline.ts:125`, `src/server/inbox/queries.ts:130-131`, `src/server/automations/engine.ts:161`, `src/app/api/contacts/[id]/start-conversation/route.ts:60`. Il contratto di `src/app/api/bot/context/route.ts:116-117` resta invariato
- [ ] T039 [US5] Le automazioni filtrano i contatti con identità `whatsapp` prima di inviare modelli (rischio ADR §6)
- [ ] T040 [US5] Il prompt nomina il canale (`src/server/ai/prompts.ts:33`, `:68`); mock AI (`src/server/dev/ai-mock.ts`) e golden `agent` aggiornati **in modo dichiarato** nel registro

---

## Fase 6: Secondo canale reale — Instagram in modalità sviluppo (M1.6)

**Prerequisiti:** M1.3 chiuso; D2, D13 e D14 decisi. **Nessun agente chiama Meta.**

### Test prima del codice

- [ ] T041 [P] [US6] Fixture sintetiche Instagram (`object: "instagram"`, `entry[].messaging[]`, `is_echo`, allegato per URL) in `tests/unit/channels/instagram/fixtures/`, con l'origine annotata (documentazione Meta, `heili-dm/lib/meta/webhook.ts:207-241`)
- [ ] T042 [P] [US6] L'adattatore Instagram passa `runContractSuite` (`plan.md` §7.2)
- [ ] T043 [P] [US6][US2] Test negativi di `plan.md` §7.4: evento per B non scrive in A; stesso IGSID in A e B; callback OAuth con stato di A e sessione di B o di un `member` → rifiutato; `CHANNELS_ENABLED=whatsapp` → 404
- [ ] T044 [P] [US6] Test del trasporto per canale: organizzazione con chiave Wapi → nessuna richiesta a `WAPI_BASE_URL` e nessun bearer `hlp_` negli invii Instagram

### Implementazione

- [ ] T045 [US6] `src/server/channels/instagram/{parse,send,capabilities,adapter}.ts`, portato da `heili-dm@7ce1633` con la nota d'origine (file e righe). Le chiamate passano dal client Graph del CRM, con base URL configurabile
- [ ] T046 [US6] Trasporto per canale in `src/lib/meta/client.ts` (`resolveGraphTransport`): Wapi solo per `whatsapp` (FR-016)
- [ ] T047 [US6] `src/server/channels/instagram/oauth.ts` + `src/app/api/channels/instagram/{connect,callback}/route.ts`: stato con organizzazione, utente e nonce in cookie `httpOnly`, firmato con `BETTER_AUTH_SECRET`; solo owner e admin; token cifrato con `lib/crypto`; `secret_expires_at`
- [ ] T048 [US6] `CHANNELS_ENABLED` in `src/lib/env.ts` e `.env.example` (placeholder e guida inline, regola delle credenziali di `CLAUDE.md`); il registro filtra gli slug
- [ ] T049 [US6] Migrazione `wa_identity DROP NOT NULL` (ADR §3.9, «Vincolo di schema»), poi gestione del NULL in `bot/context`, `export/contacts`, `start-conversation` e invio, con test: contatto solo-Instagram non visibile via `?waIdentity=`, export senza stringa vuota. Il CHECK di `channel` comprende già `instagram` da R1. Altre colonne (es. `media_asset.source_url`) solo additive, con `pnpm db:generate`
- [ ] T049b [US3] Passo di rollback R2→R1 per ambienti con Instagram acceso in `docs/ops/rilascio-canali.md` (verifica `wa_identity IS NULL` = 0); test che la verifica 2 di ADR §3.3 accetta i contatti senza identità WhatsApp
- [ ] T050 [US6] Mock Instagram di sviluppo dietro `src/lib/dev-guard.ts` ed estensione di `pnpm test:e2e` (DM in entrata, risposta, eco)
- [ ] T051 [US6] Sabotaggi: firma Instagram facoltativa; filtro per canale del trasporto rimosso; stato OAuth senza organizzazione; `CHANNELS_ENABLED` ignorato. Ognuno deve far fallire un test
- [ ] T052 [US6] Controllo «astrazione validata» (ADR §3.9): `git diff --stat` su `src/server/channels/core/`, `src/server/ai/` e sulla route `[channel]` vuoto. Se non è vuoto: fermarsi e proporre la revisione dell'ADR
- [ ] T053 [US6] Prova end-to-end reale **dell'owner** in modalità sviluppo (D16). L'esito, o «non eseguita» con il motivo, va nel registro (SC-008)

**Checkpoint di fine M1:**
- spec SC-001…SC-008;
- piano «Pronto quando» (test esistenti + golden verdi, test E2E WhatsApp dell'owner riuscito, migrazione provata su copia).

---

## Fase 7: R3 — contrai (rilascio successivo, non in M1)

- [ ] T054 [US3] `drizzle/0015_*.sql` (numero secondo l'ordine reale dei merge): backfill + verifiche + `DROP` di ADR §3.3; indice della conversazione `(organization_id, contact_id, channel_account_id)` (D6); arbitro `ON CONFLICT` per organizzazione
- [ ] T055 [US3] Rimozione della doppia scrittura e delle letture vecchie; `waIdentity` del bot e dell'export ricavati da `contact_identity` (contratti invariati)
- [ ] T056 [US3] Prerequisiti verificati e scritti: R2 in produzione da ≥ 7 giorni, backup ripristinato con successo, test E2E WhatsApp dell'owner riuscito
- [ ] T057 Commit `refactor:` separato: rimuovi `getOrCreateContact` (`src/server/inbox/ingest.ts:149-161`, nessun chiamante) e i moduli sottili senza più chiamanti (Leggi §3.5)

---

## Dipendenze e parallelismo

- Fase 1 → Fase 2 → Fase 3 in sequenza (golden prima di R1; R1 in produzione prima di R2).
- Fasi 4, 5 e 6 in parallelo dopo la Fase 3, su file diversi (al massimo 3 pacchetti attivi, piano §2). La Fase 6 tocca `src/lib/meta/client.ts`: nessun altro pacchetto lo tocca nello stesso momento.
- Fase 7 solo dopo D10 e M0.4.
- Fuori da questo elenco, in parallelo: K0 e K7, nell'ordine di ADR §3.8 (i video dopo T053).
