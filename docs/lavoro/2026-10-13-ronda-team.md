# Registro di lavoro — 2026-10-13 — 012 «Ronda delle 8:00 al team»

**Mandato:** la ronda del mattino per il team dell'organizzazione interna («InsidersLab · Interno»).

- Un generatore esterno (n8n, oppure un'attività pianificata di Claude con Monday) consegna le 3 priorità del giorno.
- Il CRM le invia come modello WhatsApp Utility approvato, dal numero dell'organizzazione, **solo** ai numeri della lista del team (Accesso riservato, 007).
- Il CRM non chiama Monday (Costituzione II).

Spec: `specs/custom-heili/012-ronda-team.md`, scritta prima del codice, carril completo. Guida per il proprietario: `docs/ops/ronda-team.md`.

**Esecutore:** Claude (subagente).
**Worktree:** `/home/user/crm-ronda`, branch locale `team-broadcast`, base `origin/main` @ `30ccd1b`.

Limiti rispettati:

- nessun push, nessuna PR, nessuna chiamata a Meta o a un provider IA, nessun dato reale;
- PostgreSQL 16 usa e getta su `127.0.0.1:5433`, con basi `vocero_ronda_*`;
- env e log propri in `scratchpad/ronda/`.

## Commit

1. `2a88619` docs(spec): 012 ronda delle 8:00 al team
2. `cb08306` feat(012): tabella `team_broadcast` (migrazione 0016)
3. `7d05e25` feat(012): `POST /api/bot/team-broadcast` + golden + inventario dei ruoli
4. `d1fdafa` test(012): validazione (unità)
5. `81bf829` feat(012): riga «Ronda: ultima inviata…» nell'Accesso riservato
6. `fbca9ab` test(e2e): sezione «012»
7. `e42dadb` docs(ops): guida per il proprietario
8. questo registro (+ stato della spec)

## Cosa è stato fatto

### Dati — `drizzle/0016_team_broadcast.sql`

Tabella `team_broadcast`, una riga per ronda inviata (mai per un `dryRun`):

- colonne: `organization_id` (FK cascade), `idempotency_key`, modello e lingua, `status` (`running`/`done`, con CHECK), i conteggi `total`/`sent`/`failed`/`skipped`, `result` (jsonb: la risposta già mascherata, per la replica), `created_at`, `finished_at`;
- indici: UNIQUE `(organization_id, idempotency_key)` e `(organization_id, created_at)`;
- come è stata creata:
  - generata con `drizzle-kit generate`, rinominata e con il journal aggiornato;
  - snapshot `0016` con `prevId` = id di `0015`;
  - `SET LOCAL lock_timeout = '5s'` come in 0013–0015;
- verifiche:
  - un secondo `drizzle-kit generate` risponde «No schema changes»;
  - `scripts/migrate.mjs` su una base nuova dà V1–V7 = 0.

La stessa tabella serve all'idempotenza, al limite orario e alla riga in pagina. I parametri **non** si salvano: il testo inviato sta già nei messaggi.

### `POST /api/bot/team-broadcast`

- **Auth:** `authenticateBot`, come le altre `/api/bot/*`. L'organizzazione arriva solo dalla chiave. Nell'inventario dei ruoli con la politica `bot-key`, verificata dall'AST.
- **`Idempotency-Key` obbligatoria:** 1–128 caratteri `[A-Za-z0-9._:-]`. Senza → 400 `idempotency_key_required`.
- **Body:** Zod `.strict()` con `templateName`, `language` e `params` (1–10), più `perRecipient` (mappa numero → 1–10 parametri, massimo 50 voci) e `dryRun`, entrambi facoltativi.
  - I parametri si **normalizzano**: ogni sequenza di spazi bianchi (`\n`, `\t`, spazi multipli, NBSP…) diventa uno spazio, gli altri caratteri di controllo spariscono, si tolgono gli spazi agli estremi.
  - Dopo la normalizzazione ogni parametro deve avere 1–1024 caratteri. Il grezzo è limitato a 4096.
- **Destinatari:** SOLO `allowed_identities`, con `restrict_to_allowlist = true` e lista non vuota; altrimenti 409 `no_team_list`. Oltre 50 numeri → 409 `team_too_large`.
- **Numero collegato:** se manca o va ricollegato → 409. Il controllo avviene prima di consumare la chiave.
- **Modello:** cercato tra quelli dell'organizzazione per nome e lingua. Può rispondere 422 `template_not_found`, `template_not_approved` o `template_params_mismatch`. Il numero di parametri si controlla anche su ogni voce di `perRecipient`.
- **Idempotenza:**
  - una lettura iniziale della chiave (finestra di 36 h) restituisce la replica, `replayed: true`, senza inviare;
  - poi il «claim» avviene in una transazione con `pg_advisory_xact_lock` per organizzazione: pulizia della chiave scaduta (oltre 36 h), nuovo controllo della chiave, limite di 3 ronde nell'ultima ora mobile (429 `rate_limited` + `Retry-After`), insert `running`;
  - una chiave `running` → 409 `broadcast_in_progress`.
- **Invio:** per ogni numero, in ordine e con una pausa di 150 ms:
  1. `getOrCreateContactByIdentity` (stessa identità dell'ingest; se il contatto nasce, `insertContactIfAbsent` scrive contatto e `contact_identity` nella stessa transazione), `reactivate: false`;
  2. `getOrCreateConversation`;
  3. `sendTemplate`. Il messaggio resta in Posta (`type = template`, `origin = template`, corpo renderizzato, SSE `message.new`).
- **Esito per destinatario:** `sent` (`messageId`), `failed` (codice tipizzato) oppure `skipped` (`dry_run`, oppure `aborted` dopo un errore che vale per tutta l'organizzazione: token scaduto, numero non collegato, chiave Wapi mancante).
- **Mascheramento:** nella risposta e in `result` i numeri sono **sempre** mascherati alle ultime 3 cifre. Nei log ci sono solo un riepilogo e i fallimenti con il numero mascherato; mai i parametri.

### Pagina Agente IA

- `GET /api/agent/profile` aggiunge `restriction.lastBroadcast`, solo per owner/admin come il resto di `restriction`.
- La sezione «Accesso riservato» mostra una riga di sola lettura sotto il titolo (`#ronda-last`): «Ronda: ultima inviata il … a N persone (tutte inviate | inviate X su N | in corso)», oppure «Ronda: ancora nessuna inviata.».
- Singolare per una persona. i18n es/en/it. La logica sta in `src/components/agent/ronda-line.ts`, funzione pura.

## Test

- **Unità** `tests/unit/team-broadcast.test.ts`, 22 casi:
  - normalizzazione dei parametri (anche NBSP e spazi em);
  - schema strict, limiti 1–10 e 1024 *dopo* la normalizzazione;
  - lingua;
  - chiavi di `perRecipient`: normalizzate, rifiutate senza `+`, duplicate, anche 521/52; l'errore non riporta il numero intero;
  - `Idempotency-Key`, maschera;
  - `rondaLine` nelle 3 lingue, senza chiavi mancanti.
- **Golden** `tests/golden/team-broadcast.golden.test.ts`, 16 casi su PostgreSQL reale con la rotta vera, asserzioni esplicite e nessuna istantanea:
  - **solo la lista:** un cliente della stessa organizzazione, con la finestra aperta, non riceve nulla. Sono verificati anche:
    - Graph dal numero e con il token di A;
    - corpo renderizzato in `message`, SSE `message.new`;
    - `contact_identity` dei contatti nuovi, V1–V6 = 0;
    - nessun numero completo né priorità nei log o nella risposta;
  - collega già in Posta e archiviato: usa la sua conversazione, nessun doppione, non viene riattivato;
  - 409 senza profilo, con la restrizione spenta, con la lista vuota (anche in dryRun); 409 oltre 50 numeri;
  - 422: modello sconosciuto, di un'altra lingua, non approvato, parametri in più o in meno, voce di `perRecipient` sbagliata;
  - parametri con `\n`, `\t` e spazi multipli arrivati a Meta su una riga; 422 per un parametro vuoto o lungo, o per un campo sconosciuto (`organizationId`, `recipients`);
  - `perRecipient`: personalizzati e default; la voce fuori lista è ignorata e riportata come `…678`; il suo testo non arriva mai a Graph;
  - 400/401: senza `Idempotency-Key`, chiave non valida, senza chiave bot o con chiave revocata;
  - idempotenza:
    - la replica è identica alla prima risposta, anche con un body diverso e con la lista spenta;
    - a 35 h è ancora replica, a 37 h la ronda si rifà;
    - due chiamate contemporanee con la stessa chiave fanno una sola ronda (200 + 409);
    - una ronda `running` → 409;
  - limite: 3/ora; la quarta → 429 con `Retry-After = 1800`. Repliche e dryRun non contano, B non è toccata, dopo 61 min si riparte;
  - dryRun: nessun invio, nessun contatto, nessuna riga; la stessa chiave poi vale per la ronda vera;
  - Meta rifiuta un numero (131026): `failed` e gli altri vanno avanti. Token scaduto (190): 1 `failed` + 2 `skipped/aborted` e una sola chiamata; la ronda successiva → 409 `reconnect_required`;
  - isolamento A/B:
    - la chiave di A non vede la lista né il modello di B;
    - a parità di `Idempotency-Key` le due ronde restano indipendenti;
    - numero e token sono quelli giusti;
    - contatti e righe stanno nella propria organizzazione.
- **E2E** `scripts/e2e-selftest.mjs`, sezione «012», 27 controlli contro `next dev` con wa-mock:
  - chiave `vbk_` creata da Impostazioni;
  - modello creato, 422 mentre è in attesa, poi approvato e sincronizzato;
  - 409 ×2, 400, 401 ×2, 422 ×3;
  - dryRun con l'outbox vuoto;
  - ronda vera: solo i 2 numeri, il cliente niente, `perRecipient`, parametri normalizzati, modello `it`;
  - replica senza nuovi invii;
  - Posta: modello renderizzato nella conversazione del collega, nessun messaggio in uscita al cliente;
  - `lastBroadcast` nel profilo;
  - 429 alla quarta;
  - stato finale ripristinato.
- **Browser** (Playwright + Chromium locale, script non versionato nello scratchpad): la riga `#ronda-last` sulla pagina `/agent` reale. Testi ottenuti:
  - it: «Ronda: ultima inviata il 13 ott 2026, 21:51 a 2 persone (tutte inviate).»;
  - es: «Ronda: último envío el 13 oct 2026, 9:51 p.m. a 2 personas (todas enviadas).»;
  - en: «Morning round: last sent on Oct 13, 2026, 9:51 PM to 2 people (all sent).»;
  - a 390 px di larghezza nessuno scorrimento orizzontale.

### Gate (binari diretti, niente `pnpm`)

- `tsc --noEmit`: verde · `eslint .`: verde.
- `vitest run`: 86 file, **1308** test verdi (22 nuovi).
- Golden su base **nuova** (`vocero_ronda_golden2`): **164/164**, cioè i 148 di prima più i 16 nuovi. `git diff 30ccd1b -- tests/golden/__golden__` è vuoto: nessuna istantanea cambiata.
- `next build`: verde, con la rotta `/api/bot/team-broadcast` presente.
- E2E su base nuova (`vocero_ronda_e2e`): **237/237**. Subito dopo, `channels_legacy_check()` dà V1–V6 = 0. Nel log dell'app: nessuna riga «doppia scrittura … fallita», nessun numero completo del team, nessuna priorità.
  - Per la sezione 009, già esistente, servono `AGENT_COALESCE_MS=500` e `AGENT_RETRY_MS=4000`, come scritto nel registro 009. Senza, i suoi controlli a tempo falliscono, e così è andata nella prima corsa.

## Sabotaggi

Metodo: script nello scratchpad che cambia **un** frammento, esegue i test indicati e rimette il file com'era. Alla fine `git status` è pulito.

| Sabotaggio | Test che lo vede |
|---|---|
| Lista: ignora `restrict_to_allowlist` | golden: 1 rosso (409 con la restrizione spenta) |
| Lista: destinatari = lista + **tutti i contatti dell'organizzazione** (il «spam ai clienti») | golden: 1 rosso («un cliente … non riceve nulla») |
| Lista: le chiavi di `perRecipient` fuori lista diventano destinatari | golden: 1 rosso |
| Idempotenza: nessuna replica (né prima né nel claim) | golden: 4 rossi |
| Idempotenza: finestra di 1 h invece di 36 h | golden: 1 rosso |
| Organizzazione: modello cercato senza `organization_id` | golden: 2 rossi (isolamento, limite) |
| Organizzazione: lista del team letta senza `organization_id` | golden: 1 rosso (isolamento) |
| Organizzazione: limite orario contato su tutte le organizzazioni | golden: 1 rosso |
| Parametri: nessuna normalizzazione | golden: 2 rossi · unità: 7 rossi |
| Parametri: solo `\n` (tab e spazi multipli passano) | golden: 1 rosso · unità: 4 rossi |

## Decisioni (da rivedere se serve)

- **Normalizzare, non rifiutare** i parametri con a capo, tab o spazi multipli. Il generatore è un LLM: un a capo di troppo non deve far saltare la ronda del mattino. Si rifiuta solo un parametro vuoto o oltre 1024 caratteri dopo la normalizzazione.
- **Massimo 50 destinatari** e **3 ronde/ora**. La Costituzione VIII esclude il broadcast massivo: questa è comunicazione interna verso una lista chiusa del team. La giustificazione è scritta nel Constitution Check della spec.
- **Il modello si invia anche con la finestra di 24 h aperta**: tutti ricevono lo stesso messaggio. Per il listino a messaggio di Meta (dal 1/7/2025) un Utility dentro la finestra non si paga. Le automazioni invece saltano la finestra aperta.
- **`perRecipient`:**
  - una chiave fuori lista si **ignora** e si riporta mascherata (`unknownRecipients`), invece di rifiutare tutta la ronda: una lista appena cambiata non deve bloccare il mattino;
  - una chiave senza `+` e con spazi si rifiuta, come nella lista;
  - le sole cifre (la forma salvata) si accettano.
- **Idempotenza:**
  - la replica restituisce il primo risultato **anche se il body è diverso**, come chiede il mandato. Un LLM che al nuovo tentativo genera un testo diverso non deve produrre una seconda ronda;
  - il `dryRun` richiede comunque la chiave, ma non la consuma e non conta per il limite;
  - un `dryRun` con una chiave già usata restituisce la replica.
- **Ronda interrotta** (crash a metà): resta `running` e la stessa chiave risponde 409 per 36 h. Si preferisce non reinviare. Si riparte con una chiave nuova.
- **Errore dell'organizzazione** (token scaduto, numero non collegato, chiave Wapi mancante): si smette di chiamare Meta e il resto risulta `skipped/aborted`.
- **Contatti del team archiviati:** ricevono la ronda ma **non** vengono riattivati.
- **Numeri mascherati anche nella risposta** (non solo nei log) e nel `result` salvato. Chi chiama conosce già la sua mappa.
- Nessuna sostituzione automatica del nome in `{{1}}`: il nome lo decide il generatore con `perRecipient`.
- La tabella non viene ripulita: cresce di circa una riga al giorno, ed è trascurabile.

## Rischi e cose non verificate

- **Meta reale non provata:** approvazione del modello Utility, eventuale riclassificazione in Marketing, consegna vera. Solo wa-mock e Graph finto dei golden.
- **Flusso n8n non costruito né provato:** in `docs/ops/ronda-team.md` c'è uno schema, non un workflow esportato.
- **Team con due lingue:** ogni chiamata va a tutta la lista in una sola lingua. Un team misto it/es oggi deve scegliere una lingua, oppure usare due organizzazioni. **Decisione aperta per il proprietario:** un filtro `recipients` facoltativo, sempre ristretto alla lista.
- I modelli vanno creati **dal CRM** (Impostazioni → Modelli): la sincronizzazione non importa i modelli creati solo nel pannello di Meta. È scritto nella guida.
- `next start` non serve i mock: l'E2E gira contro `next dev`. La build di produzione è verificata solo con `next build`.
- CI di GitHub non eseguita (nessun push).
- **Ambiente condiviso:**
  - all'inizio il cluster PostgreSQL su 5433 (`/tmp/vocero-pg-e2e`) era fermo: l'ho riavviato con le stesse opzioni (`pg_ctl` come `nobody`) e l'ho lasciato acceso;
  - per fermare il mio `next dev` ho usato una volta un `pkill -f "[n]ext-server" -P 1` troppo largo. Se in quel momento un altro agente aveva un `next-server` figlio di PID 1, è stato fermato. Dopo, ho fermato solo per PID.
