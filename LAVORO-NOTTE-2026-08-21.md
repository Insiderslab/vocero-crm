# LAVORO NOTTE 2026-08-21 — Fase 4 pronta e sicura da deployare

Branch: `notte-2026-08-21` (mai su main). Nessun deploy, nessun segreto toccato,
nessuna migrazione, nessun dev server contro DB reale.
Mandato: `PROMPT-NOTTE-2026-08-21.txt`.

## Stato di partenza (regola 9) — verificato PRIMA di toccare

- `git status --short`: solo untracked `PROMPT-DEPLOY-FASE4.txt`,
  `PROMPT-NOTTE-2026-08-21.txt`, `memory/` (non toccati per mandato).
- `corepack pnpm typecheck` → EXIT=0
- `corepack pnpm lint` → EXIT=0
- `corepack pnpm test` → 36 file, **259/259 passed**, EXIT=0

## Task 1 — Patch docker-compose.yml (pass-through WAPI_*)

- Aggiunte 3 righe in `docker-compose.yml` (sezione `environment` del servizio
  `app`, dopo `META_GRAPH_API_VERSION`):
  `WAPI_BASE_URL: ${WAPI_BASE_URL:-}`, `WAPI_API_KEY: ${WAPI_API_KEY:-}`,
  `WAPI_ORG_IDS: ${WAPI_ORG_IDS:-}` — stessa forma delle altre opzionali;
  default vuoto = `stripEmpty` (`src/lib/env.ts:89-95`) le tratta come assenti
  → comportamento invariato se non impostate.
- `.env.example`: le tre variabili **c'erano già** (righe 46-55, commentate,
  con guida inline) → nessuna modifica necessaria.
- Verifica post-modifica: lint EXIT=0, typecheck EXIT=0.
- Commit: `c7fa11e`.

## Task 2 — Test vitest adattatore Fase 4

File: `tests/unit/meta-client.test.ts` (esteso, stesso stile dei test
esistenti). 9 test nuovi (18 totali nel file, 259→268 nella suite):

- senza `WAPI_BASE_URL` → Meta diretto (`META_GRAPH_BASE_URL` default
  `https://graph.facebook.com`, `env.ts:24`).
- stringa vuota = assente (i compose iniettano `VAR=""`, `env.ts:89-95`).
- con `WAPI_BASE_URL`+`WAPI_API_KEY`+org → baseUrl Wapi, bearer = API key.
- senza `organizationId` (caso wizard `connect.ts`) → Meta diretto sempre.
- `WAPI_ORG_IDS="org_1, org_2"`: org_1/org_2 → Wapi; org_3 → Meta.
- `WAPI_BASE_URL` senza `WAPI_API_KEY` → Meta diretto (niente desvío a metà).
- `graphRequest` modo Wapi: URL `{WAPI_BASE_URL}/v25.0/{path}` +
  `Authorization: Bearer hlp_live_...` (fetch mockeato, zero rete reale).
- `graphRequest` modo diretto: URL `graph.facebook.com` + bearer token org.
- `testConnection` di `connect.ts` con Wapi configurato → chiama comunque
  `graph.facebook.com` (il wizard va sempre a Meta).
- Nota tecnica: `getEnv()` è memoizzato per modulo (`env.ts:65-87`) → ogni
  test fa `vi.resetModules()` + import dinamico con env stubbed.
- Gate completo dopo la modifica: lint EXIT=0, typecheck EXIT=0,
  `pnpm test` 268/268 EXIT=0.
- Commit: `56e7108`.

## Task 3 — Revisione indipendente (sola lettura) del percorso Fase 4

### 3.1 Tutte le chiamate Graph passano dal transport? — **CONFERMATO**

Call-site di `graphRequest` (tutti passano per `resolveGraphTransport`,
`src/lib/meta/client.ts:81`):

| Call-site | organizationId passato? |
|---|---|
| `src/server/inbox/send.ts:378` (invio messaggi) | sì (`:384`, `credentials.organizationId`) |
| `src/server/whatsapp/templates.ts:97` (crea template) | sì (`:102`) |
| `src/server/whatsapp/templates.ts:193` (sync template) | sì (`:195`) |
| `src/server/whatsapp/templates.ts:382` (invio template) | sì (`input.organizationId`) |
| `src/server/whatsapp/media.ts:149` (meta del media) | sì (`:151`, `opts.organizationId`) |
| `src/app/api/bot/typing/route.ts:77` (read/typing) | sì (`:80`) |
| `src/server/whatsapp/connect.ts:20,73` (wizard) | **no, di proposito** → Meta diretto |

