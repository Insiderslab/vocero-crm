# Registro di lavoro — 2026-10-10 — ruoli-whatsapp

**Mandato:** falla trovata nella notte (fuori perimetro di C3): le route della connessione WhatsApp non controllano il ruolo. **Esecutore:** Claude. **Branch locale:** `notte/ruoli-whatsapp` (nessun push, nessuna PR). **Security-critical:** sì (permessi su credenziali e segreto del webhook): serve una revisione indipendente prima del merge.

Base: `810272a` (`origin/claude/keen-ptolemy-l0kv8g`). Baseline: 45 file, 349 test verdi.

## La falla

Un `member` (ruolo più basso) poteva, nella propria organizzazione:

| Route | Prima | Conseguenza |
|---|---|---|
| `PUT /api/settings/whatsapp` | solo `withAuth` | sostituire WABA, numero e token dell'organizzazione (il token viene ri-validato su Meta, cifrato e salvato) |
| `POST /api/settings/whatsapp/test` | solo `withAuth` | usare il CRM per provare token arbitrari contro Meta |
| `GET /api/settings/whatsapp` | solo `withAuth` | leggere WABA ID, phone number ID, stato e ultime 4 cifre del token |
| `GET /api/settings/webhook` | solo `withAuth` | leggere `META_WEBHOOK_VERIFY_TOKEN`, cioè il segmento segreto dell'URL del webhook (`/api/webhooks/wa/<token>`) |

Nessuna esposizione tra organizzazioni: tutte le query erano già per `session.organizationId`. Il difetto era solo di ruolo, dentro la stessa organizzazione.

## Correzione

**Una sola fonte (§3.2).** `src/lib/roles.ts` ora ha `isOrgAdmin(role)` (owner/admin, fail-closed su qualunque altro valore, comprese maiuscole e stringa vuota). `canManageApiKeys` (invariata nel comportamento) e il nuovo `canManageWhatsapp` ne sono viste con nome: le regole non possono divergere.

**Una sola guardia per le route.** `withAdminAuth(handler)` in `src/lib/api.ts`: come `withAuth`, ma risponde 403 `forbidden` a chi non è owner/admin **prima** di leggere il body, interrogare il DB o chiamare Meta. È usata da:
- `GET` e `PUT` di `src/app/api/settings/whatsapp/route.ts`;
- `POST` di `src/app/api/settings/whatsapp/test/route.ts`;
- `GET` di `src/app/api/settings/webhook/route.ts`.

**Pagina.** `/settings/whatsapp` mostra solo l'avviso `settings.whatsapp.forbidden` (es/en/it) a member e senza sessione, come già `/settings/api-keys`. Prima un member vedeva il wizard con le chiamate che ora falliscono.

## Verifica di TUTTE le route sotto `src/app/api/settings/**`

| Route | Metodo | Controllo di ruolo | Esito |
|---|---|---|---|
| `whatsapp` | GET, PUT | ora `withAdminAuth` | **corretto** |
| `whatsapp/test` | POST | ora `withAdminAuth` | **corretto** |
| `webhook` | GET | ora `withAdminAuth` | **corretto** |
| `bot-keys`, `bot-keys/[id]` | GET, POST, DELETE | `canManageApiKeys` | già ok |
| `export-keys`, `export-keys/[id]` | GET, POST, DELETE | `canManageApiKeys` | già ok |
| `team` | POST | `role !== "owner"` (solo owner) | già ok |
| `team` | GET | nessuno | **eccezione documentata**: elenca nome, email e ruolo dei membri della propria organizzazione; la usa la schermata Team per qualunque membro. Decisione dell'owner se restringerla |
| `branding` | PUT | `role !== "owner"` | già ok (più stretto di admin) |
| `branding` | GET | nessuno | pubblico a progetto (il login ha bisogno della marca); restituisce solo la marca dell'organizzazione della sessione |
| `branding/favicon` | PUT, DELETE | `role !== "owner"` | già ok |

Nessun'altra route di modifica sotto `settings/**` è senza controllo di ruolo.

