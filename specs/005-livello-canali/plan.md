# Piano di implementazione: Livello canali comune (005-livello-canali)

**Branch del pacchetto**: `notte/adr-canali` (M1.1, solo documenti) | **Data**: 2026-10-10 | **Spec**: [spec.md](spec.md) | **Decisioni**: [ADR 0001](../../docs/adr/0001-livello-canali.md)

**Input**: specifica `specs/005-livello-canali/spec.md`; codice letto su `origin/claude/keen-ptolemy-l0kv8g` @ `810272a`; C3 letto su `notte/c3-wapi` @ `6146791` (non integrato); `heili-dm` @ `7ce1633`.

**Nota sui numeri di riga:** sono esatti su `810272a` (o su `6146791` dove indicato). Cambiano a ogni commit. Chi esegue M1.2 o M1.3 rigenera l'inventario con i comandi di §5.12 e annota le differenze nel suo registro. **Non si correggono a mano.**

## 1. Sommario

Il CRM oggi è legato a WhatsApp nel modello dati (`contact.wa_identity`, `message.wa_message_id`, `meta_credentials`), nel webhook (`/api/webhooks/wa`) e nella costante della finestra di 24 ore. Il piano:
- introduce un contratto `ChannelAdapter` e un nucleo che non conosce il canale (ADR §3.1);
- aggiunge un modello dati comune: `channel_account`, `contact_identity`, `conversation.channel_account_id`, `message.channel` e `message.external_message_id` (ADR §3.2);
- migra in tre rilasci (R1 espandi, R2 migra le letture, R3 contrai), ognuno con il suo rollback (ADR §3.3);
- porta WhatsApp dietro il contratto con comportamento **identico**, provato da golden registrati prima di cambiare il codice (ADR §3.7);
- valida l'astrazione con un secondo canale reale, Instagram in modalità sviluppo, nella stessa fase M1 (ADR §3.9).

## 2. Contesto tecnico

**Linguaggio/versione**: TypeScript strict (`noUncheckedIndexedAccess`), Node 22.

**Dipendenze principali**: Next.js 15 (App Router), Drizzle ORM 0.38, Better Auth, Zod, nanoid. **Nessuna dipendenza nuova** in M1.2–M1.5. M1.6 riusa `fetch` e `lib/crypto`; il codice OAuth viene portato da heili-dm, non installato.

**Archiviazione**: PostgreSQL 16. Le migrazioni Drizzle stanno in `drizzle/` e si applicano all'avvio del container (`Dockerfile:60`: `node migrate.mjs && node server.js`). Se il runner esce con errore, il server non parte: è questo che rende fail-closed la riconciliazione e le verifiche V1–V7 in modalità `blocca` (R2, R3). Drizzle 0.38.4 applica tutte le migrazioni pendenti in **una sola transazione**: per questo indici `CONCURRENTLY`, `VALIDATE` e riconciliazione a lotti stanno nel runner, non nei file Drizzle (ADR §3.3).

**Test**:
- Vitest (`tests/unit/**/*.test.ts`, `vitest.config.ts`);
- **nuovo** `pnpm test:golden` con PostgreSQL reale (`tests/golden/`, configurazione Vitest separata);
- self-test E2E `pnpm test:e2e` (`scripts/e2e-selftest.mjs`, wa-mock e ai-mock).

**Piattaforma**: un container Docker su Coolify o con docker compose + Caddy; webhook pubblici in HTTPS.

**Tipo di progetto**: monolite web (un solo pacchetto).

**Obiettivi di prestazione**:
- messaggio in bandeja in ≤ 2 s, come oggi;
- risoluzione del contatto da `contact_identity` non più lenta dell'indice `contact_org_wa_identity_uq` di oggi (`EXPLAIN` prima e dopo, Leggi §3.4).

**Vincoli**:
- URL `/api/webhooks/wa/<token>` invariato;
- contratti pubblicati invariati (`/api/bot/*`, `/api/export/*`, codici di `SendError` e `TemplateError`, eventi SSE con campi solo additivi);
- nessun agente chiama Meta o Wapi;
- nessun test saltato.

**Scala**: più organizzazioni per istanza; prova della migrazione su ≥ 100 000 messaggi simulati e 2 organizzazioni.

## 3. Constitution Check

*Gate: prima di M1.2, e di nuovo prima di M1.6.*

| Principio | Valutazione | Stato |
|---|---|---|
| I. Sicurezza dei dati | Segreti di canale cifrati con `lib/crypto` (stesso formato di `meta_credentials`). La riconciliazione copia il cifrato senza decifrarlo. La chiave Wapi resta in `wapi_credentials`. Il trasporto si decide per canale, così la chiave Wapi non va mai a un host non-WhatsApp. Instagram ha segreto, token di verifica e URI di ritorno propri (ADR §3.6), senza ripiego sui valori di WhatsApp | ✅ |
| II. Sovranità (indurito) | M1.2–M1.5: nessuna dipendenza nuova. **M1.6:** chiamate a `graph.instagram.com` e `api.instagram.com`, cioè Meta ma non *WhatsApp Cloud API*. Il testo del Principio II non lo permette | ⚠️ M1.6 richiede D2 |
| III. Multi-tenancy reale | `organization_id NOT NULL` sulle tabelle nuove; FK composte `(organization_id, …)`; `channel_account UNIQUE (channel, external_account_id)` come guardia di routing; test negativi con due organizzazioni | ✅ |
| IV. Idempotenza | `UNIQUE (organization_id, channel, external_message_id)`; riconciliazione ripetibile a ogni avvio con ID deterministici; stati monotòni nel nucleo | ✅ |
| V. Qualità verificabile | Golden prima del codice; sabotaggio per ogni guardia; elenco esplicito di ciò che non è verificato in ogni registro | ✅ |
| VI. Spec prima del codice | Ciclo completo (modello dati e contratto pubblicato): spec, plan e tasks in questa cartella prima di M1.2 | ✅ |
| VII. Tracciabilità | Decisioni nell'ADR (D1–D18), supposti nella spec | ✅ |
| VIII. Foco verticale (WhatsApp) | M1.2–M1.5 non aggiungono canali. **M1.6** aggiunge Instagram, anche se spento in produzione | ⚠️ M1.6 richiede D2 |
| IX. Verifica in vivo | WhatsApp: `pnpm test:e2e` contro wa-mock. Instagram: E2E con un mock Instagram di sviluppo dietro `src/lib/dev-guard.ts`, più la prova reale dell'owner (D16) | ✅ |

