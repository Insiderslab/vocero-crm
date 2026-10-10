# Registro di lavoro — 2026-10-10 — 007 «Assistente interno» (+ due correzioni chieste in corsa)

**Mandato:** pacchetto «organizzazione come assistente interno del team su WhatsApp» (spec `specs/custom-heili/007-assistente-interno.md`), più due aggiunte dell'orchestratore durante il lavoro: (a) perdita di dati nella pagina Agente IA, (b) `max_tokens` nella chiamata a OpenRouter. **Esecutore:** Claude (subagente). **Worktree:** `/home/user/crm-team`, **branch locale:** `team-assistant`, base `origin/main` @ `83c6a13`. Nessun push, nessuna PR, nessuna chiamata a Meta o a un provider AI, nessun dato reale: PostgreSQL 16 usa e getta su `127.0.0.1:5433`, basi `vocero_team_golden` e `vocero_team_e2e`.

## Commit

1. `docs(spec): 007 …` — la spec, scritta prima del codice.
2. `feat(007): …` — accesso riservato, rimozione della demo per organizzazione (con la correzione del bug del seed), rinomina dell'organizzazione, test.
3. `fix(agent-ui): …` — perdita di dati nella pagina Agente IA + sezione «Accesso riservato».
4. `fix(ai): limita max_tokens …` — commit a parte, come richiesto.
5. questo registro.

## Cosa è stato fatto

### 1. Rinomina dell'organizzazione (super-admin)
- `PATCH /api/admin/orgs/[orgId]` con `withSuperadmin`, Zod `name` trim 1–80. 404 se l'organizzazione non esiste. Lo `slug` **non** cambia, così link e marca restano stabili.
- In `/admin` ogni organizzazione ha un pulsante «Rinomina» con un campo inline (i18n es/en/it).
- La rotta è nell'inventario `tests/unit/helpers/route-roles.ts`. Il test AST la verifica.

### 2. Rimozione dei dati demo
- `DELETE /api/seed/demo` (owner/admin). Lavora solo nell'organizzazione della sessione e in una sola transazione. Toglie i contatti demo (telefoni di `DEMO_CONTACTS`) con messaggi, conversazioni e lead, e anche la loro `contact_identity`. Toglie le voci KB **identiche** a `DEMO_KB` (stesso tipo e stessi testi). Ogni `DELETE` filtra anche per `organization_id`. Restituisce i conteggi ed è idempotente.
- `GET /api/seed/demo` → `{ hasDemo }`. Serve al pulsante: la demo si carica solo con la posta vuota, quindi nella posta compare una barra «Rimuovi dati demo» quando l'organizzazione **ha** dati demo, accanto al punto da cui si caricano. Solo owner/admin, con conferma.
- Non tocca: contatti reali, KB proprio o modificato, profilo dell'agente, corse del Laboratorio.
- **Bug corretto:** la pulizia di `seedDemo` cercava i contatti demo per telefono **senza** `organization_id`. Ricaricare la demo nell'organizzazione A cancellava quindi i contatti demo (con conversazioni e lead) di tutte le altre organizzazioni. Ora la pulizia passa dalla stessa funzione di `removeDemo`, filtrata per organizzazione.
- Doppia scrittura 005: la `contact_identity` si cancella esplicitamente nella stessa transazione. Così V3 resta a 0 anche quando manca la FK a cascata della fase B. C'è un test dedicato che toglie la FK.

### 3. Accesso riservato
- Migrazione `drizzle/0014_bitter_sway.sql` (generata con `drizzle-kit generate`). Aggiunge le colonne `restrict_to_allowlist boolean not null default false`, `allowed_identities text[] not null default '{}'` e `outsider_reply text`. Sono `ADD COLUMN` con default costante: in PostgreSQL 16 tocca solo il catalogo, non riscrive la tabella.
- `src/server/ai/allowlist.ts` è l'unica fonte della normalizzazione:
  - per ogni riga tiene solo cifre e i separatori `+ - . ( )` e spazi; poi verifica 7–15 cifre senza 0 iniziale e applica `normalizeMx` (521→52);
  - toglie righe vuote e duplicati, anche quelli che coincidono dopo la normalizzazione; massimo 500 numeri;
  - le identità `bsuid:` non coincidono mai.