## Test

Nuovi, 38 in 3 file:
- `tests/unit/settings-whatsapp-routes.test.ts` (due organizzazioni):
  - member → 403 su ciascuna delle 4 operazioni, senza alcuna lettura, prova su Meta, scrittura o sottoscrizione, e senza che il corpo della risposta contenga WABA, token o segreto del webhook;
  - ruoli sconosciuti (`""`, `Owner`, `ADMIN`, `viewer`, `superadmin`) → 403 su tutte (fail-closed);
  - senza sessione → 401;
  - owner e admin → 200 su tutte; del token escono solo le ultime 4 cifre;
  - lo stesso utente member in A (anche se owner in B) → 403 su A;
  - isolamento: l'owner di B legge solo la connessione di B (mai WABA, phone ID o token di A); un'organizzazione senza connessione non riceve quella di un'altra; salvare come B scrive in B anche se il corpo nomina `org_a`; un member di A che conosce il `wabaId` di A non sostituisce nulla.
- `tests/unit/settings-whatsapp-page.test.ts`: la pagina (member e senza sessione → solo avviso; owner/admin → wizard); `canManageApiKeys` e `canManageWhatsapp` coincidono con `isOrgAdmin` per 7 valori di ruolo.
- `tests/unit/settings-routes-guard.test.ts`: guardrail strutturale. Ogni handler esportato sotto `src/app/api/settings/**` deve avere un controllo di ruolo o figurare, con il motivo, nella lista delle eccezioni (oggi 2: `team` GET, `branding` GET); un'eccezione che non esiste più fa fallire il test. Contiene anche i test di sabotaggio dello scanner stesso (una route sabotata viene segnalata).

Nessun test esistente è stato modificato.

## Sabotaggio (eseguito, poi ripristinato)

| Sabotaggio | Esito |
|---|---|
| in `withAdminAuth` il controllo diventa `if (false)` | 11 test falliti (route) |
| `withAuth` al posto di `withAdminAuth` in `whatsapp/route.ts` | 11 falliti (route + guardrail) |
| idem in `whatsapp/test/route.ts` | 9 falliti |
| idem in `webhook/route.ts` | 9 falliti |
| pagina senza controllo (`false` al posto di `!canManageWhatsapp(...)`) | 1 fallito (member vedrebbe il wizard) |

## Prove

| Comando | Esito |
|---|---|
| `pnpm typecheck` | ok |
| `pnpm lint` | ok |
| `pnpm test` | **48 file, 387 test** verdi (baseline 45/349, +38) |
| `pnpm build` | ok |
| `pnpm db:generate` | non necessario: nessuna modifica allo schema |

## Non verificato

- Nessuna prova contro un database reale né contro Meta: le route sono provate con sessione e moduli WhatsApp sostituiti da doppioni (come `bot-keys-routes.test.ts`). Il ruolo viene da `requireSession`/`resolveMembership`, non toccati.
- Non eseguito l'E2E con Playwright (richiede app viva e mock).
- Non verificata a mano la UI dei member dopo il cambio (solo rendering lato server della pagina).

## Da segnalare all'owner (fuori perimetro, non toccato)

1. **Voce "WhatsApp" in `SettingsNav` e redirect `/settings` → `/settings/whatsapp`** restano per tutti: un member che apre Impostazioni atterra sull'avviso di divieto. Decisione di prodotto: nascondere la voce ai member e reindirizzarli a `/settings/team` (richiede di cambiare `settings-nav.test.ts`, che oggi afferma che il member la vede).
2. **`POST /api/templates/sync`** (`src/app/api/templates/sync/route.ts`) e le altre route di `src/app/api/templates/**` usano solo `withAuth`: un member può sincronizzare e, da verificare, creare modelli da far approvare a Meta con le credenziali dell'organizzazione. Non è lettura di segreti, ma è azione esterna: da decidere se serve owner/admin.
3. **L'URL del webhook è globale**, non per organizzazione: `META_WEBHOOK_VERIFY_TOKEN` è una variabile d'ambiente unica, e `GET /api/settings/webhook` la mostra a ogni organizzazione (ora solo ai suoi owner/admin). In un'istanza con più organizzazioni, l'admin di un'organizzazione conosce il segreto dell'URL usato da tutte. Per il multi-cliente (visione del piano) serve un segreto per organizzazione: decisione di architettura, non banale.
4. `branding` e `team` usano `role !== "owner"` in linea, non la regola unica: corretti ma duplicati. Candidati a una `isOrgOwner` in `roles.ts` (refactor separato).

