# Registro di lavoro — 2026-10-10 — residui-sicurezza (M0.3)

**Mandato:** residui di sicurezza di `src/server/api-keys.ts` (registro `docs/lavoro/2026-10-05-c2-3.md`, sezione non chiusi). Branch locale `notte/residui-sicurezza`, nessun push. **Security-critical:** serve revisione indipendente prima del merge.

## Chiusi
1. `requireInstanceKey`: i fallimenti (senza header, chiave corta/errata, confronto fallito) contano per IP del client (`<bucket>:invalid:<ip>`, stessa `clientIp`); l'IP gia' bloccato riceve 429 anche con la chiave buona (come per le chiavi per organizzazione). Il contatore `<bucket>:instance` si consuma solo dopo il confronto riuscito: un flood di x-api-key false non blocca piu' la chiave d'istanza legittima.
2. Rate limit in memoria: pulizia ammortizzata ogni `SWEEP_EVERY` (500) accessi di `checkRateLimit`; elimina le voci la cui marca piu' recente e' fuori dalla finestra massima vista (scadute per qualunque limite). Test: `rateLimitSize`.
3. Test di protezione: `authRateLimitAllowed` (estratta dall'hook di login in `src/lib/rate-limit.ts`, stesso comportamento) testata per IP via x-forwarded-for; `tests/unit/roles.test.ts` per il confronto esatto di `canManageApiKeys` ('owner-x', 'xadmin', 'Owner', ...).

## Sabotaggi (invertire, un test fallisce, ripristinato)
sweep disattivato; chiave login senza IP; ruolo con includes/lowercase; contatore istanza non consumato dopo successo; fallimenti sul contatore istanza invece che per IP: tutti rilevati.

## Non chiusi
~~Nessuno.~~ **Dichiarazione errata**, corretta dalla verifica indipendente: il residuo «contatore condiviso da IP comuni» (PIANO-CRM-MULTICANALE riga 49) non era chiuso e il commit 912c952 lo peggiorava. Vedi «Terza tornata». Nota: l'affidabilita' di `clientIp` dipende dal proxy che fissa x-forwarded-for (gia' documentato nel codice).

## Terza tornata — rilievi della verifica su 912c952

Verifica indipendente: `regge: false`, 1 rilievo alto, 1 medio, 3 bassi. Tutti chiusi o motivati qui sotto.

### 1. ALTO — «contatore condiviso da IP comuni» (M0.3, riga 49): chiuso, con residuo dichiarato

**Difetto.** In 912c952 i fallimenti della chiave d'istanza (anche le richieste senza `x-api-key`) finivano in `<bucket>:invalid:<ip>`, lo stesso bucket delle chiavi per organizzazione, e quel bucket era controllato PRIMA di verificare la chiave. Chi condivideva l'IP (NAT, IP di uscita condivisi di piattaforme di automazione, il fallback `"local"` senza proxy) bloccava con 429 le chiavi `vex_`/`vbk_` valide di ALTRE organizzazioni: bastava traffico non attribuibile a nessuna organizzazione. Prove della verifica: 429 su 912c952, 200 sulla base.

**Scelta (tre misure insieme, una sola funzione `ipFailureCounter` in `src/server/api-keys.ts`, che sostituisce le due copie del blocco).**
1. **Contatori separati per tipo di chiave.** `<bucket>:invalid:<ip>` conta solo i fallimenti delle chiavi con il prefisso dell'ambito (`vex_`/`vbk_`); `<bucket>:instance-invalid:<ip>` conta tutto il resto (senza intestazione, senza prefisso, variabile d'ambiente assente o corta, confronto errato). Il traffico senza prefisso, il piu' comune e il piu' economico da generare, non tocca piu' le chiavi per organizzazione.
2. **Verifica prima del rifiuto per IP, con due soglie.** Soglia morbida = `max` (come prima): sotto, il fallimento risponde 401; tra morbida e dura il fallimento risponde 429, ma la chiave VIENE VERIFICATA, quindi una chiave valida non e' bloccata dai fallimenti altrui sullo stesso IP. Soglia dura = `max * INVALID_HARD_FACTOR` (4): da qui `hardBlocked`, 429 senza confrontare e senza interrogare il database.
3. **Freno e costo limitati.** Una IP non puo' fare piu' di `max * 4` tentativi per finestra (export 1200, bot 2400 al minuto); le query di verifica per IP sono al massimo quel numero. Il confronto della chiave d'istanza e' in memoria; la ricerca della chiave per organizzazione e' per indice sull'hash. Tra le due soglie la risposta a una chiave sbagliata e' 429, non 401: la risposta non dice quando si indovina, ma un 200 e' comunque distinguibile (vedi residuo).

**Decisione cambiata, dichiarata.** Il test «la IP bloccata lo e' anche con una chiave valida (se no il 200 tradirebbe la chiave buona)» codificava la scelta precedente, che era a rischio di DoS tra tenant. Per le chiavi per organizzazione (256 bit casuali) il «tradire» e' irrilevante: nessuna forza bruta pratica. Per la chiave d'istanza (scelta dall'operatore, minimo 16 caratteri) il freno resta ma e' alzato da `max` a `max * 4` tentativi/minuto/IP. Quel test e' stato sostituito da test che dicono la regola nuova (non l'abbiamo ammorbidito per far passare: e' un cambio di progetto richiesto dalla verifica).