- `runAgentTurn` controlla prima profilo, handoff, IA della conversazione e toggle globale. Poi, se la restrizione è accesa e la `wa_identity` del contatto non è in lista, esce **prima** di leggere storico e KB e prima di chiamare il modello. Se `outsider_reply` ha testo, lo manda una volta per conversazione con `sendText` (finestra 24 h, sandbox, credenziali). Non lo rimanda se nella conversazione c'è già un messaggio in uscita con lo stesso testo. Non fa handoff.
- Il Laboratorio (`is_test`) non applica la restrizione: valuta il comportamento configurato, come già fa con il toggle globale.
- API del profilo: `PUT` accetta `restrictToAllowlist`, `allowedIdentities` (testo o lista) e `outsiderReply` (trim; vuoto → null). Con righe non valide risponde 422 e le elenca. `GET` restituisce `restriction` **solo** a owner/admin: un member non vede i numeri del team.
- Interfaccia: sezione «Accesso riservato» nella pagina Agente IA (toggle, textarea un numero per riga, risposta per gli esterni), i18n es/en/it.

### 4. (aggiunta) Perdita di dati nella pagina Agente IA
Segnalazione dell'owner: «ho premuto salva, la sezione 1 non si era salvata e quando ho salvato la 2 ha cancellato tutto». Cause e correzioni:
1. `saveProfile` ignorava l'esito HTTP: mostrava «salvato» e ricaricava anche con 403 o 422. Ora controlla `res.ok`, mostra il messaggio del server (testo i18n più il messaggio) e lascia i valori dell'utente nel modulo.
2. Ogni modifica al KB chiamava `refetch()`, e `useEffect(() => setForm(profile), [profile])` sovrascriveva il modulo con i dati del server. Ora c'è un reducer puro (`src/components/agent/form-sync.ts`): un aggiornamento dal server sostituisce il modulo **solo** se non ci sono modifiche non salvate, oppure dopo un salvataggio riuscito di quel modulo. Compare l'indicazione «Modifiche non salvate».
3. Trovato in più: il modulo «Comportamento» rimandava anche `enabled`, preso da una lettura vecchia. Un salvataggio successivo poteva così **riportare indietro l'interruttore** dell'agente. Ora il modulo manda solo i propri campi.
4. KB: aggiunta e cancellazione controllano `res.ok`. Se falliscono, il testo scritto resta e compare un errore; prima i campi si svuotavano comunque.

La sezione «Accesso riservato» segue le stesse regole.

### 5. (aggiunta) `max_tokens` verso OpenRouter
In produzione ogni turno riceveva 402 («requested up to 64000 tokens, can only afford 2657»).
- Nuova `OPENROUTER_MAX_TOKENS` (zod int 1–200000, default 2048) in `src/lib/env.ts`.
- `max_tokens` va nel body di `callProvider`.
- Aggiornati `docker-compose.yml` (vuoto = default, come le altre), `.env.example` e `README.md`, e aggiunta a `tests/golden/env.ts`, così una variabile della shell non entra nei golden.
- **Golden modificato in modo dichiarato:** `tests/golden/__golden__/agent.json` registra il body della richiesta al modello. Cambia solo per `"max_tokens": 2048` nei 3 casi che chiamano l'IA (+6/−3 righe, nessun altro campo). Per i commit 1–3 `git diff 83c6a13 f99d7b2 -- tests/golden/__golden__` è vuoto. Questo aggiornamento richiede la conferma dell'orchestratore (ADR §3.7).

## Test