---

# Terza tornata — 2026-10-10 — estensione del pacchetto e chiusura dei rilievi

**Mandato:** estendere il pacchetto alle route fuori da `settings/**` con effetti sensibili (creazione e sync dei modelli verso Meta, profilo dell'agente, ecc.), con inventario completo di `src/app/api/**`; una sola fonte per il 403 e per il controllo «solo owner»; guardrail non aggirabile; voce WhatsApp nascosta ai member e `/settings` su una pagina visibile. **Esecutore:** Claude. Stesso branch locale `notte/ruoli-whatsapp`, solo commit nuovi (nessun push, nessuna PR). **Security-critical:** sì, serve revisione indipendente prima del merge.

Base di questa tornata: `a03d582`. Baseline: 48 file, 387 test verdi.

## Rilievi della verifica precedente

| # | Rilievo | Esito | Dove |
|---|---|---|---|
| 1 | Guardrail aggirabile (`session.role` nel JSON, nome nel commento, `export { PUT }`, `= handlers.PUT`) | **Chiuso**: il guardrail ora legge l'AST TypeScript e verifica quale funzione, importata da quale modulo, avvolge ogni handler. Tutti i rodeggi della sonda sono test di sabotaggio dello scanner. Funzione tolta dal file di test e spostata in `tests/unit/helpers/route-scan.ts` | `settings-routes-guard.test.ts`, `helpers/route-scan.ts`, `helpers/route-roles.ts` |
| 2 | 403 in due copie; «solo owner» scritto in linea in 4 punti | **Chiuso** (commit `refactor:` separato): `withRoleAuth` in `api.ts` è l'unico punto che emette il 403 per ruolo (test: il codice `"forbidden"` compare solo in `src/lib/api.ts`); `isOrgOwner` in `roles.ts` e `withOwnerAuth` sostituiscono i 4 `session.role !== "owner"`; le route delle chiavi usano `withAdminAuth` e `api-keys-admin.ts` espone solo logica | `src/lib/api.ts`, `src/lib/roles.ts`, `src/server/api-keys-admin.ts` |
| 3 | `POST /api/templates`, `POST /api/templates/sync`, `PUT /api/agent/profile` (e simili) senza controllo di ruolo | **Chiuso** per le 27 operazioni con effetto su configurazione o Meta (tabella sotto) | route elencate sotto |
| 4 | Voce WhatsApp in SettingsNav e `/settings` → `/settings/whatsapp` per i member | **Chiuso**: i member non vedono WhatsApp, Modelli e Chiavi API; `/settings` porta owner/admin a WhatsApp e tutti gli altri (e chi non ha sessione) a `/settings/team`. `settings-nav.test.ts` aggiornato come richiesto | `settings-nav.tsx`, `settings/page.tsx` |

Nessun rilievo lasciato aperto. Restano **decisioni di prodotto** (sezione sotto), non difetti.

## Commit di questa tornata

1. `refactor(ruoli): una sola fonte per il 403 e per il controllo "solo owner"` (stesso comportamento; cambia solo il testo del messaggio 403 di team, marca e chiavi, ora uno per guardia; unica modifica a un test esistente: nel guardrail di settings si è aggiunto `withOwnerAuth` tra i controlli riconosciuti, senza indebolirlo; poi riscritto nel commit 2).
2. `fix(sicurezza): solo owner/admin sulle route che cambiano la configurazione o parlano con Meta` (route, guardrail per AST, inventario, prova di comportamento).
3. `feat(ruoli): menu e pagine coerenti con il ruolo, /settings porta i member a una pagina visibile`.
4. `test(ruoli): il guardrail non accetta export per destrutturazione né 'export *'`.

## Inventario route → ruolo richiesto (95 handler, 76 file `route.ts`)

La fonte è `tests/unit/helpers/route-roles.ts`: il test fallisce se una route o un metodo nuovo non è nell'inventario, se un'entrata non esiste più o se la funzione che protegge l'handler (letta dall'AST) non è quella della sua politica.