**Tracciamento della complessità**

| Violazione | Perché serve | Alternativa più semplice scartata perché |
|---|---|---|
| Principi II e VIII (M1.6) | Validare il contratto con un secondo provider reale prima di R3 (ADR §3.9) | Solo l'adattatore finto: non prova che il contratto regga un provider diverso; un errore scoperto in M3 costa una seconda migrazione |
| Tre rilasci invece di uno | Rollback senza backup in R1 e R2 | Migrazione in un colpo: nessun ritorno indietro (ADR §4) |
| Doppia scrittura per due rilasci | Le letture vecchie restano valide durante il rollback | Trigger nel DB: logica nascosta e fuori dai test (ADR §4) |
| Riconciliazione e verifiche a ogni avvio, fino a R3 | Il codice vecchio, dopo un rollback, aggiorna righe che il solo backfill della migrazione non riallinea, e una migrazione registrata non si riesegue (ADR §3.3) | Backfill solo nella migrazione: provato insufficiente; trigger temporanei o divieto di rollback: ADR §4 |
| Migrazione di R1 in tre fasi (Drizzle, passi online, riconciliazione) | Nessun lock lungo su `message` (ADR §3.3, «Sequenza dei lock») | Un solo file Drizzle: `ACCESS EXCLUSIVE` per tutta la durata |

## 4. Struttura del progetto

### Documentazione

```text
docs/adr/0001-livello-canali.md        # decisioni (M1.1)
specs/005-livello-canali/
├── spec.md                            # comportamento osservabile
├── plan.md                            # questo file: inventario, migrazione, golden, ordine Meta
└── tasks.md                           # compiti per pacchetto (M1.2–M1.6)
docs/ops/rilascio-canali.md            # da scrivere in M1.2: passi R1/R2/R3, verifiche, rollback
docs/lavoro/2026-10-10-adr-canali.md   # registro di M1.1
```

### Codice (proposto; lo crea M1.2–M1.6)

```text
src/server/channels/
├── types.ts                 # contratto ADR §3.1 (solo tipi)
├── registry.ts              # slug → adattatore, filtrato da CHANNELS_ENABLED
├── core/
│   ├── webhook.ts           # handleChannelWebhook: ordine dei controlli ADR §3.5
│   ├── ingest.ts            # da src/server/inbox/ingest.ts (eventi normalizzati)
│   ├── identity.ts          # risoluzione via contact_identity (+ riconciliazione WA invariata)
│   ├── send.ts              # ordine dei controlli d'invio, sandbox, finestra da capabilities
│   ├── status.ts            # monotonìa, filtro per organizzazione
│   ├── accounts.ts          # channel_account: lettura, doppia scrittura da meta_credentials
│   └── window.ts            # finestra calcolata da capabilities.replyWindow
├── whatsapp/
│   ├── adapter.ts  parse.ts  send.ts  capabilities.ts
└── instagram/               # M1.6
    ├── adapter.ts  parse.ts  send.ts  oauth.ts  capabilities.ts
scripts/migrate.mjs                                       # M1.2: passi 1-5 di ADR §3.3 (riconciliazione, Drizzle, passi online, riconciliazione, poi server)
scripts/migrate-channels.mjs                              # M1.2: passi online idempotenti, ciclo dei lotti, V7, modalità del rilascio (costante)
src/app/api/webhooks/[channel]/[webhookToken]/route.ts   # sostituisce webhooks/wa/[webhookToken]
src/app/api/channels/instagram/connect/route.ts           # M1.6, minimo
src/app/api/channels/instagram/callback/route.ts          # M1.6, minimo
tests/golden/                                             # pnpm test:golden (PostgreSQL reale)
tests/unit/channels/contract.ts                           # suite di contratto comune
tests/unit/channels/{whatsapp,instagram,fake}/*.test.ts
```

**Decisione di struttura:** `src/server/inbox/*` e `src/server/whatsapp/*` non si cancellano in M1.3. Diventano moduli sottili che delegano a `channels/` e tengono le stesse firme esportate, perché li chiamano i file elencati in §5.6–5.8. Si eliminano in un commit `refactor:` dedicato solo quando non hanno più chiamanti (Leggi §3.5).

## 5. Inventario esatto dei punti del codice

Base `810272a`, salvo §5.4 (base `6146791`). Formato `file:riga`. «Codice» = riga eseguibile o dichiarazione; i commenti sono segnati come tali.

### 5.1 `wa_identity` / `waIdentity` — 20 righe di codice in 8 file di `src/`

| File:riga | Uso | Cosa cambia |
|---|---|---|
| `src/lib/db/schema.ts:119` | colonna `wa_identity text NOT NULL` | R3: drop |
| `src/lib/db/schema.ts:148` | `uniqueIndex("contact_org_wa_identity_uq")` | R3: drop (sostituito da `contact_identity_org_channel_ext_uq`) |
| `src/server/inbox/identity.ts:79` | matcher per identità risolta | R2: lookup su `contact_identity` |
| `src/server/inbox/identity.ts:83` | matcher `bsuid:<id>` (riconciliazione) | R2: lookup su `contact_identity` con `external_id = 'bsuid:'…` |
| `src/server/inbox/identity.ts:120` | insert del contatto | R1: + insert `contact_identity` nella stessa transazione |
| `src/server/inbox/identity.ts:126` | target `onConflictDoNothing` | R3: target su `contact_identity` |
| `src/server/inbox/identity.ts:138` | rilettura dopo la gara | R2: da `contact_identity` |
| `src/server/inbox/identity.ts:68` | *(commento)* | aggiornare il testo in R2 |
| `src/app/api/bot/context/route.ts:24`, `:26`, `:27` | parametro `?waIdentity=` e messaggio 422 | **contratto pubblicato: invariato** |
| `src/app/api/bot/context/route.ts:52`, `:59` | lookup del contatto | R2: `contact_identity` (canale `whatsapp`) |
| `src/app/api/bot/context/route.ts:106` | campo `waIdentity` del DTO | **invariato**; da R3 si legge da `contact_identity.external_id` |
| `src/app/api/bot/context/route.ts:12` | *(commento JSDoc)* | — |
| `src/app/api/export/contacts/route.ts:57` | campo `waIdentity` dell'export | **invariato**; da R3 ricavato dall'identità |
| `src/app/api/contacts/route.ts:166` | creazione manuale (`waIdentity: phone`) | R1: + insert `contact_identity` |
| `src/app/api/contacts/route.ts:171` | target `onConflictDoNothing` (409 `duplicate`) | R3: conflitto su `contact_identity` (stesso 409) |
| `src/app/api/contacts/[id]/start-conversation/route.ts:37` | guardia «ha telefono o identità» | R2: «ha identità `whatsapp`» |
| `src/server/lab/runner.ts:246` | contatto persona del Laboratorio | R1: + `contact_identity` |
| `src/server/lab/runner.ts:251` | target upsert | R3: target su `contact_identity` |
| `src/server/seed/demo.ts:191` | seed demo | R1: + `contact_identity` |
| `src/lib/meta/client.ts:130` | *(commento su `normalizeRecipient`)* | — |

