# Registrazione & Inviti — analisi e progetto (modello ibrido)

> Mandato: `PROMPT-NOTTE-ANALISI-2026-08-21.txt` (branch `notte-2026-08-21`).
> Solo progettazione: nessuna riga di codice implementata. Ogni affermazione
> ha `file:riga`. Decisione dell'owner 2026-08-21: **modello ibrido a tre
> porte** — (1) self-signup pubblico, (2) invito dal super-admin, (3) invito
> fra utenti della stessa organizzazione. Non si riapre.
>
> Vincoli di costituzione rispettati (`.specify/memory/constitution.md`):
> art. II — **vietati servizi di email in v1** (`:90`); vietati servizi
> Google e dipendenze esterne non in lista chiusa (`:80-91`). Quindi
> l'invito NON può partire via email dal sistema: si progetta il
> **link d'invito copiabile** (l'umano lo consegna come vuole).

---

## 1. Cosa copre GIÀ Better Auth (e il repo) — e cosa manca davvero

Better Auth **1.6.23** con plugin `organization` (`src/lib/auth/index.ts:65`,
`creatorRole: "owner"`). Le tabelle `organization`, `member`, `invitation`
sono già nello schema e nell'adapter (`src/lib/auth/index.ts:55-57`;
`src/lib/db/schema.ts:69-102`).

### 1.1 Infrastruttura inviti: ESISTE

Verificato nel codice del plugin (`node_modules/better-auth/dist/plugins/
organization/`):

| Capacità | Dove | Dettaglio |
|---|---|---|
| `createInvitation` | `routes/crud-invites.mjs:37` | Crea l'invito e **restituisce l'oggetto con `id`** (`return ctx.json(invitation)`, ~`:238`). |
| Email NON obbligatoria | `crud-invites.mjs:150,226` | `sendInvitationEmail` è **opzionale**: se non configurato, non parte nulla e l'invito si crea lo stesso. Oggi NON è configurato (`src/lib/auth/index.ts:65` passa solo `creatorRole`). |
| Token del link | `adapter.mjs` (`createInvitation`) | L'`id` lo genera `context.generateId({ model: "invitation" })` — id aleatorio ad alta entropia di Better Auth. **L'id È il token del link.** |
| Scadenza | `crud-invites.mjs:137` | `invitationExpiresIn || 3600*48` → **default 48h**, configurabile via opzione plugin. |
| Uso singolo | `crud-invites.mjs:268` | `acceptInvitation` rifiuta se `status !== "pending"` o scaduto. Lo status vive in `invitation.status` (`schema.ts:97`, default `"pending"`). |
| Revoca | `organization.d.mts:6` | `cancelInvitation` (status → `"canceled"`, `crud-invites.mjs:165`), `rejectInvitation`, `listInvitations`, `getInvitation` (per la pagina di accettazione). |
| Email match all'accettazione | `crud-invites.mjs:269` | `invitation.email !== session.user.email` → 403. **L'invito è legato all'email**: l'invitato deve avere (o creare) un account con QUELLA email. |
| Già membro | `crud-invites.mjs:124-129` | Se l'email è già membro dell'org → errore (niente inviti doppi). |
| Permessi default | `access/statement.mjs` | `owner` e `admin`: `invitation: ["create","cancel"]`; `member`: nessun diritto inviti. |
| Client | `src/lib/auth/client.ts:6-8` | `organizationClient()` già registrato → `authClient.organization.*` disponibile in UI. |

### 1.2 Cosa manca davvero (gap preciso)

1. **Nessuna rotta/UI per inviti**: cercate cartelle `invit*`/`member*` sotto
   `src/app` — **non trovate**. Mancano: creazione link (super-admin e owner),
   pagina di accettazione, lista/revoca inviti pendenti.