**Solo owner/admin (`withAdminAuth`), 23 handler**

| Route | Metodi | Perché |
|---|---|---|
| `settings/whatsapp` | GET, PUT | credenziali e dati della connessione (Meta) — già dal pacchetto |
| `settings/whatsapp/test` | POST | prova un token contro Meta — già |
| `settings/webhook` | GET | segmento segreto del webhook — già |
| `settings/bot-keys`, `settings/export-keys` | GET, POST | chiavi di servizio (ora con `withAdminAuth` della route) |
| `settings/bot-keys/[id]`, `settings/export-keys/[id]` | DELETE | revoca chiavi |
| **`templates`** | **POST** | crea il modello e lo invia a Meta con le credenziali dell'organizzazione |
| **`templates/sync`** | **POST** | parla con Meta con le stesse credenziali |
| **`agent/profile`** | **PUT** | cambia nome, tono, istruzioni e attivazione dell'agente AI |
| **`automations`** | **POST** | crea una regola di invio di modelli a tutti i contatti con una etichetta |
| **`automations/[id]`** | **PATCH, DELETE** | modifica o cancella la regola |
| **`automations/run`** | **POST** | esegue subito le regole: invia modelli per Meta |
| **`kb`** | **POST** | il sapere è ciò che l'agente risponde ai clienti |
| **`kb/[id]`** | **PATCH, DELETE** | idem |
| **`lab/runs`** | **POST** | lancia il Laboratorio: costo del provider AI, dati di prova |
| **`lab/suggestions/apply`** | **POST** | scrive nella base di conoscenza dell'agente |
| **`seed/demo`** | **POST** | carica i dati demo nell'organizzazione (anche il bottone nell'inbox vuota è ora solo admin) |

**Solo owner (`withOwnerAuth`), 4 handler:** `settings/branding` PUT, `settings/branding/favicon` PUT e DELETE, `settings/team` POST (invariati nel comportamento; ora senza controllo in linea).

