# Registro di lavoro — 2026-10-10 — M1.2, fase 2 «R1 — espandi» (livello canali)

**Mandato:** `specs/005-livello-canali/tasks.md`, compiti T008–T021 (fase 2 di M1.2), con ADR 0001 approvato dall'owner il 10/10/2026. **Esecutore:** Claude (subagente dell'orchestratore). **Worktree:** `/home/user/crm-m1p2`, **branch locale:** `m1-expand`, base `origin/main` @ `e23332e` (golden della fase 1 già dentro). Nessun push, nessuna PR, nessuna chiamata a Meta, a Wapi o a un provider AI, nessun dato reale: solo PostgreSQL 16 usa e getta (`127.0.0.1:5433`) con basi proprie (`vocero_m1p2_*`, `vocero_m1_*`).

## In breve

- **Schema nuovo** (ADR §3.2): `channel_account`, `contact_identity`, `conversation.channel_account_id`, `message.channel` e `message.external_message_id`, indice univoco `(organization_id, id)` su `contact`, FK composte con `organization_id`. Prefissi `cha`/`ci`.
- **Migrazione in tre fasi** (ADR §3.3): `drizzle/0013_loving_stone_men.sql` (fase A, solo catalogo) + `scripts/migrate-channels.mjs` (fase B online e fase C riconciliazione + V1–V7), chiamato da `scripts/migrate.mjs` a **ogni** avvio. R1 è in modalità `avvisa` (costante).
- **Doppia scrittura** in tutti i punti di scrittura (anche quelli nuovi della coexistence), nella stessa transazione della scrittura vecchia. **Le letture non cambiano.**
- **Golden invariati:** i 77 golden della fase 1 passano senza toccare `__golden__/` (`git diff e23332e -- tests/golden/__golden__` vuoto). Nuovo file `migration.golden.test.ts` (15 casi, T008–T011 + doppia scrittura + fase B).
- **E2E:** `scripts/e2e-selftest.mjs` 125/125 contro R1 (`next dev` con i mock); dopo la corsa V1–V6 = 0 **senza** riavviare il runner (la doppia scrittura basta).
- **Prove su PostgreSQL** (T020): da zero ×2; base a `0012` con 100 000 e 1 000 000 di messaggi; **immagine R0 vera** su base a `0013` (migratore e E2E di R0); aggiornamenti del codice vero di R0; R2 simulato; fail-closed; sonda di lock; fase A dietro una transazione lunga; indice `INVALID`; misure ed `EXPLAIN`. Esiti sotto.
- **Sabotaggi** (T021): 22 inversioni (le 9 richieste, la doppia scrittura punto per punto, più 2), **tutte** fanno fallire almeno un test (tabella sotto).

## Decisioni prese (piano ≠ realtà), comportamento identico