Fuori da `src/`:
- `scripts/e2e-selftest.mjs:305`, `:306`, `:321`, `:324`, `:330`: E2E del contratto `?waIdentity=`. **Deve restare verde senza modifiche**;
- `drizzle/0001_old_sabra.sql:6`, `:12`, `:16`, `:24`, `:66`, `:69`: storia, non si tocca;
- snapshot `drizzle/meta/0001…0010_snapshot.json`: generati, non si toccano.

### 5.2 `wa_message_id` / `waMessageId` — 23 righe di codice in 7 file di `src/` (più i mock)

| File:riga | Uso | Cosa cambia |
|---|---|---|
| `src/lib/db/schema.ts:349` | `wa_message_id text UNIQUE` (vincolo `message_wa_message_id_unique`, `drizzle/0000_absurd_the_santerians.sql:132`) | R3: drop; arbitro diventa `(organization_id, channel, external_message_id)` |
| `src/server/inbox/ingest.ts:230` | messaggio in entrata → `ingestInboundMessage` | R1: passa anche `externalMessageId` |
| `src/server/inbox/ingest.ts:299` | eco: valore inserito | R1: + `external_message_id`, `channel` |
| `src/server/inbox/ingest.ts:307` | eco: `onConflictDoNothing({ target: waMessageId })` | R3: target indice per organizzazione |
| `src/server/inbox/ingest.ts:361` | tipo di input `waMessageId` | R2: `externalMessageId` |
| `src/server/inbox/ingest.ts:388` | entrata: valore inserito | R1: + `external_message_id`, `channel` |
| `src/server/inbox/ingest.ts:395` | entrata: `onConflictDoNothing({ target: waMessageId })` | R3: target indice per organizzazione |
| `src/server/inbox/ingest.ts:193`, `:292`, `:381` | *(commenti)* | aggiornare in R2 |
| `src/server/inbox/status.ts:43` | stato per `(organization_id, wa_message_id)` | R2: `external_message_id` + `channel` |
| `src/server/inbox/send.ts:117` | tipo di `persistOutbound` | R2: `externalMessageId` |
| `src/server/inbox/send.ts:134` | valore inserito | R1: + `external_message_id`, `channel` |
| `src/server/inbox/send.ts:175`, `:185` | `sendText` | R1: invariato (passa da `persistOutbound`) |
| `src/server/inbox/send.ts:251`, `:261` | `sendMediaMessage` | idem |
| `src/server/inbox/send.ts:291` | allegato fallito: `waMessageId: null` | idem (`external_message_id` NULL) |
| `src/server/inbox/send.ts:339`, `:361` | `sendStructured` | idem |
| `src/server/whatsapp/templates.ts:358`, `:384` | `sendTemplate`: ID restituito e inserito | R1: + `external_message_id`, `channel` |
| `src/app/api/bot/typing/route.ts:52`, `:59`, `:64` | ultimo `wamid` in entrata per «letto» e «sta scrivendo» | R2: `external_message_id` (e `markReadAndTyping` dell'adattatore in M1.3) |
| `src/server/seed/demo.ts:220` | seed | R1: + `external_message_id` |

Mock di sviluppo (non pubblici, solo con `WA_MOCK_ENABLED`):
- `src/server/dev/wa-mock-inbound.ts:76`, `:81`, `:132`, `:139`, `:175`, `:198`;
- `src/server/dev/wa-mock-state.ts:18` (e il commento a `:58`);
- `src/app/api/dev/wa-mock/graph/[...path]/route.ts:155`, `:158`, `:168`;
- `src/app/api/dev/wa-mock/inbound/route.ts:21`;
- `src/app/api/dev/wa-mock/echo/route.ts:23`;
- `src/app/api/dev/wa-mock/status/route.ts:15`, `:34`, `:44`. La lettura a `:34` passa a `external_message_id` in R2; il campo `waMessageId` dell'API del mock **resta**, perché lo usano gli script E2E.

Script E2E (invariati):
- `scripts/e2e-selftest.mjs:111`, `:135`, `:143`, `:645`, `:664`, `:697`, `:714`, `:732`, `:838`, `:864`, `:885`, `:912`;
- `scripts/e2e-search-filters.mjs:56`;
- `scripts/e2e-responsive.mjs:93`;
- `scripts/e2e-send-failure.mjs:53`, `:76`, `:78`, `:79`, `:83`, `:122`, `:125`.

Storia: `drizzle/0000_absurd_the_santerians.sql:123`, `:132`.

### 5.3 `meta_credentials` / `metaCredentials` e `src/server/whatsapp/credentials.ts`

Tabella: `src/lib/db/schema.ts:435-460`:
- `:456` `meta_credentials_org_uq`;
- `:458` `meta_credentials_phone_uq`;
- creata in `drizzle/0000_absurd_the_santerians.sql:135`, FK `:235`, indici `:251-252`.

Funzioni esportate (`src/server/whatsapp/credentials.ts`), con i punti interni che toccano la tabella:

| Export | Riga | Righe sulla tabella | Cosa cambia |
|---|---|---|---|
| `type Credentials` | `:7` | `:18` (`Row`) | R2: diventa la vista di `channel_account` WhatsApp (stessi campi) |
| `getCredentialsByPhoneNumberId` | `:38` | `:44-45` | R2: `channel_account` per `(whatsapp, external_account_id)` |
| `getCredentialsByWabaId` | `:51` | `:57-58` | R2: per `external_parent_id` |
| `getCredentialsByOrg` | `:63` | `:69-70` | R2: per `(organization_id, 'whatsapp')` |
| `saveCredentials` | `:75` | `:86`, `:100` (upsert per org) | R1: + upsert `channel_account` nella stessa transazione |
| `markReconnectRequired` | `:116` | `:121-123` | R1: + `channel_account.status` |
| `tokenLast4` | `:127` | — | invariato |

Chiamanti in `src/` (11 file):

| File:riga | Funzione |
|---|---|
| `src/server/inbox/ingest.ts:6` (import), `:199`, `:249` | `getCredentialsByPhoneNumberId`: routing di messaggi ed echi |
| `src/server/inbox/send.ts:6-10` (import), `:88`, `:276`, `:393` | `getCredentialsByOrg`, `markReconnectRequired`, `type Credentials` |
| `src/server/whatsapp/templates.ts:12-16` (import), `:75`, `:123`, `:184`, `:200`, `:249`, `:341` | org, WABA, reconnect |
| `src/server/whatsapp/media.ts:7-10` (import), `:211` | `getCredentialsByOrg`, `type Credentials` |
| `src/server/automations/engine.ts:8`, `:74` | `getCredentialsByOrg` |
| `src/app/api/settings/whatsapp/route.ts:3-7` (import), `:13`, `:22`, `:44` | stato, `tokenLast4`, `saveCredentials` |
| `src/app/api/bot/typing/route.ts:6`, `:67` | `getCredentialsByOrg` |
| `src/app/api/bot/media/[mediaId]/route.ts:3`, `:25` | `getCredentialsByOrg` |
| `src/app/api/dev/wa-mock/inbound/route.ts:4`, `:41` | mock |
| `src/app/api/dev/wa-mock/echo/route.ts:4`, `:40` | mock |
| `src/app/api/dev/wa-mock/status/route.ts:6`, `:38` | mock |

Altro:
- `src/components/settings/whatsapp-wizard.tsx:24`, `:87`, `:236` usano il campo DTO `tokenLast4` (non la funzione): invariato;
- test: `tests/unit/credentials.test.ts:22` (mock della tabella), `:35-38`, `:62-64`. In R1 il mock della tabella deve includere `channel_account`.

### 5.4 `wapi_credentials` (C3, base `notte/c3-wapi` @ `6146791`) — non migrata in M1

| File:riga | Uso |
|---|---|
| `drizzle/0011_classy_bloodstorm.sql:1-15` | tabella, FK cascade, `wapi_credentials_org_uq` |
| `src/lib/db/schema.ts:469-485` | `wapiCredentials` |
| `src/lib/db/ids.ts:28` | prefisso `wk` |
| `src/server/whatsapp/wapi-credentials.ts:32` `getWapiKeyByOrg`, `:60` `getWapiKeyStatus`, `:84` `saveWapiKey`, `:128` `revokeWapiKey` | accesso (tutte con `scoped()`) |
| `src/lib/meta/client.ts:2` (import), `:101` `resolveGraphTransport`, `:109` lettura della chiave, `:184` uso in `graphRequest`, `:75` `describeGraphRouting` | **unico lettore della chiave in chiaro**. M1.6: il trasporto si decide per canale (FR-016) |
| `src/server/whatsapp/media.ts:6`, `:172`, `:272` | download e upload via trasporto risolto (controllo di origin di C3) |
| `src/app/api/settings/whatsapp/wapi-key/route.ts:4-11`, `:28`, `:34`, `:58`, `:71` | API owner/admin |
| `tests/unit/meta-client.test.ts:85-86` (`vi.doMock`), `tests/unit/helpers/fake-wapi-db.ts`, `wapi-credentials.test.ts`, `wapi-routing.test.ts`, `wapi-key-routes.test.ts`, `wapi-key-page.test.ts` | test C3: devono restare verdi dopo M1.3 e M1.6 |

### 5.5 `/api/webhooks/wa`

| File:riga | Uso | Cosa cambia |
|---|---|---|
| `src/app/api/webhooks/wa/[webhookToken]/route.ts:21-37` | GET di verifica | M1.3: `whatsappAdapter.webhook.handshake` |
| `…/route.ts:39-69` | POST: token → firma → parse → 200 → `after()` | M1.3: `handleChannelWebhook("wa", …)`; la cartella diventa `src/app/api/webhooks/[channel]/[webhookToken]/` |
| `…/route.ts:71-86` | `processPayload`: `messages`, `smb_message_echoes`, `message_template_status_update` (`entry.id` = WABA a `:81`) | M1.3: dentro `whatsappAdapter.webhook.parse` |
| `src/app/api/settings/webhook/route.ts:9` | costruisce l'URL mostrato nella UI | invariato (stesso slug `wa`). Nota: C3 segnala che questa GET non ha controllo di ruolo (registro C3, «Falle») |
| `src/server/dev/wa-mock-inbound.ts:15` | il mock posta all'URL | invariato |
| `.env.example:33` | documentazione dell'URL | invariato |
| `tests/e2e/us1-inbox.md:74` | E2E: segmento errato → 404 | deve restare vero |

Guardie dei webhook usate dalla route: `src/server/inbox/webhook.ts:9` `safeEqual`, `:16` `isValidWebhookToken`, `:27` `isValidSignature` (senza `META_APP_SECRET` passa: D3).

### 5.6 `src/server/inbox/*` — 8 file, 1511 righe

| File | Export (riga) | Importato da (file:riga) |
|---|---|---|
| `identity.ts` (151) | `BSUID_PREFIX` :17 · `ResolvedIdentity` :19 · `resolveIdentity` :32 · `getOrCreateContactByIdentity` :73 | `src/server/inbox/ingest.ts:13-17` · `tests/unit/identity.test.ts:3` |
| `ingest.ts` (466) | `mediaInputFrom` :57 · `getOrCreateContact` :149 (**nessun chiamante**: codice morto) · `getOrCreateConversation` :163 · `processMessagesValue` :195 · `processEchoesValue` :245 · `ingestInboundMessage` :358 · `serializeMessage` :437 | `src/app/api/webhooks/wa/[webhookToken]/route.ts:8` · `src/app/api/contacts/[id]/start-conversation/route.ts:7` · `src/app/api/conversations/[id]/messages/route.ts:4` · `src/server/automations/engine.ts:6` · `src/server/inbox/send.ts:12` · `src/server/whatsapp/templates.ts:18` · `tests/unit/echoes.test.ts:2` |
| `lead-activity.ts` (118) | `onLeadActivity` :12 · `createLeadForContact` :47 | `src/server/inbox/ingest.ts:19` · `src/app/api/contacts/route.ts:10` |
| `queries.ts` (162) | `ConversationDto` :6 · `listConversations` :21 · `getConversation` :67 · `listMessages` :90 · `serializeConversation` :114 · `updateConversation` :136 | `src/app/api/conversations/route.ts:2` · `src/app/api/conversations/[id]/route.ts:4` · `src/app/api/conversations/[id]/messages/route.ts:3` · `src/app/api/conversations/[id]/messages/media/route.ts:2` |
| `send.ts` (406) | `SendError` :20 (codici :21-28) · `sendText` :164 · `sendMediaMessage` :202 · `LocationInput` :304 · `ContactInput` :311 · `sendStructured` :314 · `callGraphSend` :373 | `src/server/ai/pipeline.ts:10` · `src/server/whatsapp/templates.ts:17` · `src/app/api/bot/messages/route.ts:6` · `src/app/api/conversations/[id]/messages/route.ts:5` · `src/app/api/conversations/[id]/messages/media/route.ts:3` · `src/app/api/conversations/[id]/messages/template/route.ts:3` · `src/app/api/contacts/[id]/start-conversation/route.ts:8` · `tests/unit/send-sandbox.test.ts:56` · `tests/unit/media-send.test.ts:119` |
| `status.ts` (72) | `isUpgrade` :17 · `applyStatusUpdate` :25 (filtro org :42-43) | `src/server/inbox/ingest.ts:18` · `tests/unit/status-monotonic.test.ts:2` |
| `webhook.ts` (110) | `safeEqual` :9 · `isValidWebhookToken` :16 · `isValidSignature` :27 · tipi `Webhook*` :43-110 | `src/app/api/webhooks/wa/[webhookToken]/route.ts:3-7` · `src/server/inbox/ingest.ts:8-12` · `src/server/inbox/identity.ts:5` · `src/server/inbox/status.ts:5` · `src/server/whatsapp/template-events.ts:1` · `src/server/whatsapp/templates.ts:19` · `tests/unit/webhook.test.ts:3-7` · `tests/unit/identity.test.ts:4` · `tests/unit/echoes.test.ts:3` |
| `window.ts` (26) | `WINDOW_MS` :8 · `isWindowOpen` :10 · `windowRemainingMs` :19 | §5.10 |

Punti interni del flusso d'invio che restano nel nucleo:
- `send.ts:52-112` (`prepareSend`): sandbox `:74`, finestra `:81`, account `:88-90`, destinatario `:101-104` (`normalizeRecipient` del telefono, altrimenti `waUserId`);
- `send.ts:240-244`: upload prima dell'invio;
- `send.ts:373-406`: `callGraphSend` su `${phoneNumberId}/messages` (`:379`), che passa nell'adattatore.

Routing in entrata: `ingest.ts:195-237`. `phone_number_id` sconosciuto → avviso e scarto (`:200-208`). Stati prima dei messaggi (`:212-214`).

### 5.7 `src/server/whatsapp/*` — 5 file, 940 righe (più `wapi-credentials.ts` di C3)

| File | Export (riga) | Importato da (file:riga) |
|---|---|---|
| `connect.ts` (83) | `ConnectionCheck` :3 · `testConnection` :15 · `subscribeAppToWaba` :68 | `src/app/api/settings/whatsapp/route.ts:8` · `src/app/api/settings/whatsapp/test/route.ts:3` · `tests/unit/meta-client.test.ts:211` |
| `credentials.ts` (129) | §5.3 | §5.3 |
| `media.ts` (307) | `MediaKind` :19 · `MEDIA_LIMITS` :22 · `kindFromMime` :54 · `MediaValidationError` :61 · `validateOutgoing` :75 · `mediaFilePath` :97 · `saveMediaFile` :103 · `readMediaFile` :114 · `MediaFetchError` :125 · `downloadGraphMedia` :141 · `ensureAssetAvailable` :196 · `uploadGraphMedia` :252 | `src/server/inbox/ingest.ts:7` · `src/server/inbox/send.ts:13-17` · `src/app/api/bot/media/[mediaId]/route.ts:4` · `src/app/api/media/[assetId]/route.ts:5-8` · `src/app/api/conversations/[id]/messages/media/route.ts:4` · `src/app/api/branding/favicon/route.ts:1` · `src/app/api/settings/branding/favicon/route.ts:9` · `tests/unit/media-send.test.ts:2-6`, `:70` (`vi.mock`) |
| `template-events.ts` (13) | `processTemplateStatusValue` :8 | `src/app/api/webhooks/wa/[webhookToken]/route.ts:9` |
| `templates.ts` (408) | `TemplateError` :22 · `templateErrorStatus` :47 · `countVariables`/`renderBody`/`validateBodyVariables` :51 · `serializeTemplate` :55 · `createTemplate` :68 · `syncTemplates` :183 · `applyTemplateStatusEvent` :244 · `sendTemplate` :275 (sandbox :333, destinatario :348-350) | `src/server/whatsapp/template-events.ts:2` · `src/server/automations/engine.ts:9` · `src/app/api/templates/route.ts:6-11` · `src/app/api/templates/sync/route.ts:2-6` · `src/app/api/conversations/[id]/messages/template/route.ts:4-8` · `src/app/api/contacts/[id]/start-conversation/route.ts:10-14` · `tests/unit/templates.test.ts:2-6` |

Nota per M1.3: `media.ts` contiene anche funzioni **non** WhatsApp, usate dal favicon del branding (`mediaFilePath`, `saveMediaFile`, `readMediaFile`). Restano dove sono, oppure vanno in `src/server/media/` con un `refactor:` separato. Non entrano nell'adattatore.

### 5.8 `src/server/ai/*` — 5 file, 503 righe

| File | Export (riga) | Importato da (file:riga) | Punti legati al canale |
|---|---|---|---|
| `pipeline.ts` (335) | `scheduleAgentTurn` :42 · `runAgentTurn` :87 · `applyHandoff` :259 | `src/server/ai/trigger.ts:1` · `src/server/lab/runner.ts:5` · `tests/unit/lab-sandbox.test.ts:112` | import di finestra e invio `:9-10`; sandbox `:112`, `:216`; finestra chiusa → handoff `ventana` `:124-126`, `:228-229`; `sendText` `:221`; insert sandbox `:242` (senza ID esterno); nota sul contatto `:329` |
| `prompts.ts` (90) | `JUDGE_MARKER` :7 · `renderKb` :9 · `buildAgentSystemPrompt` :25 · `buildJudgePrompt` :61 | `src/server/ai/pipeline.ts:13` · `src/server/lab/judge.ts:3` · `src/server/lab/runner.ts:6` · `src/server/bot/profile.ts:2` · `src/app/api/kb/size/route.ts:5` · `src/server/dev/ai-mock.ts:1` | «asistente de WhatsApp» `:33`; giudice «agentes de WhatsApp» `:68`. M1.5, con golden aggiornati in modo dichiarato |
| `actions.ts` (52) | `AgentAction` :8 · `AgentActionType` :28 · `resolveStage` :34 · `degradeAction` :45 | `src/server/ai/pipeline.ts:11` | nessuno |
| `handoff.ts` (12) | `HANDOFF_BACKUP_REGEX` :7 · `matchesHandoffIntent` :10 | `src/server/ai/pipeline.ts:12` · `tests/unit/handoff.test.ts:2` | nessuno |
| `trigger.ts` (14) | `maybeRunAgentTurn` :9 | `src/server/inbox/ingest.ts:20` | nessuno |

In M1.3 `src/server/ai/*` **non cambia**: `sendText` mantiene firma e codici. In M1.5 la finestra si legge dalle capacità del canale della conversazione (`pipeline.ts:125`) e il prompt nomina il canale (`prompts.ts:33`).

### 5.9 Punti di scrittura (doppia scrittura in R1 e R2)

Ogni riga sotto, in R1, scrive anche la struttura nuova **nella stessa transazione**. Quando oggi la scrittura non è in una transazione, M1.2 la avvolge in `db.transaction`. Questo cambia solo l'atomicità, non il risultato osservabile.

| File:riga | Scrittura di oggi | Scrittura aggiunta in R1 |
|---|---|---|
| `src/server/whatsapp/credentials.ts:86` | upsert `meta_credentials` | upsert `channel_account` (`legacy_meta_credentials_id`, stesso cifrato) |
| `src/server/whatsapp/credentials.ts:121` | `status = reconnect_required` | stesso stato su `channel_account` |
| `src/server/inbox/identity.ts:116` | insert `contact` | insert `contact_identity` (`whatsapp`, `external_id = wa_identity`) |
| `src/server/inbox/identity.ts:107` | update `contact` (riconciliazione: `phone`/`wa_user_id`) | nessuna: `wa_identity` non cambia (`identity.ts:68`) |
| `src/app/api/contacts/route.ts:160` | insert `contact` manuale | insert `contact_identity` |
| `src/server/lab/runner.ts:241` | upsert `contact` persona | upsert `contact_identity` |
| `src/server/seed/demo.ts:187` | insert `contact` demo | insert `contact_identity` |
| `src/server/inbox/ingest.ts:169` | insert `conversation` reale | `channel_account_id` = account WhatsApp dell'organizzazione (NULL se non c'è, come oggi `not_connected`) |
| `src/server/lab/runner.ts:182` | insert `conversation` `is_test` | nessuna (`channel_account_id` NULL per regola) |
| `src/server/seed/demo.ts:205` | insert `conversation` demo | come `ingest.ts:169` |
| `src/server/inbox/ingest.ts:294` | insert `message` eco | `channel = 'whatsapp'` (default), `external_message_id = wamid` |
| `src/server/inbox/ingest.ts:383` | insert `message` in entrata | idem |
| `src/server/inbox/send.ts:129` | insert `message` in uscita (anche fallito, ID NULL) | idem (NULL se NULL) |
| `src/server/whatsapp/templates.ts:379` | insert `message` del modello | idem |
| `src/server/ai/pipeline.ts:242` | insert `message` sandbox | nessuna (ID NULL, canale di default) |
| `src/server/lab/runner.ts:192` | insert `message` del Laboratorio | nessuna |
| `src/server/seed/demo.ts:216` | insert `message` demo | `external_message_id` |