**Qualsiasi membro autenticato (`withAuth`, il ruolo non si guarda), 32 handler** — lavoro quotidiano su contatti, conversazioni e pipeline, e letture:
`agent/profile` GET, `templates` GET (serve al member per inviare un modello in una conversazione), `automations` GET, `automations/[id]/runs` GET, `kb` GET, `kb/size` GET, `lab/runs` GET, `lab/runs/[id]` GET, `contacts` GET/POST, `contacts/[id]` GET/PATCH, `contacts/[id]/tags` PUT, `contacts/[id]/start-conversation` POST, `conversations` GET, `conversations/[id]` PATCH, `conversations/[id]/messages` GET/POST, `.../messages/media` POST, `.../messages/template` POST (invio di un modello già approvato dentro una conversazione: è il lavoro del member, parla con Meta ma è il caso d'uso centrale), `pipeline/board` GET, `pipeline/leads/[id]` PATCH, `pipeline/stages` GET/POST, `pipeline/stages/[id]` PATCH/DELETE, `tags` GET/POST, `tags/[id]` DELETE, `media/[assetId]` GET, `my-orgs` GET, `settings/team` GET (**eccezione documentata**, già dalla prima tornata).

**Altre forme di accesso, 40 handler:** `admin/orgs*` (super-admin, 4), `bot/*` (chiave di servizio del bot, 8), `export/*` (chiave di export, 4), `events` (SSE con sessione, 1), `webhooks/wa/[token]` (segmento segreto e firma di Meta, 2), `auth/*` (Better Auth, 2), `health` (1), `branding/favicon` GET (pubblica, 1), `settings/branding` GET (pubblica a progetto, **eccezione documentata**, 1), `dev/*` (mock con `mockGuard`, 404 in produzione, 12).

## Come funziona il guardrail e cosa non vede

- `scanHandlers` (AST) legge `export const X = f(...)`, `export async function X`, `export { X }`, `export { X as Y }`, `export { X } from "./altro"`; `export const { GET } = ...` e `export * from` sono «non risolvibili» e **falliscono** (fail-closed). Non contano commenti, stringhe, `session.role` in un JSON, alias di import (`import { withAuth as withAdminAuth }` risulta `withAuth`), guardie locali omonime né guardie importate da un altro modulo.
- Un controllo di ruolo scritto in linea dentro un `withAuth` **non** vale come controllo: la politica `admin` richiede `withAdminAuth`. È voluto (una sola fonte).
- `tests/unit/route-roles-behavior.test.ts` esegue i 27 handler owner/admin con ruoli `member`, vuoto, `Owner`, `ADMIN`, `viewer`, `superadmin` (e `admin` sulle route solo owner): 403 prima di leggere il body, senza toccare il DB (il doppione lo fa fallire e lo conta) e senza chiamate `fetch` (cioè Meta); owner/admin passano la guardia; senza sessione 401. 240 test.
- **Limiti:** la classificazione «member vs admin» di una route nuova resta un giudizio umano (il test obbliga a farla, non la fa); per `bot-key`, `export-key`, `webhook-token` e `dev-mock` si verifica che la funzione di autenticazione sia chiamata, non che l'esito venga rispettato (lo coprono i test già esistenti di quelle superfici); le route `public` non sono controllate.

## Test

| Comando | Esito |
|---|---|
| `pnpm install --frozen-lockfile` | non necessario (`node_modules` già allineato al lockfile) |
| `pnpm typecheck` | ok |
| `pnpm lint` | ok |
| `pnpm test` | **54 file, 750 test** verdi (baseline 48/387, +363) |
| `pnpm build` | ok |
| `pnpm db:generate` | non necessario: nessuna modifica allo schema |

Nuovi file di test: `api-role-guards.test.ts` (37), `route-roles-behavior.test.ts` (240), `settings-entry.test.ts` (8), `admin-only-pages.test.ts` (32), `app-nav-roles.test.ts` (6), `inbox-demo-seed.test.ts` (7); riscritto `settings-routes-guard.test.ts` (37); aggiornato `settings-nav.test.ts` (11).

## Sabotaggio (eseguito, poi ripristinato)

| Sabotaggio | Esito |
|---|---|
| `withRoleAuth`: `if (false)` al posto del controllo | 27 test rossi (commit 1), 162 con la prova di comportamento |
| `withOwnerAuth` che usa `isOrgAdmin` | 1 rosso |
| `team` POST, favicon PUT, lista chiavi con `withAuth` | 2 rossi ciascuno |
| `POST /api/templates` con `withAuth` | 7 rossi (guardrail + comportamento) |
| `templates/sync` con `import { withAuth as withAdminAuth }` | 7 rossi |
| `agent/profile` PUT con `withAuth` e controllo di ruolo in linea | 1 rosso (solo l'AST: la guardia unica è richiesta) |
| `kb/[id]` DELETE con guardia locale `const withAdminAuth = withAuth` | 18 rossi |
| `isOrgAdmin` che include `member` | 23 rossi |
| route nuova non in inventario / con `export const { GET }` | segnalata (1 rosso) |
| scanner senza il ramo della destrutturazione | 1 rosso |
| UI: tab WhatsApp senza regola / tab Modelli senza regola | 6 rossi ciascuno |
| UI: `/settings` sempre a whatsapp / fail-open senza sessione | 6 / 1 rossi |
| UI: `adminOnly` sempre aperto / fail-open senza sessione | 24 / 4 rossi |
| UI: AppNav senza filtro / bottone demo sempre visibile | 4 / 5 rossi |

## Non verificato

- Nessuna prova contro database o Meta reali: i test usano sessione e DB sostituiti da doppioni; il ruolo viene da `requireSession`/`resolveMembership`, non toccati.
- E2E Playwright non eseguito (richiede app viva e mock). In particolare **non provato a mano** che un member non incontri più errori nelle schermate (inbox, pipeline, contatti, invio di un modello da una conversazione) e che owner/admin vedano tutto come prima: la UI è provata solo con rendering lato server.
- Non verificato se gli script E2E in `tests/e2e/` assumano un utente `member` con accesso a agente, Laboratorio, automazioni o modelli (nessun test E2E li nomina con il ruolo `member`, ma non sono stati eseguiti). Il super-admin creato da `/api/admin/orgs` è owner, quindi non è toccato.
- Il testo del messaggio 403 di team, marca e chiavi è cambiato (uno per guardia): non verificato che nessun client lo mostri o lo confronti (nessun test e nessun codice lo confronta).
- Le letture (`agent/profile`, `templates`, `kb`, `automations`, `lab`) restano aperte ai member: scelta mia, da confermare.

## Decisioni per l'owner

1. **Tappe del pipeline** (`pipeline/stages` POST/PATCH/DELETE): lasciate ai member perché il mandato dice che lavorano sul pipeline. Sono però configurazione della struttura: passarle a admin?
2. **`GET /api/settings/team`**: nome, email e ruolo dei membri visibili a ogni membro (eccezione documentata). Restringerla?
3. **Letture aperte** (profilo agente, base di conoscenza, regole di automazione, corse del Laboratorio): restano ai member. Restringere anche quelle?
4. **Etichette** (`tags` POST/DELETE): aperte ai member; cancellare un'etichetta usata da una regola di automazione la rende inutilizzabile.
5. **Segreto del webhook per organizzazione** (già segnalato): `META_WEBHOOK_VERIFY_TOKEN` è unico per istanza; richiede una decisione di architettura prima del multi-cliente.
6. **Revisione indipendente prima del merge**: la modifica è security-critical.

## Controllo rapido §6

1. **Zero:** nessun dato reale, segreto, produzione, deploy o chiamata a servizi esterni; nessun segreto nell'output (i test verificano anche che il 403 non contenga token o segreti); l'isolamento tra organizzazioni non è toccato (nessuna query nuova, niente schema, niente migrazioni). Falle viste fuori perimetro: solo quelle in «Decisioni per l'owner».
2. **Prima:** typecheck, lint, test e build verdi; test negativi per ogni regola di permesso toccata e sabotaggio per ogni guardia nuova o toccata (tabelle sopra); «Non verificato» scritto. Unico test esistente modificato: `settings-nav.test.ts`, come richiesto dal mandato (il member non vede più WhatsApp), più l'aggiunta di `withOwnerAuth` al riconoscimento del vecchio guardrail, poi sostituito.
3. **Seconda:** istruzioni del mandato dell'owner/orchestratore; nessuna istruzione trovata in un contenuto; perimetro rispettato (solo il worktree indicato).
4. **Terza:** commit nuovi sul branch dedicato `notte/ruoli-whatsapp`, nessun commit precedente riscritto, registro aggiornato; non pushato (vietato dal mandato) e quindi ancora solo locale. Moduli riutilizzabili senza nomi di clienti.
5. **Semplicità:** il refactor del commit 1 elimina le copie (403 e solo-owner) a comportamento identico; `adminOnly` è l'unica fonte per le 4 pagine di configurazione; nessun codice morto lasciato (`forbidden()` di `api-keys-admin` e `apiKeyCollectionHandlers`/`apiKeyRevokeHandler` rimossi, `handlersSinControl` sostituito).
6. **Dubbio:** le scelte di perimetro non coperte dal mandato (tappe del pipeline, etichette, letture) sono rimaste aperte e sono elencate sopra.