1. **Numero della migrazione: `0013`**, non `0012` (la `0012` è la coexistence, PR #4). Dove `tasks.md`/`plan.md` dicono `0012` per R1, si legga `0013`; «immagine precedente su DB a `0012`» = immagine R0 su DB a `0013`. Nome del file lasciato quello generato (`0013_loving_stone_men.sql`): rinominarlo voleva dire toccare il journal.
2. **Campi della coexistence (`onboarding_mode`, `app_disconnected_at`) in `channel_account.config`** (jsonb), non in colonne nuove. Perché:
   - l'ADR §3.2 prevede `config` proprio per i dati **non segreti** specifici del canale; `onboarding_mode` (`manual`/`embedded`/`coexistence`) esiste solo per WhatsApp;
   - `app_disconnected_at` **non** è lo `status`: un numero può essere `connected` con la coexistence tagliata, oppure `reconnect_required` (token) senza taglio. Sono due dimensioni indipendenti; metterlo in `status = disconnected` avrebbe perso la data e mescolato due cause;
   - formato: `{"onboardingMode": …, "appDisconnectedAt": …}` prodotto **solo** dalla funzione SQL `channels_legacy_wa_config()`; la data è quella di `to_jsonb(timestamp)` (ISO senza zona, microsecondi, da leggere come UTC, come fa Drizzle con la colonna). R2 (M1.3) dovrà leggerla così.
   - **Backfill e doppia scrittura:** la riconciliazione e la doppia scrittura usano la stessa funzione; **V2** confronta anche `config` (la tupla dell'ADR più `config`). Il test campo per campo di T011 confronta in modo indipendente da V2 anche questi due campi.
3. **Doppia scrittura degli account = una funzione SQL condivisa con la riconciliazione** (`channels_legacy_sync_accounts(ids)`), chiamata **esplicitamente** dal codice TypeScript dentro la transazione (`src/server/channels/dual-write.ts` → `mirrorWhatsappAccounts`). Non è un trigger: la chiamata si vede nel codice ed è coperta dai test. Motivo: copiare da `meta_credentials` invece di riscrivere i valori da JS garantisce l'uguaglianza esatta (cifrato, stato, e la data della coexistence, che in JS ha i millisecondi e in PostgreSQL i microsecondi); un solo posto decide la mappatura dei campi (Leggi §3.2). Conseguenze:
   - gli account creati dalla doppia scrittura hanno l'ID deterministico `cha_<md5>` della riconciliazione, non `newId("channelAccount")` (l'ADR dice «il codice nuovo usa `newId()`»): così doppia scrittura e riconciliazione producono la **stessa** riga in qualunque ordine. Nessun codice interpreta la forma dell'ID;
   - la funzione, per gli ID passati, assegna l'account anche alle conversazioni reali della stessa organizzazione che non l'hanno (passo 3 della riconciliazione ristretto a quell'organizzazione): così un'organizzazione che si collega dopo aver aperto conversazioni ha V4 = 0 subito, non solo al riavvio. Il plan §5.9 diceva solo «NULL se non c'è»: la regola resta, si aggiunge il riallineamento al collegamento;
   - per identità e messaggi (un campo ciascuno) la doppia scrittura resta in TypeScript (`insertContactIfAbsent`, `insertWhatsappIdentity`, `whatsappMessageIds`, `whatsappAccountIdOf`).
4. **Punti di scrittura in più rispetto al plan §5.9** (registro della fase 1, punto 3), tutti con doppia scrittura:
   - `src/server/inbox/coexistence.ts` (storico): `external_message_id`/`channel` sui messaggi a lotti; contatti e conversazioni passano già da `identity.ts`/`ingest.ts`. **`created_at` = `wa_timestamp` dello storico conservato** (riga invariata);
   - `src/server/inbox/coexistence.ts` (rubrica, SQL a mano): aggiorna solo `contact.name`, non l'identità → **nessuna** doppia scrittura (come l'ADR per le altre scritture su `contact` che non toccano l'identità). R3 dovrà riscriverlo prima di togliere `wa_identity`;
   - `src/server/whatsapp/credentials.ts` `setAppDisconnected` e `markReconnectRequired`: ora in `db.transaction` con `returning` degli ID e la copia;
   - `src/server/whatsapp/embedded-signup.ts`: chiama `saveCredentials` con il modo → coperto, il modo finisce in `config`;
   - `src/server/seed/demo.ts`: contatto + identità in transazione, conversazione con l'account, `external_message_id` uguale al `wamid.demo.…` generato una volta sola.
5. **Transazioni nuove** dove la scrittura vecchia non lo era (plan §5.9 lo prevede): `saveCredentials`, `markReconnectRequired`, `setAppDisconnected`, inserimento del contatto (ingesta, alta manuale, Laboratorio, seed). Cambia solo l'atomicità. Una sola differenza osservabile possibile: se la base fosse già **corrotta** (per esempio un account orfano che tiene il numero che si sta salvando) ora `saveCredentials` fallisce invece di riuscire. Su una base coerente non succede; V1 lo segnala.
6. **Riconciliazione delle identità con `NOT EXISTS`**: la forma dell'ADR ritenterebbe a ogni avvio l'`INSERT` di tutti i contatti (con `ON CONFLICT`); il filtro salta quelli che hanno già l'identità WhatsApp. Stesso risultato, meno lavoro; `ON CONFLICT DO NOTHING` resta come rete.
7. **`channels_legacy_check()` con `SET jit = off`** (misura sotto: ~1,4 s → ~0,35 s per chiamata con 100 000 messaggi; la chiamata avviene due volte per avvio).
8. **Fase B:** la FK `contact_identity → contact` si crea `NOT VALID` e poi si valida (non in un colpo solo): se un avvio precedente si è interrotto dopo la fase C, `contact_identity` ha già righe e una FK validata subito bloccherebbe le scritture su `contact` durante il controllo. In modalità `avvisa` un passo di fase B che fallisce 3 volte va nel log (`fase B: «…» non completato`) e il server parte; il prossimo avvio riprova. In `blocca` (R2) esce con 1.
9. **Advisory lock di avvio** (`pg_try_advisory_lock` in un ciclo, non bloccante, fino a 10 minuti): due container che partono insieme non eseguono la fase B in parallelo (il secondo potrebbe vedere l'indice in costruzione del primo come `INVALID` ed eliminarlo). Non era nel piano.
10. **Passo 1 eseguito alla lettera** (riconciliazione anche prima delle migrazioni quando le funzioni esistono): costa ~1,5 s in più per avvio con 1 milione di messaggi (misure sotto). Non l'ho ottimizzato: serve a R3 e l'avvio resta lontano dalla soglia.
11. **R2 nei test** = lo stesso runner con `mode: "blocca"` passato come argomento della funzione `runStartup` (l'immagine di R1 lo fissa con la costante `RELEASE_MODE = "avvisa"`; nessuna variabile d'ambiente). **R0 nei test** = copia congelata delle funzioni di scrittura di `credentials.ts` di `e23332e` (`tests/golden/legacy/r0-credentials.ts`) e `INSERT` delle sole colonne vecchie; la prova con il codice **vero** di R0 è in T020.
12. **Indice e FK in `schema.ts`, `CREATE`/`VALIDATE` nel runner:** `drizzle-kit generate` dopo le modifiche dice «No schema changes» (snapshot coerente). Il file `0013` è stato riordinato a mano: Drizzle generava le FK composte **prima** dell'indice univoco di destinazione (`channel_account_org_id_uq`), cosa che PostgreSQL rifiuta.
13. **`pnpm db:migrate` (drizzle-kit migrate)** applica solo la fase A: nei flussi di sviluppo che lo usano mancano FK e indici della fase B. In produzione e nei golden si usa sempre il runner. Scritto in `docs/ops/rilascio-canali.md`.
14. **Bundle del `Dockerfile`:** invariato. `esbuild --bundle scripts/migrate.mjs` include `migrate-channels.mjs` perché lo importa (provato: bundle eseguito su una base vuota, `V1=0 … V7=0`, exit 0). Anche il bundle del seed demo compila.

## File toccati

- Schema e migrazione: `src/lib/db/schema.ts`, `src/lib/db/ids.ts`, `drizzle/0013_loving_stone_men.sql`, `drizzle/meta/0013_snapshot.json`, `drizzle/meta/_journal.json`.
- Runner: `scripts/migrate.mjs` (ora chiama `runStartup`), `scripts/migrate-channels.mjs` (nuovo).
- Doppia scrittura: `src/server/channels/dual-write.ts` (nuovo), `src/server/whatsapp/credentials.ts`, `src/server/inbox/identity.ts`, `src/server/inbox/ingest.ts`, `src/server/inbox/send.ts`, `src/server/inbox/coexistence.ts`, `src/server/whatsapp/templates.ts`, `src/app/api/contacts/route.ts`, `src/server/lab/runner.ts`, `src/server/seed/demo.ts`. Laboratorio: conversazione e messaggi **senza** account né ID esterno (per regola); `src/server/ai/pipeline.ts:242` (messaggio sandbox) invariato.
- Test: `tests/golden/migration.golden.test.ts` (nuovo), `tests/golden/legacy/r0-credentials.ts` (nuovo), `tests/unit/credentials.test.ts` (T018).
- Documenti: `docs/ops/rilascio-canali.md` (T019), questo registro, `specs/005-livello-canali/tasks.md` (compiti segnati).

## T008–T011 — Test (`tests/golden/migration.golden.test.ts`, runner vero, PostgreSQL vero)

Asserzioni esplicite, nessuna istantanea. «R1» = `runStartup` in `avvisa`, «R2» = `blocca`, «R0» = copia congelata.

| Caso | Cosa prova |
|---|---|
| T008 riconciliazione A e B | dati R0 in A (con conversazione e messaggi del Laboratorio) e B, strutture nuove vuote → avvio R1: ogni conversazione reale punta a un account della **sua** organizzazione, il Laboratorio a nessuno; ogni contatto ha esattamente una identità `whatsapp` = `wa_identity`; `external_message_id` = `wa_message_id`; account uguali campo per campo |
| T009 FK composte | identità di A con contatto di B → `23503 contact_identity_contact_fk`; conversazione di A con account di B → `23503 conversation_channel_account_fk` (controllo positivo nella stessa organizzazione) |
| T010 indici univoci | stesso `phone_number_id` per un'organizzazione C → `23505 channel_account_channel_ext_uq`; seconda identità con lo stesso ID esterno nella stessa organizzazione → `23505 contact_identity_org_channel_ext_uq`; in un'altra organizzazione → ammessa |
| doppia scrittura (senza runner) | `saveCredentials` (token nuovo, coexistence), `setAppDisconnected`, `markReconnectRequired`, ingesta (telefono e BSUID), eco, storico, `sendText`, `sendTemplate`: V1–V6 = 0 e account uguali campo per campo **dopo ogni gruppo** di scritture |
| seed demo | contatti con identità, conversazioni con l'account, messaggi con l'ID esterno: V1–V6 = 0 |
| organizzazione senza numero | conversazioni aperte prima del collegamento → con `saveCredentials` prendono l'account nella stessa transazione |
| T011 idempotenza | due avvii: stessi conteggi e **stesso `xmin`** di ogni riga di `channel_account`, `contact_identity`, `conversation`, `message` (nessuna riga riscritta) |
| T011 aggiornamenti del codice vecchio | R0: numero e token nuovi, coexistence, taglio, `reconnect_required`, organizzazione C collegata la prima volta, contenuti nuovi in B e C → **prima** della riconciliazione V1, V2, V3, V4, V5 > 0; dopo R1 e dopo R2 tutto a 0 e campo per campo |
| T011 numeri scambiati | R0 scambia i numeri di A e B (via un numero temporaneo) → V2 = 2; R1 riallinea senza violare `UNIQUE (channel, external_account_id)` |
| T011 V2 vede un campo alterato | `display_name` e `config` cambiati a mano → V2 = 1, poi 2 |
| T011 R2 → R0 → R2 | senza migrazioni pendenti: R0 cambia il numero di B e scrive contenuti → R2 parte (0) e tutto è a 0 |
| T011 account orfano | `meta_credentials` di B cancellata → R2 esce con 1 e il log dice `verifica fallita … V1=1`; `node scripts/migrate.mjs` (l'immagine vera di R1) esce con 0 e scrive `canali (avvisa): V1=1` e «modalità «avvisa»» |
| fase B | `CREATE INDEX CONCURRENTLY` fallito (indice `INVALID`) → al riavvio eliminato e ricreato, valido |

## T018 — Mock dei test unitari

Solo `tests/unit/credentials.test.ts` usava un mock della tabella: ora il mock espone `transaction`, `returning` ed `execute` su `tx`. Le asserzioni di prima restano tutte (token mai in chiaro nella riga, cifrato reversibile); se ne aggiunge una: la copia su `channel_account` avviene **dentro** la transazione. Gli altri 64 file unitari passano senza modifiche.

## T019 — Note di rilascio

`docs/ops/rilascio-canali.md`: come funziona l'avvio, durata attesa, checklist (volume, transazioni lunghe, backup), rilascio R1 **stop-first**, controlli dopo il rilascio, rollback R1 → R0 e ritorno, R2 e R3 (in sintesi, da completare in M1.3), come leggere V1–V7 chiamando `channels_legacy_check()` (senza ricopiarne le query), «Non verificato». **Coolify: non verificato** (nessun accesso al pannello): la procedura dice di fermare l'app prima del deploy.

## T020 — Prove su PostgreSQL 16 usa e getta (plan §6, punti 1–9)

Dati sintetici generati con SQL su una base portata a `0012` dal **migratore vero di R0** (worktree `e23332e`): 3 organizzazioni (A e B con numero, C senza), 60 000 contatti (uno su 5 solo BSUID), una conversazione reale per contatto, una conversazione del Laboratorio con 10 messaggi senza `wamid`, un messaggio su 50 fallito senza `wamid`, chiave Wapi di A revocata e di B attiva, A in coexistence con taglio.

| # | Prova | Esito |
|---|---|---|
| 1 | da zero, due volte (runner R1) | exit 0 entrambe, `V1=0 … V7=0`; seconda volta nessuna migrazione, fase B saltata (oggetti già validi) |
| 2 | base `0012` con dati → R1 | 100 010 messaggi: `V1=0 … V7=0`, 5,7 s; 1 000 010 messaggi: `V1=0 … V7=0`, 27,3 s |
| 3 | **immagine R0 vera su base a `0013`** | migratore R0: «migraciones aplicadas», exit 0, registro invariato (14 righe). App R0 (`next dev` dal worktree `e23332e`) + E2E di R0: **125/125**. Dopo: `V1=1 V2=0 V3=6 V4=0 V5=20` (le scritture di R0 non hanno le strutture nuove); R1 riavviato → tutto 0; R2 simulato (`blocca`) → exit 0 |
| 4 | **aggiornamenti del codice vero di R0** (bundle con le funzioni di `e23332e`: token ruotati, `reconnect_required`, numeri scambiati A↔B, C collegata, taglio della coexistence, ingesta di un messaggio) sulla base da 100 000 già a `0013` | prima: `V1=1 V2=2 V3=1 V4=1 V5=1 V6=0`; dopo R1: tutto 0, account uguali campo per campo (numero, cifrato, stato, `config`); R2 simulato: exit 0 |
| 5 | ritorno a R2 senza migrazioni pendenti | golden T011 (sopra) e prova 4: la riconciliazione gira anche senza migrazioni |
| 6 | fail-closed (account orfano, base da 1 milione) | R2 simulato: exit 1, `verifica fallita prima delle migrazioni: V1=1`; `node scripts/migrate.mjs` (R1): parte, log con `V1=1` e «modalità «avvisa»» |
| 7a | **sonda di lock** (ogni 0,2 s: lettura di `message`, `conversation`, `contact` + inserimento in `message`, `lock_timeout` 200 ms) durante l'avvio | 100 000: 45 sonde, **0 bloccate**, massimo 59 ms. 1 000 000: 101 sonde, **0 bloccate**, 7 lente oltre 150 ms (massimo 318 ms, carico di I/O della fase C, non lock: una attesa di lock oltre 200 ms sarebbe fallita) |
| 7b | **fase A dietro una transazione lunga** (12 s, `ACCESS SHARE` su `message`), base da 100 000, sonda attiva | primo tentativo: attesa di 5 s, `55P03`, tutto annullato; secondo tentativo dopo 2 s, poi riuscito a transazione finita; avvio 14,6 s, exit 0, V tutte 0. **Durante le due attese 19 sonde su 57 bloccate** (`55P03`): mentre l'`ALTER TABLE` aspetta il lock esclusivo, PostgreSQL mette in coda dietro di lui anche le altre letture e scritture su `message`. Con lo stop-first non c'è traffico dell'app da bloccare; il rischio resta per transazioni esterne (backup): vedi checklist del documento operativo |
| 8 | `CREATE INDEX CONCURRENTLY` interrotto (`pg_cancel_backend`) su 1 milione di messaggi | indice `INVALID`; al riavvio eliminato e ricreato (fase B 1,98 s), valido, V tutte 0 |
| 9 | misure | tabella sotto |

**Durate** (ms; `pre` = passo 1, `post` = passo 4):

| Base | Avvio | faseA | faseB | sync | sync messaggi (lotti) | check | totale |
|---|---|---|---|---|---|---|---|
| vuota | primo | 200 | 14 | 3 | 2 (0) | 3 | < 1 s |
| 100 010 msg | primo | 39 | 324 | 2 200 | 1 591 (21) | 1 530* | 5 728 |
| 100 010 msg | secondo | 7 | 5 | 54 + 49 | 101 + 90 | 1 385 + 1 337* | 3 070 |
| 1 000 010 msg | primo | 152 | 2 563 | 2 711 | 21 215 (201) | 574 | 27 269 |
| 1 000 010 msg | secondo | 10 | 5 | 74 + 43 | 1 289 + 1 033 | 538 + 497 | 3 533 |

\* prima di `SET jit = off`. Con `jit = off` la stessa verifica sulla base da 100 000 scende a 330–375 ms (misura con `\timing`); le righe da 1 milione sono già con `jit = off`. La parte più cara di V1–V6 è V3 (sottoquery per contatto, ~340 ms con 60 000 contatti).

**Soglia di 60 s (ADR §3.3):** primo avvio ≈ 3 s + 24 s per milione di messaggi → soglia a circa 2,4 milioni. Sotto, la fase C dei messaggi resta nell'avvio come da ADR; **sopra non è implementata** l'alternativa (job dopo l'avvio). Il documento operativo dice di fermarsi oltre 2 milioni.

**`EXPLAIN ANALYZE` della risoluzione del contatto** (base da 100 000, 60 000 contatti):
- prima (R0/R1, `contact` per `wa_identity`): `Index Scan using contact_org_wa_identity_uq`, 0,035–0,085 ms;
- dopo (lettura di R2, `contact_identity` + `contact`): `Nested Loop` di due `Index Scan` (`contact_identity_org_channel_ext_uq`, poi `contact_org_id_uq`), 0,112 ms. Due accessi a indice invece di uno: stesso ordine di grandezza, nessuna scansione.

**E2E (Definizione di Hecho):**
- R1 su base nuova: `scripts/e2e-selftest.mjs` **125/125** (porta 3200, mock wa/ai); dopo la corsa `V1–V6 = 0` senza riavvio.
- Dopo il passaggio R0 → R1 (prova 3), la seconda corsa dell'E2E sulla **stessa** base dà 120/125: falliscono 5 controlli della coexistence (rubrica e storico). **Non è una regressione:** l'harness non è ripetibile sulla stessa base, e con il solo R0 (base solo R0, due corse di fila) falliscono gli stessi 5 controlli alla seconda corsa, identici. Va segnalato a parte (l'harness dovrebbe usare numeri nuovi a ogni corsa).

## T021 — Sabotaggi

Metodo: script nello scratchpad (non versionato) che sostituisce **un** frammento, esegue i golden e rimette il file com'era; alla fine `git status` mostra solo le modifiche mie. Prima corsa sul solo `migration.golden.test.ts`; corsa finale su **tutta** la suite golden (92 casi).

| Sabotaggio | Dove | Rossi (su 92) | Test che lo vede |
|---|---|---|---|
| FK `contact_identity → contact` senza `organization_id` | `scripts/migrate-channels.mjs` (fase B) | 1 | T009 identità di A con contatto di B |
| FK `conversation → channel_account` senza `organization_id` | `drizzle/0013` | 1 | T009 conversazione di A con account di B |
| riconciliazione senza `ca.organization_id = cv.organization_id` | `channels_legacy_sync_accounts` | 4 | T008 (la FK rifiuta l'account di B, la riconciliazione fallisce), T011 idempotenza e aggiornamenti |
| doppia scrittura tolta: `saveCredentials` | `credentials.ts` | 5 | seed demo, organizzazione senza numero, T009/T010 (l'account non esiste), V2 alterato |
| doppia scrittura tolta: `markReconnectRequired` | `credentials.ts` | 1 | doppia scrittura (V2) |
| doppia scrittura tolta: `setAppDisconnected` | `credentials.ts` | 1 | doppia scrittura (V2, `config`) — vista solo dopo la correzione del test, vedi sotto |
| doppia scrittura tolta: identità del contatto | `dual-write.ts` (`insertContactIfAbsent`) | 1 | doppia scrittura (V3) |
| doppia scrittura tolta: identità del seed demo | `seed/demo.ts` | 1 | seed demo (V3) |
| doppia scrittura tolta: account della conversazione | `ingest.ts` | 1 | doppia scrittura (V4) — vista solo dopo la correzione del test |
| doppia scrittura tolta: messaggio in entrata | `ingest.ts` | 1 | doppia scrittura (V5) |
| doppia scrittura tolta: eco | `ingest.ts` | 1 | doppia scrittura (V5) |
| doppia scrittura tolta: storico | `coexistence.ts` | 1 | doppia scrittura (V5) |
| doppia scrittura tolta: invio | `send.ts` | 1 | doppia scrittura (V5) |
| doppia scrittura tolta: modello | `templates.ts` | 1 | doppia scrittura (V5) |
| indice `UNIQUE (channel, external_account_id)` tolto | `drizzle/0013` | 1 | T010 stesso numero in un'altra organizzazione |
| indice `UNIQUE (organization_id, channel, external_id)` tolto | `drizzle/0013` | 1 | T010 seconda identità nella stessa organizzazione |
| i due `UPDATE` di `channel_account` tolti | `channels_legacy_sync_accounts` | 4 | T011 aggiornamenti, T011 numeri scambiati, doppia scrittura |
| primo `UPDATE` (liberazione dei numeri) tolto | `channels_legacy_sync_accounts` | 1 | T011 numeri scambiati |
| V2 tolta da `channels_legacy_check()` | `drizzle/0013` | 8 | T011 «V2 > 0 prima», V2 alterato, e tutti i casi che si aspettano `V1=0 V2=0 …` nel log |
| riconciliazione tolta dal runner (resta solo la migrazione) | `migrate-channels.mjs` | 6 | T011 R2 → R0 → R2, aggiornamenti, scambio, idempotenza, T008, fase B |
| (in più) modalità di R1 messa a `blocca` | `RELEASE_MODE` | 1 | T011 account orfano (l'immagine di R1 deve partire) |
| (in più) indice `INVALID` non ricreato | `applyPhaseBStep` | 1 | fase B |

In nessun sabotaggio è diventato rosso uno dei 77 golden di comportamento: tutti i rossi sono nel file della migrazione. È coerente con R1 (le strutture nuove non cambiano ciò che WhatsApp fa) e con l'obiettivo dei golden.

Due sabotaggi della prima corsa **non** erano stati visti (`setAppDisconnected` senza copia e conversazione senza account): nel test della doppia scrittura un `saveCredentials` successivo ricopiava l'account e assegnava le conversazioni, e nascondeva il difetto. Il test ora controlla V1–V6 dopo ogni gruppo di scritture e il salvataggio superfluo è stato tolto; con il test corretto entrambi diventano rossi.

Non coperto da un sabotaggio: V7 (`wapi_credentials` cambiata **durante** l'avvio) non ha un test che la provochi; il confronto è codice semplice nel runner, provato solo nel caso «nessun cambio».

## Verifiche prima del commit

Binari chiamati direttamente (niente `pnpm`):
- `tsc --noEmit`: verde;
- `eslint .`: verde, nessun avviso;
- `vitest run` (unitari): 65 file, 993 test verdi;
- `vitest run -c vitest.golden.config.ts` con `DATABASE_URL_GOLDEN=postgres://vocero@127.0.0.1:5433/vocero_m1p2_golden`: 10 file, **92** test verdi (77 di prima invariati + 15 nuovi);
- `git diff e23332e -- tests/golden/__golden__`: vuoto;
- `drizzle-kit generate` con `DATABASE_URL` fittizia: «No schema changes»;
- `next build`: verde;
- bundle `esbuild` del `Dockerfile` (migratore e seed): compila; il migratore in bundle gira su una base vuota;
- E2E: 125/125 contro R1.

## Rischi per il rilascio in produzione

1. **Coolify:** se fa un rolling update (healthcheck presente), R0 serve traffico mentre R1 migra. Per R1 non è un errore di dati (R1 legge le colonne vecchie e il prossimo avvio riallinea), ma la fase A può mettere in coda il traffico su `message` e la regola D18 chiede stop-first. Non verificato: l'owner ferma l'app prima del deploy.
2. **Transazioni lunghe durante il deploy** (un `pg_dump` in corso): la fase A aspetta 5 s per tentativo e in quei 5 s blocca anche il resto del traffico su `message`; dopo 15 tentativi (~105 s) il container non parte. Checklist nel documento operativo.
3. **Durata del primo avvio** proporzionale ai messaggi (≈ 24 s per milione). Oltre ~2,4 milioni si supera la soglia di 60 s e l'alternativa dell'ADR non c'è.
4. **Ogni riavvio costa ~3 s in più** (riconciliazione e verifiche due volte), fino a R3.
5. `saveCredentials` e le altre scritture ora sono in transazione: su una base **già corrotta** (account orfano con il numero da salvare) falliscono invece di riuscire. V1 lo segnala a ogni avvio.
6. In modalità `avvisa` una fase B fallita lascia R1 senza le guardie nuove (FK composta, indice per organizzazione) finché un avvio non la completa: il log lo dice, R2 non partirebbe.
7. V7 può dare un falso positivo se qualcuno cambia una chiave Wapi proprio durante l'avvio (in R2 il container non partirebbe).
8. L'advisory lock fa aspettare un secondo container fino a 10 minuti, poi exit 1.

## Non verificato

- Nessun passo in produzione né su una copia della produzione; misure su dati sintetici e macchina di sviluppo.
- Comportamento di Coolify (rolling o stop-first).
- La CI con il nuovo file golden non è stata eseguita su GitHub (nessun push); il test della migrazione lancia `node scripts/migrate.mjs` come processo figlio, come già fa il global setup.
- Le route HTTP con sessione (alta manuale del contatto, Laboratorio) non hanno un test golden della doppia scrittura: usano lo stesso helper `insertContactIfAbsent` coperto dai golden, e l'E2E crea contatti dall'interfaccia con V3 = 0 alla fine; il Laboratorio non è nell'E2E.
- La lettura di `config.appDisconnectedAt` da TypeScript non esiste ancora (R2): il formato è definito, non usato.
- `pnpm test:e2e` non è stato eseguito con `pnpm` ma con `node --env-file=… scripts/e2e-selftest.mjs` (stesso comando dello script).

## Revisione avversaria indipendente (10/10/2026) e correzioni

Esito: **approvabile** per la produzione attuale (2 organizzazioni, un numero, meno di 1.000 messaggi, rilascio con `docker compose`). Nessun bloccante. Corretti i due punti "da correggere" e due punti minori:

1. **Una riga sporca nelle tabelle nuove poteva far perdere un messaggio WhatsApp.** Il webhook risponde 200 prima di elaborare, quindi un'eccezione della doppia scrittura avrebbe fatto perdere il messaggio. Ora le scritture sulle strutture nuove (`channel_account`, `contact_identity`) sono **isolate in un SAVEPOINT** (`bestEffort` in `src/server/channels/dual-write.ts`): se falliscono si scrive nel log `[canali] doppia scrittura … fallita`, la scrittura vecchia va avanti e la riconciliazione all'avvio ripara. L'identità usa anche `ON CONFLICT DO NOTHING`. Test: «un'identità residua … NON blocca l'alta di un contatto». Sabotaggio, togliendo savepoint e `ON CONFLICT`: il test fallisce.
2. **Credenziali cancellate e ricreate con un id nuovo** (ripristino valido col codice vecchio): la riconciliazione falliva per tutte le organizzazioni e il numero non si poteva più ricollegare. Ora `channels_legacy_sync_accounts` ha un passo **(0)** che riaggancia l'account orfano della stessa organizzazione al nuovo id, e (1c) usa `ON CONFLICT DO NOTHING` su qualunque conflitto, che resta visibile in V1/V2. Test: «meta_credentials cancellata e ricreata …». Sabotaggio, togliendo il passo (0): 7 test falliscono.
3. `docker-compose.yml`: `init: true`. Il PID 1 diventa tini, così il server riceve SIGTERM e completa i webhook in corso invece di essere ucciso dopo 10 secondi a ogni rilascio.
4. Mock del test delle credenziali: ora supporta il savepoint (`tx.transaction`). L'asserzione «doppia scrittura nella stessa transazione» non è stata indebolita.

Verifiche dopo le correzioni:
- tsc, eslint, unit 993/993, golden **94/94** (i 77 di comportamento invariati), `next build`;
- E2E 125/125 su un database nuovo, con V1–V6 a 0 e nessuna riga `doppia scrittura … fallita` nel log.

Restano aperti, come punti minori annotati dal revisore:
- il riepilogo all'avvio dovrebbe evidenziare di più "fase B incompleta";
- i contatti del Laboratorio ricevono identità reali, e va deciso come instradarli in R2;
- l'attesa del lock advisory può essere molto lunga in un caso patologico.