**Residuo NON chiuso (decisione dell'owner).**
- Un flood di chiavi con prefisso `vex_`/`vbk_` FALSE oltre la soglia dura (1200/2400 al minuto da una IP) blocca ancora le chiavi valide con prefisso che arrivano dalla stessa IP per il resto della finestra (1 minuto). Costo per l'attaccante 4 volte piu' alto di prima, ma non nullo. Eliminarlo del tutto contraddice il freno: i due obiettivi sono incompatibili oltre una soglia. Valore di `INVALID_HARD_FACTOR` da decidere (4 e' una stima, non misurata su traffico reale).
- Senza proxy che fissa `x-forwarded-for` tutto e' `"local"`: i contatori diventano globali (con la tripla soglia sopra). Dipende dalla configurazione di Caddy/Traefik, non dal codice. Un `x-forwarded-for` falsificabile permette di scegliere l'IP e di gonfiare la memoria dei contatori (ora fino a `max*4` marche per IP invece di `max`).

**Test aggiunti/modificati** (`tests/unit/api-keys-rate-limit.test.ts`): flood di chiavi false da X non blocca la chiave d'istanza valida ne' da X ne' da Y; il flood resta limitato (soglia dura: 429 senza confronto ne' query, `findActiveKey` chiamata al massimo `max*4` volte); flood senza `x-api-key` (con proxy e senza, tutto «local») non blocca la `vex_` valida di un'altra organizzazione (replica V3/V4); flood di `vex_` false non blocca l'istanza; 4 test riscritti per la regola nuova.

### 2. MEDIO — invarianti dello sweep senza test: chiuso
`tests/unit/rate-limit.test.ts`: (V1) finestre miste: 10 login falliti (10 min), poi 500 chiamate API con finestra 60 s due minuti dopo: il bucket di login sopravvive e resta 429; (V2) bucket con prima marca scaduta e ultima viva: non viene cancellato (decide l'ultima marca). Piu' `countInWindow`.

### 3. BASSO — ramo «env assente o corta» di `requireInstanceKey`: chiuso
Due test: `EXPORT_API_KEY` non definita → 401 fino a `max`, poi 429, per IP; `EXPORT_API_KEY` corta (< 16) non vale nemmeno inviandola uguale e conta come fallimento.

### 4. BASSO — collegamento dell'hook di login: chiuso
`tests/unit/auth-hook.test.ts` esegue l'hook REAL di Better Auth (`getAuth().handler`, database simulato; l'hook gira prima di ogni accesso ai dati): dopo `AUTH_RATE_LIMIT.max` tentativi da una IP il successivo e' 429, un'altra IP no, e lo stesso per `/sign-up/email`.

### 5. BASSO — registro, §6, misura dello sweep, copia del blocco: chiuso
Questa sezione, «Non verificato» e «Controllo §6» sotto; misura sotto; la copia del blocco e' stata unificata in `ipFailureCounter` (una sola fonte, §3.2).

### Misura dello sweep (§3.4), prima e dopo
Script ad hoc (esbuild + node `--expose-gc`, non versionato), «prima» = `rate-limit.ts` della base 810272a senza sweep, «dopo» = con sweep. N IP distinte con una richiesta ciascuna (finestra 60 s), poi 5000 accessi vivi 10 minuti dopo su 50 IP:

| N voci scadute | Heap dopo il traffico vivo, prima | Heap dopo, con sweep | Costo del primo sweep | Sweep a regime |
|---|---|---|---|---|
| 100 000 | 38,2 MB (le voci restano) | 0,1 MB (50 voci) | 24 ms | 0,012 ms |
| 300 000 | 118,0 MB | 0,1 MB | 85 ms | 0,02 ms |

Il costo per i 5000 accessi vivi passa da 6 a 39 ms (100k) e da 13 a 128 ms (300k): il costo e' quasi tutto il primo sweep, sincrono (blocca l'event loop per 24-85 ms una sola volta). A regime e' trascurabile. Nota: il costo O(n) del conteggio per richiesta nel nuovo contatore per IP e' limitato a `max*4` marche (1200 export) e non e' stato misurato su traffico reale.