2. **Il provisioning del signup è "solo il primo"**: `onUserCreated` crea
   l'organizzazione SOLO se non ne esiste nessuna (`src/server/auth/
   on-signup.ts:55-58`). Con la porta 1 (self-signup pubblico) **ogni** nuovo
   utente resterebbe senza org → la funzione va generalizzata: ogni signup
   pubblico crea la propria org (oggi: solo il primo).
3. **Il gate pubblico è l'opposto della porta 1**: `isPublicSignupAllowed`
   chiude il registro dopo la prima org salvo `ALLOW_SIGNUP=true`
   (`src/server/auth/registration.ts:9-14`; hook in `src/lib/auth/index.ts:82-89`;
   pagina `src/app/(auth)/register/page.tsx` già gestisce 403/429, `:29-33`).
   La costituzione impone "registro chiuso dopo la prima organizzazione"
   per l'istanza generica (`.specify/memory/constitution.md:268-271`) → la
   porta 1 va progettata come **modalità configurabile** (default invariato
   per Vocero OSS; l'istanza Heili la apre), non come rimozione del gate.
4. **Anti-abuso**: oggi solo rate limit 10 tentativi/10 min per IP su
   sign-in/sign-up (`src/lib/auth/index.ts:41,68-80`;
   `src/lib/rate-limit.ts:45-46`, in-process senza Redis — costituzione II).
   Niente quota org, niente approvazione.
5. **Super-admin**: esiste come capability da env `SUPERADMIN_EMAILS`
   (`src/server/auth/superadmin.ts:12-19`), NON come ruolo DB. Oggi può
   creare org + account con password (`src/app/api/admin/orgs/route.ts:73-138`)
   e utenti dentro un'org (`src/app/api/admin/orgs/[orgId]/users/route.ts:69-112`)
   — sempre con **password scelta dall'admin** e consegnata a mano. L'invito
   con link elimina proprio questo passaggio di password.

---

## 2. Il nodo email: flusso "link d'invito copiabile"

Senza servizio di posta (costituzione II), la consegna è **umana**: il sistema
genera il link, l'admin lo copia e lo manda dove vuole (WhatsApp, chat, di
persona). Better Auth copre già tutto il ciclo di vita dell'invito; manca solo
la superficie (rotte + UI minime).

### 2.1 Definizione

- **Token**: l'`id` dell'invito (`generateId` di Better Auth, vedi 1.1). Il
  link è `{APP_BASE_URL}/invitacion/{id}`. Niente token custom, niente tabelle
  nuove: la tabella `invitation` (`schema.ts:90-102`) basta.
- **Scadenza**: default plugin 48h. Per link consegnati a mano 48h possono
  essere poche → proposta: `invitationExpiresIn` a **7 giorni** (opzione
  plugin, `crud-invites.mjs:137`). Decidere (domanda 4 in §6).
- **Uso singolo**: garantito dal plugin (`status !== "pending"` → rifiuto,
  `crud-invites.mjs:268`). Dopo l'accettazione lo status è `"accepted"`.
- **Revoca**: `cancelInvitation` (owner/admin dell'org; super-admin tramite la
  stessa API se è membro-owner dell'org — vedi §3). Lista dei pendenti:
  `listInvitations`.
- **Invitato già registrato**: fa login e accetta (email match obbligatorio,
  `crud-invites.mjs:269`). **Non registrato**: il link porta a una pagina che
  mostra l'invito (`getInvitation`) e offre "crea account" — con l'email
  **precompilata e vincolata** a quella dell'invito — poi accetta. Il
  registrazione-pubblico chiuso NON blocca questo passo: il bypass interno
  esiste già (`runInternalSignup`, `src/lib/auth/index.ts:33-39`).
- **Già membro dell'org**: il plugin rifiuta in creazione
  (`crud-invites.mjs:124-129`) → l'UI mostra "è già dentro".

### 2.2 Superficie da costruire (progetto, NON implementata)

| Pezzo | Chi | Note |
|---|---|---|
| `POST /api/admin/orgs/[id]/invitations` | super-admin | Crea invito (ruolo owner/member) e restituisce il link copiabile. |
| `POST /api/invitations` (o via `authClient.organization.inviteMember`) | owner/admin dell'org | Porta 3. Permessi già corretti nel plugin. |
| `GET /invitacion/[id]` (pagina) | pubblico | Mostra org/ruolo/scadenza (`getInvitation`); bottoni "Accedi" / "Crea account". |
| `POST accept` | invitato loggato | `authClient.organization.acceptInvitation({ invitationId })`. |
| Lista + revoca in `/admin` e in impostazioni team | super-admin / owner | `listInvitations` + `cancelInvitation`. |

---

## 3. Ruoli: SUPER-ADMIN di piattaforma vs OWNER vs MEMBRO

- **Membro / Owner di organizzazione**: coperti dal plugin
  (`creatorRole: "owner"`, `src/lib/auth/index.ts:65`; ruoli default
  owner/admin/member, `access/statement.mjs`). L'owner oggi crea account team
  con password temporanea (`src/app/api/settings/team/route.ts:42-83`,
  FR-061): la porta 3 aggiunge l'alternativa "invita con link" senza password.
- **Super-admin di piattaforma**: NON è un ruolo d'org; oggi è
  `SUPERADMIN_EMAILS` in env (`superadmin.ts:12-19`) e basta per tutto ciò che
  serve: `withSuperadmin` protegge `/api/admin/*` (`superadmin.ts:47-69`), la
  Fase 1 ci ha già costruito sopra il panel multi-org.
  **Basta o va esteso?** Basta, con UNA precisazione: il plugin inviti
  richiede che chi crea l'invito sia **membro con permesso** nell'org
  (`orgSessionMiddleware` + controllo permessi in `crud-invites.mjs`). Il
  super-admin è già fatto `owner` di ogni org che crea dal panel
  (`src/app/api/admin/orgs/route.ts:117-122`), ma NON delle org nate da
  self-signup. Progetto: la rotta admin d'invito **garantisce prima la
  membresía owner** del super-admin nell'org (stesso gesto della Fase 1,
  idempotente) e poi crea l'invito via API del plugin. Nessun ruolo DB nuovo.
  (Alternativa — inserimento diretto nella tabella `invitation` saltando i
  controlli del plugin: scartata, perde scadenza/permessi gestiti.)

---

## 4. Anti-abuso del signup pubblico (senza email di verifica)

Cosa resta di sovrano, in difesa a strati:

1. **Rate limit per IP** (esiste): 10/10 min su sign-up
   (`src/lib/auth/index.ts:68-80`). Proposta: bucket dedicato più stretto per
   il sign-up (es. 3/ora per IP) — stessa libreria in-process
   (`src/lib/rate-limit.ts`), nessuna dipendenza.
2. **Quota organizzazioni**: `MAX_ORGANIZATIONS` (env, opzionale) controllata
   dentro il gate (`registration.ts`) — il conteggio è una query che già
   esiste (`registration.ts:12-13`).
3. **Approvazione manuale** (opzionale, SPEZZONE con migrazione): flag
   `disabled` sull'org self-iscritta finché il super-admin non approva dal
   panel. **Tocca il modello dati → se si sceglie, la feature subisce
   subida de carril** (costituzione VI: ciclo completo, `.specify/memory/
   constitution.md:153-157`). Proposta: NON in v1 del flusso inviti.
4. **Osservabilità sovrana**: log degli signup (già in console del monolito);
   il super-admin vede le org nuove dal panel esistente (`/admin`, Fase 1).
5. **Il signup pubblico resta spento di default** per l'istanza OSS
   (costituzione `:268-271`): la modalità aperta è opt-in via env
   (proposta: `SIGNUP_MODE=open`, default comportamento attuale).

---

## 5. I tre flussi (diagrammi testuali)

### Porta 1 — Self-signup pubblico (modalità `open`)
```
visitatore → /register → signUp.email → hook gate (registration.ts: SIGNUP_MODE=open? rate limit IP)
  → onUserCreated GENERALIZZATO: crea SEMPRE la propria org ("Negocio de X")
    + pipeline seminato + perfil agente (provisionOrganization, on-signup.ts:25-39)
  → sessione con activeOrganizationId (hook sessione, auth/index.ts:100-110)
  → /inbox: utente dentro, owner della SUA org
```

### Porta 2 — Invito dal super-admin
```
super-admin → /admin → org (esistente o creata al momento)
  → POST /api/admin/orgs/[id]/invitations {email, role}
    → garantisce membership owner del super-admin (idempotente)
    → auth.api.createInvitation → invitation {id}
  → UI mostra il link {APP_BASE_URL}/invitacion/{id} + bottone "copia"
  → super-admin consegna il link (WhatsApp/chat/di persona)
  → [invitato] vedi "Accettazione" sotto
```

### Porta 3 — Invito fra utenti (owner/admin → propria org)
```
owner/admin → Impostazioni → Team → "Invita" {email, role}
  → createInvitation (permessi plugin: owner/admin sì, member no)
  → link copiabile mostrato in UI → consegnato a mano
  → [invitato] vedi "Accettazione" sotto
```

### Accettazione (comune a porte 2 e 3)
```
link → GET /invitacion/{id} → getInvitation: org, ruolo, scadenza
  ├─ ha già account (stessa email) → login → acceptInvitation → member creato
  │    → status accepted → entra nell'org (switcher org se >1, Fase 1)
  ├─ non ha account → "Crea account" (email precompilata=vincolata)
  │    → signUp via runInternalSignup (bypass gate chiuso, auth/index.ts:33-39)
  │    → acceptInvitation (email match, crud-invites.mjs:269) → dentro
  └─ link scaduto/revocato → pagina "invito non valido" (status/expiresAt)
```

---

## 6. Domande BLOCCANTI per l'owner (max 5)

1. **Super-admin: resta solo `SUPERADMIN_EMAILS` in env** (proposta: sì,
   basta — vedi §3) o vuoi un ruolo persistito in DB?
2. **Il self-signup pubblico crea sempre una nuova organizzazione?**
   (proposta: sì, generalizzando `onUserCreated`) — e confermi che la
   modalità aperta è solo per l'istanza Heili via env, lasciando Vocero OSS
   col registro chiuso di default?
3. **Un utente può stare in più organizzazioni?** Il modello già lo consente
   (`member` N:1, switcher Fase 1) — confermi che è il comportamento voluto
   anche per gli invitati?
4. **Scadenza link d'invito**: default 48h del plugin o 7 giorni per i link
   consegnati a mano? (proposta: 7 giorni)
5. **Approvazione manuale delle org self-iscritte**: la vuoi in v1 (richiede
   migrazione → ciclo SDD completo) o basta rate limit + quota org?