Scritture su `contact` che non toccano l'identità, quindi senza doppia scrittura: `src/server/ai/pipeline.ts:329` (note), `src/server/bot/ficha.ts:115` (scheda), `src/app/api/contacts/[id]/route.ts:75` (modifica). Le cancellazioni di `contact` si propagano a `contact_identity` per cascata (FK composta).

### 5.10 Consumatori della finestra di 24 ore (`src/server/inbox/window.ts`)

| File:riga | Uso | M1.5 |
|---|---|---|
| `src/server/inbox/send.ts:81` | `window_closed` prima dell'invio | finestra dalle capacità dell'account della conversazione |
| `src/server/ai/pipeline.ts:125` | handoff `ventana` | idem |
| `src/server/inbox/queries.ts:130-131` | DTO `windowOpen`, `windowRemainingMs` (UI: `src/components/inbox/composer.tsx:421`, tipo `src/lib/types.ts:14`) | idem; per `unbounded` → `windowOpen: true` e `windowRemainingMs` = valore sentinella da definire in M1.5 (contratto UI) |
| `src/server/automations/engine.ts:161` | testo libero se la finestra è aperta, altrimenti modello | + filtro per identità `whatsapp` (rischio automazioni, ADR §6) |
| `src/app/api/bot/context/route.ts:116-117` | DTO del cervello esterno | **contratto pubblicato**: stessi campi |
| `src/app/api/contacts/[id]/start-conversation/route.ts:60` | apertura con modello se la finestra è chiusa | idem |
| `tests/unit/window.test.ts:2` | test della costante | deve restare verde (la costante resta l'implementazione di WhatsApp) |

### 5.11 Sandbox del Laboratorio (guardie che restano nel nucleo)

- `src/server/inbox/send.ts:74`: `isTest` → `sandbox_violation` prima di qualunque `fetch`;
- `src/server/whatsapp/templates.ts:333`: idem per i modelli;
- `src/server/ai/pipeline.ts:216`: `deliverReply` persiste senza inviare;
- test: `tests/unit/send-sandbox.test.ts`, `tests/unit/lab-sandbox.test.ts`.

### 5.12 Comandi per rigenerare l'inventario

```bash
grep -rn "waIdentity\|wa_identity" src scripts tests --include=*.ts --include=*.tsx --include=*.mjs
grep -rn "waMessageId\|wa_message_id" src scripts tests --include=*.ts --include=*.tsx --include=*.mjs
grep -rn "metaCredentials\|meta_credentials\|whatsapp/credentials" src tests
grep -rn "webhooks/wa" src tests scripts .env.example
grep -rln -E "@/server/(inbox|whatsapp|ai)/" src tests | sort
grep -rn "isWindowOpen\|windowRemainingMs\|WINDOW_MS" src tests
# C3, dopo il merge:
grep -rn "wapiCredentials\|wapi_credentials\|getWapiKeyByOrg\|resolveGraphTransport" src tests
```

## 6. Migrazione: file e sequenza

Il meccanismo (riconciliazione all'avvio, V1–V7, modalità, sequenza dei lock) è deciso in ADR §3.3: qui solo file e prove.

| Passo | File | Contenuto |
|---|---|---|
| 0 | — | C3 integrato (migrazione `0011`). Golden registrati sul codice invariato (commit 1 di M1.2) |
| R1 | `src/lib/db/schema.ts` → `pnpm db:generate` → `drizzle/0012_*.sql` completata a mano | **Fase A**, solo catalogo, con `SET LOCAL lock_timeout = '5s'`: tabelle nuove con i loro indici (sono vuote), colonne nuove di `conversation` e `message`, `CHECK` e FK composta di `conversation` **`NOT VALID`**, funzioni `channels_legacy_sync`, `channels_legacy_sync_messages`, `channels_legacy_check` di ADR §3.3. **Niente** indici su tabelle esistenti, niente backfill, niente `RAISE`. Indici e vincoli restano dichiarati in `schema.ts` (snapshot di Drizzle coerente, nessuna rigenerazione); solo il loro `CREATE`/`VALIDATE` passa al runner |
| R1 | `scripts/migrate-channels.mjs` | **Fase B**, un'istruzione per volta, fuori transazione, `lock_timeout = '5s'`: `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS` su `contact (organization_id, id)` e su `message (organization_id, channel, external_message_id)`, FK composta di `contact_identity` verso `contact`, `VALIDATE CONSTRAINT` del CHECK di `message` e della FK di `conversation`. Indice `INVALID` → `DROP INDEX CONCURRENTLY` e nuovo tentativo. **Fase C**: riconciliazione (messaggi a lotti di 5 000 in autocommit), V1–V6, V7 |
| R1 | `scripts/migrate.mjs` | passi 1–5 di ADR §3.3; modalità `avvisa` |
| R1 | `src/lib/db/ids.ts` | prefissi `cha`, `ci` |
| R1 | punti di §5.9 | doppia scrittura |
| R2 | nessuna migrazione | modalità `blocca` (costante nel codice di R2); letture nuove, adattatore WhatsApp, route `[channel]` (§5.1–5.8) |
| M1.6 | migrazione Drizzle (numero secondo l'ordine reale dei merge) | `ALTER TABLE contact ALTER COLUMN wa_identity DROP NOT NULL` (ADR §3.9): solo catalogo. Nessun altro cambio; Instagram resta spento in produzione fino a R3 (D17) |
| R3 | migrazione Drizzle (numero secondo l'ordine reale dei merge) | il runner riconcilia e verifica in modalità `blocca` **prima** di applicarla; poi `DROP` (ADR §3.3), `DROP FUNCTION channels_legacy_*`, indice univoco della conversazione per account (D6, `CONCURRENTLY` nel runner), `ON CONFLICT` sull'indice per organizzazione |

**Prove richieste in M1.2** (PostgreSQL 16 usa e getta, nello scratchpad, mai dati reali), tutte con il runner vero:
1. migrazioni da zero, due volte di fila (idempotenza di fasi A, B e C);
2. DB alla `0011` con dati simulati (2 organizzazioni, ≥ 100 000 messaggi, contatti BSUID e telefono, una conversazione `is_test`, un messaggio fallito con ID NULL, una chiave Wapi revocata, un'organizzazione senza numero), poi R1, poi V1–V7 a 0;
3. **rollback di R1**: immagine `810272a`+C3 avviata su un DB già a `0012`. Il migratore deve partire senza applicare nulla (già provato con il migratore di `810272a` nella terza tornata di M1.1; si ripete con l'immagine vera);
4. **aggiornamenti del codice vecchio** durante il rollback, eseguiti con le funzioni vere di R0 (`saveCredentials`, `markReconnectRequired`, ingesta, invio), non con SQL a mano: numero ricollegato, token ruotato, `reconnect_required`, **numeri scambiati tra A e B**, collegamento di un'organizzazione che non aveva numero, contatti, conversazioni e messaggi nuovi. Poi avvio di R1 e di R2: V1–V7 a 0 e `channel_account` uguale a `meta_credentials` campo per campo. Lo stesso scenario prima della riconciliazione deve dare V2 > 0 (la verifica vede il difetto);
5. **ritorno a R2 senza migrazioni pendenti** (R2 → R1 → R0 → R2): la riconciliazione gira comunque all'avvio e riallinea;
6. **fail-closed**: un'anomalia non correggibile (account orfano: `meta_credentials` cancellata a mano) → R2 esce con codice 1 e il log nomina V1; R1 parte e lo scrive nel log;
7. **lock**: una sonda legge e inserisce su `message` ogni 0,2 s con `lock_timeout = 200 ms` durante le fasi A, B e C, e nessuna resta bloccata; fase A dietro una transazione lunga su `message` → rinuncia, annulla e ritenta (il prototipo della terza tornata di M1.1 dà già questi risultati su 1 milione di messaggi);
8. un `CREATE INDEX CONCURRENTLY` interrotto (indice `INVALID`) → al riavvio il runner lo ricrea;
9. misure: durata di ogni fase e dell'avvio totale (soglia di 60 s, ADR §3.3), `EXPLAIN` della risoluzione del contatto prima e dopo.

## 7. Golden e suite di contratto

### 7.1 `pnpm test:golden` (PostgreSQL reale)

- Configurazione: `vitest.golden.config.ts` con `include: ["tests/golden/**/*.golden.test.ts"]`, `DATABASE_URL_GOLDEN` obbligatoria. Se manca, il primo test **fallisce** con un messaggio chiaro (niente `skip`).
- Struttura:
  - `tests/golden/setup.ts`: crea lo schema con le migrazioni e semina le organizzazioni A e B;
  - `tests/golden/normalize.ts`: segnaposti per ID e orari, bearer → tipo;
  - `tests/golden/__golden__/*.json`.
- Casi, in file per area:

| File | Casi |
|---|---|
| `inbound.golden.test.ts` | testo `521…` · solo BSUID · telefono+BSUID con contatto preesistente · duplicato · immagine · documento con nome · posizione · contatti · allegato rotto · tipo non supportato · senza identità · più `entry`/`changes` |
| `status.golden.test.ts` | `sent→delivered→read` · `delivered` dopo `read` · `failed` con codice · **wamid di A sul numero di B** |
| `echo.golden.test.ts` | testo · immagine · duplicato · senza `to` · pausa AI `manual_reply` |
| `routing.golden.test.ts` | stato del modello per WABA · `phone_number_id` sconosciuto · **payload per B non tocca A** |
| `webhook-auth.golden.test.ts` | token errato 404 · firma errata 401 · body illeggibile 200 · GET 200/403/404 |
| `send.golden.test.ts` | testo · allegato · upload fallito · posizione · contatti · modello con variabili · destinatario solo BSUID · finestra chiusa · 190 → `reconnect_required` · 5xx → `meta_unavailable` · **organizzazione A su conversazione di B → rifiutato senza fetch** · trasporto Wapi per organizzazione (C3) |
| `agent.golden.test.ts` | risposta · finestra chiusa → `ventana` · Laboratorio senza `fetch` |
| `migration.golden.test.ts` | riconciliazione su A e B · FK composta che rifiuta un'identità incrociata · indice `(channel, external_account_id)` tra organizzazioni · indice `(organization_id, channel, external_id)` nella stessa organizzazione · aggiornamenti del codice vecchio riallineati (numero, token, stato, scambio di numeri) · ritorno a R2 senza migrazioni pendenti · V2 che vede un campo alterato a mano · modalità `blocca` su un account orfano · sonda di lock durante le fasi A, B e C |

### 7.2 Suite di contratto (`pnpm test`, dopo M1.3)

`tests/unit/channels/contract.ts` esporta `runContractSuite(adapter, fixtures)`:
- `parse` puro (nessun accesso a `fetch`, DB o orologio: spiati);
- ordine degli eventi;
- payload illeggibile → `[]`;
- firma (valida, errata, assente);
- `send` restituisce `externalMessageId` e mappa gli errori in `SendError`;
- capacità coerenti (`templates: "none"` ⇒ nessun `template_status`).

La eseguono `whatsapp/`, `fake/` e, in M1.6, `instagram/`.

### 7.3 Sabotaggi (uno per guardia, registrati)

Le guardie sono quelle di ADR §3.7 (compresi i due indici univoci e i quattro sabotaggi della riconciliazione), più:
- slug sconosciuto → 404;
- `CHANNELS_ENABLED` che spegne un canale;
- firma obbligatoria di Instagram, solo con `INSTAGRAM_APP_SECRET`;
- variabili di Instagram mancanti o non valide → canale spento (§7.4);
- trasporto per canale (§7.4);
- stato OAuth legato a sessione e organizzazione.

### 7.4 Test negativi e sabotaggi specifici di M1.6

- un evento Instagram per l'account di B non scrive in A;
- lo stesso IGSID in A e B dà due contatti;
- callback OAuth con lo stato di A e la sessione di B → rifiutato; con un `member` di A → rifiutato;
- organizzazione con chiave Wapi propria: un invio Instagram non chiama mai `WAPI_BASE_URL` e il bearer `hlp_` non compare in nessuna richiesta. **Sabotaggio:** rimuovere il filtro per canale in `resolveGraphTransport` → il test fallisce;
- `CHANNELS_ENABLED=whatsapp`: POST su `/api/webhooks/instagram/<token>` → 404;
- `CHANNELS_ENABLED=whatsapp,instagram` con una delle quattro variabili di ADR §3.6 mancante: GET, POST e collegamento → 404, nessuna scrittura, log con i soli nomi. **Sabotaggio:** il registro carica l'adattatore anche con variabili mancanti → il test fallisce;
- webhook firmato con `META_APP_SECRET` (presente) invece di `INSTAGRAM_APP_SECRET` → 401. **Sabotaggio:** ripiego su `META_APP_SECRET` → il test fallisce;
- `INSTAGRAM_REDIRECT_URI` su un'origine diversa da `APP_BASE_URL` → canale spento. **Sabotaggio:** controllo dell'origine tolto → il test fallisce.

## 8. Ordine di lavoro con Meta (sintesi di ADR §3.8)

1. M1.2 e M1.3 (nessuna dipendenza da Meta).
2. L'owner prepara l'app Meta del CRM in modalità sviluppo (D14), gli account di prova (Instagram tester, Pagina di prova) e un ambiente di sviluppo HTTPS (D16).
3. M1.6 (agenti, solo fixture e mock), poi la prova reale dell'owner.
4. Messenger nello stesso modo.
5. K7: video sulla funzione funzionante, poi App Review (solo `instagram_business_basic` e `instagram_business_manage_messages`, più Messenger da confermare in K0).
6. Nell'attesa: clienti pilota come tester.
7. Dopo l'approvazione: K3, K4, M3.1, M3.2.

## 9. Verifica: comandi

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build      # ogni commit
DATABASE_URL=postgres://fittizia/db pnpm db:generate         # se cambia lo schema: migrazione committata
DATABASE_URL_GOLDEN=postgres://…usa-e-getta… pnpm test:golden   # M1.2, M1.3, M1.6: obbligatorio
pnpm test:e2e                                                # app viva + mock (Definizione di Hecho reforzada)
```

**D-CI:** `.github/workflows/ci.yml` oggi esegue typecheck, lint, test e build (`:53-68`), ma senza PostgreSQL. M1.2 aggiunge un servizio `postgres:16` e il passo `pnpm test:golden`. Senza questo, il golden resta un controllo locale, e il registro deve dirlo.