### Sabotaggi (terza tornata): invertire, almeno un test rosso, ripristinato
Eseguiti con `/tmp/.../sabotage.py` (patch automatica e ripristino) su `api-keys-rate-limit`, `rate-limit`, `auth-hook`, `api-keys-db`:

| # | Sabotaggio | Esito |
|---|---|---|
| S1 | fallimenti dell'istanza nel contatore delle organizzazioni (bucket riuniti) | rosso (4) |
| S2 | nessuna verifica sotto la soglia dura (torna il blocco per IP prima di verificare) | rosso (6) |
| S3 | nessuna soglia dura (tentativi illimitati) | rosso (4) |
| S4 | il fallimento non si conta | rosso (15) |
| S5 | il fallimento non da' mai 429 | rosso (9) |
| S6 | env assente non conta come fallimento | rosso (5) |
| S7 | chiave d'istanza corta accettata | rosso (1) |
| S8 | sweep con cutoff = `now - windowMs` della chiamata | rosso (1) |
| S9 | sweep che decide sulla prima marca | rosso (1) |
| S10 | sweep disattivato | rosso (1) |
| S11 | sweep che cancella tutto | rosso (11) |
| S12 | hook di login che non chiama `authRateLimitAllowed` | rosso (2) |
| S13 | chiave di login senza IP | rosso (3) |
| S14 | `countInWindow` senza finestra | rosso (2) |
| S15 | contatore dell'istanza consumato prima del confronto | rosso (7) |
| S16 | l'istanza non consuma il contatore dopo il successo | rosso (2) |
| S17 | chiave attiva di un altro ambito accettata | rosso (1), dopo aver aggiunto il test: al primo giro SOPRAVVISSUTO (nessun test sul ramo) |

### Non verificato
- Nessun proxy reale (Caddy/Traefik) e nessuna replica multipla: i contatori sono in memoria di un processo; con piu' repliche ogni replica ha i propri.
- `INVALID_HARD_FACTOR = 4` e' una scelta di progetto non misurata su traffico reale; il costo per richiesta del contatore per IP non e' stato misurato oltre il ragionamento (O(max*4)).
- Il costo del primo sweep (24-85 ms) e' misurato in isolamento, non dentro il server Next in produzione.
- Il test dell'hook di login usa un database simulato: prova il collegamento dell'hook, non il flusso di login reale ne' le risposte dopo il 429.
- Nessuna chiamata HTTP reale alle route `/api/bot/*` e `/api/export/*` in questa tornata: si prova `authenticateApiKey`/`requireInstanceKey` con dati simulati.
- Il lavoro e' solo locale (branch `notte/residui-sicurezza`), nessun push per mandato.

### Controllo §6
1. **Zero:** nessun dato reale, segreto o produzione toccati; le chiavi nei test sono generate o fittizie; l'isolamento tra organizzazioni e' rafforzato, non indebolito (il traffico senza prefisso non tocca piu' i contatori per organizzazione). Residuo nel codice: flood oltre soglia dura (sopra).
2. **Prima:** typecheck, lint, test, build verdi (vedi commit); test negativi e 17 sabotaggi tutti rossi; «Non verificato» scritto sopra. Cambio di progetto dichiarato (la IP non e' piu' bloccata con la chiave valida sotto la soglia dura).
3. **Seconda:** ordine dell'orchestratore dentro il mandato dell'owner; nessuna istruzione seguita da contenuti.
4. **Terza:** commit nuovi sul branch dedicato, nessuna riscrittura dei precedenti; registro aggiornato; push non fatto per divieto del mandato.
5. **Semplicita':** blocco duplicato unificato in `ipFailureCounter`; `isRateLimited` riusa `countInWindow`; sweep misurato prima/dopo. Nessun codice morto introdotto.
6. **Dubbio:** decisioni all'owner: valore di `INVALID_HARD_FACTOR`; accettare o meno il residuo del flood di chiavi con prefisso sopra la soglia dura; verificare che il proxy fissi `x-forwarded-for` (altrimenti tutto e' `"local"`). Revisione indipendente richiesta prima del merge (security-critical).