`resolveGraphTransport` usato direttamente (upload/download media):
`media.ts:164` (bearer del download, org da `opts`) e `media.ts:257-260`
(upload multipart, `credentials.organizationId`).

Grep `graph.facebook.com` in `src/`: solo il default in `env.ts:24`. Nessun
fetch server-side verso Meta fuori da `client.ts`/`media.ts` (gli altri
`fetch(` sono componenti client verso `/api/*` interne o `lib/ai` verso
OpenRouter). Il wa-mock inbound (`server/dev/wa-mock-inbound.ts:26`) è dietro
dev-guard.

### 3.2 Webhook in entrata: firma verificata? fail-closed? — **DUBBIO (rilievo)**

- La firma È verificata: `src/app/api/webhooks/wa/[webhookToken]/route.ts:46-50`
  chiama `isValidSignature(rawBody, header, env.META_APP_SECRET)`
  (`src/server/inbox/webhook.ts:27-38`, HMAC-SHA256 sul body crudo,
  confronto timing-safe via `safeEqual` `:9-13`).
- Segreto: `META_APP_SECRET` (opzionale, `env.ts:22`).
- **NON è fail-closed**: `webhook.ts:32` — `if (!appSecret) return true;`.
  Se `META_APP_SECRET` manca, la capa 2 è disattivata e resta solo la capa 1
  (segmento segreto nell'URL, `route.ts:42-44`, min 8 char `env.ts:21`).
  È **lo stesso pattern della falla P0-2 di Wapi** (`wapi/app/api/webhook/
  route.ts:36-37`: `if (!secret) return true`). Qui è documentato come scelta
  (`.env.example:37-41`), ma col deploy Fase 4 il webhook del CRM riceve solo
  reenvíi di Wapi: **raccomando di impostare `META_APP_SECRET` nel CRM e lo
  stesso valore come `secret` dell'endpoint in Wapi**, altrimenti chiunque
  scopra l'URL segreta può iniettare payload.
- Rilievo collegato (lato Wapi, da codice letto ieri): il reenvío di Wapi usa
  `Promise.allSettled` e **non controlla lo status della risposta del CRM**
  (`wapi/app/api/webhook/route.ts:52-66`): se il CRM risponde 401 (secret
  endpoint ≠ `META_APP_SECRET` del CRM) l'inbound si ferma **in silenzio**.
  Da verificare in deploy con un messaggio reale (checklist spec 003, passo 5).

### 3.3 Un'org può usare le credenziali di un'altra? — **CONFERMATO (no)**

- Outbound: l'org viene dalla sessione; `send.ts:70` rifiuta se la
  conversazione non è dell'org; le credenziali sono `getCredentialsByOrg`
  con `scoped()` (`credentials.ts:63-70`). `WAPI_ORG_IDS` seleziona solo
  URL/bearer-del-gateway (`client.ts:29-34`): il token passato a Wapi è la
  API key dell'istanza, e lato Wapi il proxy risolve le credenziali Meta
  **della org della key** (`wapi/app/api/v1/graph/[...path]/route.ts:94-97,
  122-124`) — il CRM non può indicare un numero di un'altra org.
- Inbound: routing per `phone_number_id` del payload
  (`ingest.ts:199,249` → `getCredentialsByPhoneNumberId`) — identico al modo
  Meta diretto.
- Media: `ensureAssetAvailable` verifica `asset.organizationId !==
  organizationId → null` (`media.ts:207`).
- Bot API: org da `resolveInstanceOrg()` (server-side, non dal client).
- Export API (`?org=`): cross-org **di proposito**, gated da `EXPORT_API_KEY`
  di istanza (Fase 2) — fuori perimetro Fase 4.

## Task 4 — Spec 003

Nessun passo della checklist **palesemente sbagliato rispetto al codice**:
- webhook path `/api/webhook` ✔️ (`wapi/app/api/webhook/route.ts`)
- verify token = `WEBHOOK_VERIFY_TOKEN` di Wapi ✔️ (`route.ts:27`)
- endpoint secret = `META_APP_SECRET` del CRM ✔️ (`route.ts:54-56`)
- `WAPI_BASE_URL=https://wapi.heili.cloud/api/v1/graph` ✔️ forma
  (`client.ts:82` aggiunge `/{version}/{path}`; il proxy esige il segmento
  versione, `wapi route.ts:88-92`)
→ **nessuna riga modificata**. Unica riserva NON da codice: dominio
`wapi.heili.cloud` (spec) vs `whapi.heili.cloud` (contesto VPS) — è DNS, non
verificabile dal codice: annotato in §D, spec lasciata com'è.

---

## §A — cosa ho fatto (commit hash e file)

| Commit | File | Cosa |
|---|---|---|
| `c7fa11e` | `docker-compose.yml` | pass-through `WAPI_*` (3 righe, default vuoto) |
| `56e7108` | `tests/unit/meta-client.test.ts` | +9 test adattatore Fase 4 (259→268) |
| (questo) | `LAVORO-NOTTE-2026-08-21.md` | work-log + revisione Task 3 |

Non toccati: `main`, `memory/`, `.env`, `specs/` (Task 4: nessuna correzione
necessaria), nessun deploy, nessuna migrazione.

## §B — comandi reali e loro output

```
PS> git checkout -b notte-2026-08-21
Switched to a new branch 'notte-2026-08-21'

PS> cmd /c "corepack pnpm typecheck 2>&1"   [baseline]
$ tsc --noEmit
EXIT=0
PS> cmd /c "corepack pnpm lint 2>&1"        [baseline]
$ eslint .
EXIT=0
PS> cmd /c "corepack pnpm test 2>&1"        [baseline]
 Test Files  36 passed (36)
      Tests  259 passed (259)
EXIT=0

PS> git diff docker-compose.yml             [Task 1]
+      WAPI_BASE_URL: ${WAPI_BASE_URL:-}
+      WAPI_API_KEY: ${WAPI_API_KEY:-}
+      WAPI_ORG_IDS: ${WAPI_ORG_IDS:-}
PS> lint → EXIT=0 ; typecheck → EXIT=0
PS> git commit → [notte-2026-08-21 c7fa11e] fix(deploy): pass-through WAPI_* ...

PS> corepack pnpm vitest run tests/unit/meta-client.test.ts   [Task 2]
 ✓ tests/unit/meta-client.test.ts (18 tests) 69ms
 Test Files  1 passed (1) · Tests 18 passed (18)
PS> lint → EXIT=0 ; typecheck → EXIT=0
PS> corepack pnpm test
 Test Files  36 passed (36)
      Tests  268 passed (268)
TEST_EXIT=0
PS> git commit → [notte-2026-08-21 56e7108] test(fase-4): cobertura del adaptador...
```

## §C — COSA NON HO VERIFICATO

1. **Non ho eseguito il self-test E2E** (`e2e-selftest.mjs` / `e2e-custom-heili.mjs`):
  richiedono dev server + DB (mandato: niente dev server contro DB reale).
  La copertura del trasporto è solo unit (fetch mockeato).
2. **Non ho validato lo YAML del compose con `docker compose config`**
  (docker CLI non disponibile su questa macchina, memory progetto). La patch
  è 3 righe omogenee alle adiacenti, ma la validazione formale va fatta sul VPS.
3. **Non ho testato il path multipart upload/download media contro un Wapi
  reale** (né il caso `_media/{phnId}/{mediaId}?u=...`): coperto solo dal
  disegno e dai test E2E di ieri (fatti dall'owner session, non rieseguiti).
4. **Non ho verificato il DNS** `wapi.heili.cloud` vs `whapi.heili.cloud`.
5. **Non ho verificato lo stato del DB Wapi in produzione** (tabelle
  `api_keys`/`webhook_endpoints` mancanti? — schema.sql è nuovo in `78276b8`).
6. Non ho letto `.env`/`.env.local` né `CREDENCIALES-*` (regola 2): la presenza
  reale delle variabili in prod è da verificare sul VPS.
7. La revisione cross-org (3.3) è statica: nessun test di penetration eseguito.

## §D — COSA DEVE CONTROLLARE IL REVISORE domattina

1. **Validare il compose sul VPS**: `docker compose config` dopo il merge —
  conferma che le 3 righe WAPI_* non rompono lo YAML e arrivano al container.
2. **Decidere `META_APP_SECRET` prima del deploy** (rilievo 3.2): senza di esso
  il webhook CRM è fail-open (solo URL segreta). Raccomandazione: stesso valore
  come `META_APP_SECRET` del CRM, `secret` dell'endpoint in Wapi e
  `META_APP_SECRET` di Wapi (verifica firma Meta entrante).
3. **Test inbound obbligatorio in deploy** (spec 003 passo 5): il reenvío di
  Wapi ignora lo status della risposta del CRM (`wapi/app/api/webhook/
  route.ts:52-66`) — un secret errato ferma l'inbox **in silenzio**. Mandare
  un messaggio reale e confermare che appare nel CRM.
4. **Dominio Wapi**: confermare se è `wapi.heili.cloud` (spec/env.example) o
  `whapi.heili.cloud` (contesto VPS 2026-08-20) prima di impostare
  `WAPI_BASE_URL` e la Callback URL in Meta.
5. **DB Wapi in prod**: applicare `schema.sql` (idempotente) prima del deploy
  di `wapi-app`, altrimenti il panel admin/proxy falliscono.
6. Rieseguire `pnpm test` dopo il merge del branch (atteso 268/268).
7. Se si vuole chiudere il rilievo 3.2 in radice: valutare (in altra sessione,
  con l'owner sveglio) di rendere la capa 2 fail-closed quando il forward Wapi
  è attivo — è una decisione di prodotto, non l'ho presa di notte.

---
---

# MANDATO 2 — REGISTRAZIONE & INVITI (PROMPT-NOTTE-ANALISI-2026-08-21.txt)

Progettazione del sistema di accesso ibrido (3 porte). **Solo documenti**:
nessuna rotta, migrazione o UI. Letti prima `CLAUDE.md` e
`.specify/memory/constitution.md` (vincoli applicati: art. II — niente email;
niente servizi Google; lista dipendenze chiusa).

## Cosa ho prodotto

1. `docs/analisi/REGISTRAZIONE-E-INVITI.md` — analisi completa:
   - Cosa copre GIÀ Better Auth 1.6.23 (plugin organization): inviti senza
     email (`sendInvitationEmail` opzionale, `crud-invites.mjs:150,226`), il
     token è l'`id` del invito (`adapter.mjs`, `generateId`), scadenza default
     48h (`crud-invites.mjs:137`), uso singolo (`:268`), revoca
     (`cancelInvitation`), email match all'accettazione (`:269`), permessi
     owner/admin (`access/statement.mjs`). Tabelle già in schema
     (`src/lib/db/schema.ts:90-102`) e adapter (`src/lib/auth/index.ts:55-57`).
   - Gap precisi: nessuna rotta/UI inviti (cartelle `invit*`/`member*` non
     trovate); `onUserCreated` crea org solo al primo utente
     (`src/server/auth/on-signup.ts:55-58`); gate registro opposto alla porta 1
     (`src/server/auth/registration.ts:9-14`); anti-abuso solo rate limit
     (`src/lib/rate-limit.ts:45-46`); super-admin env-only
     (`src/server/auth/superadmin.ts:12-19`).
   - Flusso link copiabile definito (token, scadenza, uso singolo, revoca,
     invitato già registrato / non registrato / già membro).
   - Ruoli: super-admin env BASTA (con precisazione membership prima
     dell'invito in org non proprie).
   - Anti-abuso sovrano: rate limit più stretto, quota `MAX_ORGANIZATIONS`,
     approvazione manuale dichiarata fuori v1 (richiede migrazione → subida
     de carril), signup aperto solo opt-in (`SIGNUP_MODE=open`).
   - 3 diagrammi testuali + flusso di accettazione comune.
   - 5 domande bloccanti per l'owner.
2. `specs/custom-heili/004-registro-e-invitaciones.md` — spec SDD nel formato
   del progetto (template `.specify/templates/spec-template.md`): User
   Scenarios (P1 invito fra utenti, P2 invito super-admin, P3 self-signup),
   Requirements FR-101..109 con NEEDS CLARIFICATION marcati (costituzione
   VII), Success Criteria, carril ligero dichiarato + Constitution Check
   nel corpo (regola del carril ligero, costituzione VI).

## §A — cosa ho fatto (commit hash e file) — MANDATO 2

| Commit | File | Cosa |
|---|---|---|
| `1ad9675` | `docs/analisi/REGISTRAZIONE-E-INVITI.md` | analisi + progetto (nuovo) |
| `e2ca126` | `specs/custom-heili/004-registro-e-invitaciones.md` | spec SDD (nuova) |
| (questo) | `LAVORO-NOTTE-2026-08-21.md` | aggiunta sezione Mandato 2 |

Nessun codice toccato. `memory/` non toccata. Branch `notte-2026-08-21`.

## §B — comandi reali e loro output — MANDATO 2

```
PS> git branch --show-current
notte-2026-08-21
PS> node -e "console.log(require('.../better-auth/package.json').version)"
1.6.23
PS> Select-String crud-invites.mjs -Pattern "..."   [estratti chiave]
  137: invitationExpiresIn || 3600*48        (scadenza default 48h)
  150/226: if (...sendInvitationEmail) ...   (email OPZIONALE)
  238~: return ctx.json(invitation)          (id nel response → link)
  268: rifiuto se status !== pending o scaduto
  269: email mismatch → FORBIDDEN
PS> Select-String access/statement.mjs → owner/admin: invitation[create,cancel]; member: []
PS> cmd /c "corepack pnpm lint 2>&1" → LINT_EXIT=0
PS> cmd /c "corepack pnpm typecheck 2>&1" → TSC_EXIT=0
PS> git commit → 1ad9675 (analisi), e2ca126 (spec)
```

## §C — COSA NON HO VERIFICATO — MANDATO 2

1. **Non ho eseguito Better Auth**: i comportamenti del plugin (48h, email
   match, resend) derivano dalla LETTURA di `node_modules/better-auth/dist/
   plugins/organization/` — non da una chiamata reale. Da confermare con un
   test quando si implementerà.
2. **Entropia di `generateId`**: ho verificato che l'id lo genera
   `context.generateId({model:"invitation"})` (`adapter.mjs`), NON l'algoritmo
   esatto né la lunghezza del token. Se il revisore vuole un link più lungo/
   opaco, valutare in implementazione.
3. **`getInvitation` pubblico**: non ho verificato se l'endpoint richiede
   sessione o è anonimo (serve anonimo per la pagina del link) — da verificare
   in fase di piano; se richiede sessione, la pagina userà una rotta nostra.
4. **Compatibilità del flusso "registra poi accetta"** col gate chiuso: il
   bypass `runInternalSignup` esiste (`src/lib/auth/index.ts:33-39`) ma non ho
   verificato in esecuzione che la sequenza register→accept non lasci stati
   intermedi (utente creato, invito non accettato).
5. Non ho verificato l'i18n: le nuove pagine (`/invitacion/[id]`, UI inviti)
   richiederanno chiavi di traduzione (`useT`, visto in
   `src/app/(auth)/register/page.tsx:7`) — impatto non analizzato.
6. Non ho aperto PR né toccato main; nessun test E2E eseguito (fuori
   perimetro: progettazione).

## §D — COSA DEVE CONTROLLARE IL REVISORE domattina — MANDATO 2

1. **Rispondere alle 5 domande bloccanti** in coda a
   `docs/analisi/REGISTRAZIONE-E-INVITI.md` §6 (super-admin env vs DB; signup
   sempre-nuova-org + modalità solo Heili; multi-org per utente; scadenza
   48h vs 7gg; approvazione manuale sì/no). Le risposte cambiano la spec 004.
2. **Validare il punto §C-3**: se `getInvitation` richiede sessione, il
   disegno della pagina pubblica del link va adattato (rotta nostra di sola
   lettura dell'invito: org, ruolo, scadenza — mai dati sensibili).
3. **Confermare il carril ligero**: la spec 004 dichiara nessuna migrazione;
   se l'owner vuole l'approvazione manuale (domanda 5), la feature subisce
   subida de carril e serve il piano completo prima del codice.
4. **Confermare che la porta 1 non rompe la promessa OSS**: la costituzione
   (`:268-271`) impone registro chiuso dopo la prima org; il disegno lo
   preserva come default e apre solo con `SIGNUP_MODE=open`. Se il revisore
   preferisce un nome diverso di env, si cambia in implementazione.
5. Rileggere la tabella "gap precisi" (§1.2 dell'analisi) contro il codice:
   ogni riga ha `file:riga` — se una non torna, la spec va corretta prima di
   implementare.