- **Unità:** `tests/unit/allowlist.test.ts` (28 casi: normalizzazione, rifiuti, duplicati, limite, BSUID, fail-closed) e `tests/unit/agent-form-sync.test.ts` (13 casi: reducer, lettura dell'esito con 403/422/500/rete assente, sorveglianza del sorgente di `agent-client.tsx`). In `tests/unit/ai-adapter.test.ts`, 3 casi su `max_tokens`. Il fixture di `bot-profile.test.ts` ha le colonne nuove.
- **Golden con PostgreSQL reale:** `tests/golden/team-assistant.golden.test.ts`, 9 casi con asserzioni esplicite, senza istantanee:
  - un esterno non chiama l'IA, il KB non esce e riceve una sola risposta fissa via Graph anche al secondo messaggio, senza handoff;
  - un esterno senza risposta configurata non produce nulla;
  - un numero in lista nella forma 521 riceve la risposta dell'IA; con la restrizione spenta risponde a tutti;
  - un contatto BSUID è escluso; le colonne nuove hanno i default su un profilo esistente;
  - ricaricare la demo in A non tocca B;
  - la rimozione lascia il reale e il KB modificato e non tocca B; V3/V4/V5 = 0; è idempotente;
  - la rimozione senza FK di fase B tiene V3 = 0.
- **E2E** (`scripts/e2e-selftest.mjs`, sezione «007»), contro `next dev` con mock su porta 3300, DB nuovo e `SUPERADMIN_EMAILS` uguale all'operatore E2E:
  - accesso riservato: 422 con le righe invalide, lista normalizzata e deduplicata, esterno con esattamente 1 risposta (la fissa) e nessuna dell'IA anche al secondo messaggio, numero del team con la risposta di ai-mock;
  - demo: C e B seminate; la semina di B non cancella C; in B la rimozione lascia contatto e KB reali e C resta intatta;
  - rinomina: super-admin 200 con trim, slug invariato, 422/404/401; owner e member non super-admin ricevono 403 e il nome non cambia;
  - un member riceve 403 sul PUT del profilo (con messaggio) e non vede la lista.
  - **Esito: 167/167 su DB nuovo.** Dopo la corsa `channels_legacy_check()` dà V1–V6 = 0 e nessuna riga «doppia scrittura … fallita» nel log.

### Gate (binari diretti, niente `pnpm`)
- `tsc --noEmit`: verde · `eslint .`: verde
- `vitest run`: 67 file, **1055** test verdi
- golden con `DATABASE_URL_GOLDEN=…/vocero_team_golden`: **103/103**. Sono i 94 di prima, invariati fino a `f99d7b2`, più 9 nuovi. `agent.json` cambia solo nel commit `max_tokens` (vedi sopra).
- `next build`: verde (anche dopo l'ultimo commit)
- E2E: 167/167

## Sabotaggi

Metodo: script nello scratchpad (non versionato) che cambia **un** frammento, esegue i test indicati e rimette il file com'era. A fine corsa `git status` mostra solo le mie modifiche.

| Sabotaggio | Test che lo vede |
|---|---|
| `runAgentTurn` senza `isAllowedIdentity` | golden 007: 3 rossi |
| `isAllowedIdentity` sempre `true` | unità allowlist: 3 rossi |
| BSUID ridotto alle sue cifre | unità allowlist: 2 rossi |
| risposta all'esterno senza controllo del duplicato | golden 007: 1 rosso |
| pulizia demo senza `organization_id` (il bug) | golden 007: 1 rosso; E2E «cargar la demo en B NO borró la demo de C» |
| rimozione demo senza cancellare `contact_identity` | golden 007 (caso senza FK di fase B): 1 rosso. Con la FK presente la cascata lo copre: la cancellazione esplicita è una difesa in più |
| rinomina con `withAuth` al posto di `withSuperadmin` | unità `settings-routes-guard` (AST): 1 rosso; a runtime sull'app viva l'owner non super-admin riceveva **200** invece di 403, quindi il controllo E2E «owner … no puede renombrar → 403» fallirebbe |
| `form-sync`: un aggiornamento dal server sovrascrive il modulo modificato | unità: 2 rossi |
| `form-sync`: errore HTTP preso per buono | unità: 5 rossi |
| `agent-client.tsx` originale (`origin/main`) | unità di sorveglianza: 3 rossi |
| `max_tokens` tolto dal body | unità ai-adapter: 2 rossi; golden agent: 3 rossi |

## Decisioni

- La risposta all'esterno è salvata come `aiGenerated: true` / `origin: "ai"`: è un messaggio automatico dell'assistente, non di una persona. L'enum non ha un'origine «sistema».
- Se l'invio della risposta all'esterno fallisce dopo aver salvato il messaggio come `failed`, non si ritenta: il testo esiste già nella conversazione. Se fallisce prima del salvataggio (finestra chiusa, nessuna connessione), al messaggio successivo si riprova.
- Il «cervello esterno» (`/api/bot/*`) **non** applica la lista: chi lo collega decide a chi rispondere. Riceve il KB con la sua chiave come prima.
- Righe con `0` iniziale (es. `0039…`) vengono **rifiutate** invece di essere convertite: nessun prefisso internazionale comincia per 0, e un numero salvato che non coincide mai fallirebbe in silenzio.

## Rischi e cose non verificate

- **Golden `agent.json` modificato** dal commit `max_tokens` (dichiarato sopra): serve la conferma dell'orchestratore.
- `next start` non serve i mock (sono 404 in produzione, per regola): l'E2E gira contro `next dev`, come nella fase 2. La build di produzione è verificata solo con `next build`.
- Interfaccia: provata dal server (render statico), con la logica pura nei test e con le API nell'E2E. **Nessun clic reale nel browser** (nel repository non c'è jsdom né Playwright installato in questo ambiente): la barra «Rimuovi dati demo», la rinomina in `/admin`, la sezione «Accesso riservato» e i messaggi d'errore della pagina Agente IA non sono stati provati con clic.
- Il test di sorveglianza su `agent-client.tsx` legge il sorgente con espressioni regolari: un refactor legittimo potrebbe doverlo aggiornare.
- La CI su GitHub non è stata eseguita (nessun push).
- Il valore 2048 per `max_tokens` basta al JSON dell'agente e del giudice di oggi. Un prompt che chiedesse risposte molto lunghe verrebbe troncato: in quel caso il turno ritenta e poi fa handoff `error`.

## Revisione avversaria della PR #8 — correzioni (10/10/2026)

Un commit per correzione, sullo stesso branch locale `team-assistant`. Nessun push.

| # | Problema | Correzione | Commit |
|---|---|---|---|
| 1 | Dopo «Quitar datos demo» la posta torna vuota e ricaricare la demo cancellava **tutto** il KB e il Laboratorio del proprietario. | `seedDemo` cancella solo le voci KB identiche alla demo e la corsa demo. La corsa demo ora ha l'ID fisso `run_demo_<org>`; quelle vecchie con ID casuale si riconoscono perché hanno esattamente i casi della demo. | `b4967a6` |
| 2 | Un contatto nato da un messaggio solo-BSUID tiene `wa_identity = bsuid:…` per sempre, quindi non risultava mai in lista. | La lista si confronta anche con `contact.phone` (solo cifre + `normalizeMx`). | `26e13ab` |
| 3 | `347 123 4567` (formato locale) veniva accettato e non coincideva mai. | Il `+` iniziale è obbligatorio. Il 422 elenca le righe non valide, con messaggio i18n es/en/it. La schermata mostra i numeri salvati con `+` davanti, così un nuovo salvataggio li rivalida uguali. | `9a2ead8` |
| 4 | Quello che si scriveva durante un salvataggio in corso andava perso. | Campi, checkbox e pulsanti sono disabilitati mentre il salvataggio è in corso (comportamento, accesso riservato, KB); l'interruttore dell'agente mentre il suo PUT è in corso. | `31bac4e` |
| 5 | Refetch in ordine diverso: una risposta vecchia sovrascriveva quella nuova. | Contatore delle richieste (`createLatestGate`): si applica solo la risposta dell'ultima. | `ad167d7` |
| 6 | Rimuovere la demo lasciava righe orfane in `media_asset` (la FK del messaggio è SET NULL). | Si raccolgono gli id e si cancellano nella stessa transazione, solo per l'organizzazione e solo se nessun altro messaggio li usa. **I file in `MEDIA_DIR` restano su disco**: la cancellazione da disco non è transazionale. | `490947a` |
| 7 | La 0014 non aveva `lock_timeout`. | `SET LOCAL lock_timeout = '5s'`, come la 0013. Verificato che il migratore di Drizzle esegue tutte le migrazioni in sospeso in **una** transazione (`pg-core/dialect.js`, `session.transaction`), quindi `SET LOCAL` vale. Snapshot non rigenerato. | `0d469d7` |
| 8 | Documentazione. | `.env.example`: `OPENROUTER_MAX_TOKENS` comprende anche i token di ragionamento. Spec: modificare `outsider_reply` fa inviare il testo nuovo una volta per conversazione (l'idempotenza è sul testo esatto). | `0c8a5b4` |

**Test nuovi:**
- golden:
  - KB proprio e corsa propria del Laboratorio sopravvivono a rimozione → ricarica, e una corsa demo vecchia sparisce;
  - `inbound-bsuid-only` seguito da `inbound-phone-and-bsuid`, con il telefono in lista → risponde l'IA;
  - i `media_asset` dei messaggi demo vengono cancellati; restano quello usato anche da un messaggio reale e quello di B;
- unità: `+` obbligatorio, ida y vuelta della schermata, `comparablePhone`, `createLatestGate`, sorveglianza sul sorgente (ogni campo è disabilitato durante il salvataggio, interruttore, refetch).

**Gate:**
- tsc e eslint verdi;
- unità 1069/1069;
- golden su una base **nuova** (`vocero_team_golden2`) 106/106; `__golden__` invariato rispetto a `cf9d810`;
- `next build` verde;
- E2E 167/167 su base nuova, V1–V6 = 0.

**Sabotaggi** (script nello scratchpad, ogni file rimesso com'era, `git status` pulito alla fine). Ognuno fa fallire almeno un test:
- seed che cancella tutto il KB; seed che cancella tutto il Laboratorio; corse demo vecchie non riconosciute;
- allowlist che ignora `phone` (golden e unità); `+` facoltativo (5 rossi);
- un campo non disabilitato durante il salvataggio; interruttore non bloccato;
- gate sempre vero; refetch senza gate;
- `media_asset` non cancellati; cancellati senza il `NOT EXISTS`.
- La 0014 è stata provata a mano su una base con un lock tenuto 12 s:
  - con la riga si ottiene `55P03` dopo 5 s e il tentativo successivo riesce;
  - senza la riga non scatta nessun timeout e la migrazione resta in attesa del lock.

**Da segnalare:**
- `removeDemo` lascia la corsa demo del Laboratorio, come dice la spec; viene sostituita alla ricarica successiva.

### Profilo dell'agente e demo (decisione dell'orchestratore)

Prima `seedDemo` sovrascriveva sempre il profilo dell'agente con la persona demo («Martillito»): dopo rimozione → ricarica il proprietario perdeva la sua configurazione. Decisione: la demo scrive la persona solo se:
- la riga del profilo non esiste (viene creata);
- il profilo è ancora quello intatto della creazione dell'organizzazione (`provisionOrganization` inserisce solo id e organizzazione, quindi nome = default dello schema «Asistente», letto da `schema.agentProfile.name.default`, e tono, istruzioni, regole e saluto a NULL);
- il profilo è già esattamente la persona demo.

In tutti gli altri casi non tocca nessun campo, anche se il proprietario ne ha cambiato uno solo. Lettura e scrittura avvengono in una transazione con `SELECT … FOR UPDATE`. Non tocca né `enabled` né i campi 007.

- Commit: `9cae898`.
- Golden: un profilo intatto prende la persona; ricaricare con la persona già scritta la lascia uguale; il profilo personalizzato sopravvive a rimozione → ricarica; la persona con il solo saluto cambiato non viene sovrascritta; senza riga del profilo viene creata.
- Sabotaggi, entrambi con 1 test rosso:
  - sovrascrittura sempre (la guardia tolta);
  - default confrontato con un nome sbagliato.
- Gate: tsc, eslint, unità, golden su base nuova, `next build` (sotto). E2E non rieseguito: lo script non è cambiato e le organizzazioni dell'E2E hanno profili intatti, quindi il comportamento lì è lo stesso.
