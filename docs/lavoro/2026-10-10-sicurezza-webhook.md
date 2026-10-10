# Registro di lavoro — 2026-10-10 — sicurezza-webhook

**Mandato:** tre problemi di sicurezza segnalati sul codice: (1) webhook Meta accettato senza firma se manca `META_APP_SECRET`; (2) URL del webhook (con il segmento segreto) visibile a chiunque sia loggato; (3) chiave di export unica che legge qualsiasi organizzazione. **Branch:** `claude/loving-feynman-fppq8j-sicurezza-webhook` (PR aperta, non unita). **Security-critical:** serve revisione indipendente prima del merge.

Base: `origin/main` @ `83c6a13`. Baseline: 65 file / 993 test unitari, 94 golden, E2E 96/96.

## Stato trovato (prima di toccare)

| # | Problema | Su `main` | Cosa restava |
|---|---|---|---|
| 1 | Webhook senza firma se manca `META_APP_SECRET` | **aperto**: `isValidSignature` restituiva `true` senza segreto, in qualunque ambiente | tutto |
| 2 | URL del webhook visibile a tutti | **già chiuso per i ruoli** da `9267f91` (`GET /api/settings/webhook` con `withAdminAuth`, pagina solo owner/admin) | l'admin di un'organizzazione vede comunque il token d'istanza: senza firma poteva iniettare nelle ALTRE organizzazioni. Si chiude solo con il punto 1 |
| 3 | Chiave di export unica | **già chiuso** da `e32c203` (C2): chiavi `vex_` per organizzazione, `?org=` non sceglie, `EXPORT_API_KEY` valida solo con UNA organizzazione | le route usavano `eq(organizationId)` invece di `scoped()` e i JOIN (contact, pipeline_stage, tag, conversation) non erano filtrati per organizzazione; nessun avviso di transizione per chi usa ancora la chiave d'istanza |

Nessuna migrazione Drizzle necessaria: il campo `bot_api_key.scope` esiste dalla 0010.

## Correzioni

### 1. Firma obbligatoria (fail-closed)
- `src/server/inbox/webhook.ts`: `isValidSignature` senza segreto → `false`. Nuova `checkSignature(raw, header, secret, allowUnsigned)`: con segreto verifica SEMPRE; senza segreto `secret_missing` salvo `allowUnsigned`.
- `src/lib/dev-guard.ts`: `unsignedWebhookAllowed()` = stesso gate dei mock (`WA_MOCK_ENABLED=true` E `NODE_ENV !== "production"`); `webhookSecretMissingWarning()` (testo senza valori segreti).
- Route `/api/webhooks/wa/[webhookToken]`: ordine 404 (token) → **503** se manca il segreto (GET e POST) → 401 firma assente/errata. Log al massimo una volta al minuto, mai il token né il segreto.
- Avviso all'avvio (`instrumentation-node.ts`, `warnWebhookSignatureConfig`).
- `GET /api/settings/webhook` restituisce `signatureRequired`; il wizard mostra un'**allerta** se manca il segreto (es/en/it), non più «livello opzionale».
- Perché 503 e non 401: è un errore di configurazione del server; Meta ritenta i 5xx, quindi i messaggi arrivano quando l'owner imposta il segreto (entro la finestra di ritentativi di Meta).
- Testi aggiornati: `.env.example`, `README.md`, `CLAUDE.md`.

### 2. URL del webhook
Nessun cambio di ruolo (già owner/admin). Prova nuova: l'admin di A legge la URL e la usa per mandare un evento al numero di B → 503 senza segreto, 401 con segreto (anche firmando con il token della URL); l'ingestione non viene mai chiamata.

### 3. Export per organizzazione
- Le 4 route `/api/export/*` filtrano con `scoped()` anche nei JOIN.
- `src/server/api-keys.ts`: quando si usa la chiave d'istanza ereditata (`EXPORT_API_KEY`/`BOT_API_KEY`) un `console.warn` per ambito e processo invita a migrare a `vex_`/`vbk_` (senza il valore).

## Transizione per chi usa `EXPORT_API_KEY`
1. Owner/admin: Configurazione → Claves de API → crea una chiave di export (`vex_…`), mostrata una sola volta.
2. Sostituire `X-API-Key` nei propri script/n8n; `?org=` è facoltativo (se c'è deve essere la propria organizzazione, altrimenti 403).
3. Togliere `EXPORT_API_KEY` dall'ambiente e riavviare.
Finché la si usa: vale solo con UNA organizzazione (con due o più → 401 `instance_key_multi_org`) e il log avvisa una volta per processo.

## Test
- Nuovi: `tests/unit/webhook-route.test.ts` (18), `tests/unit/export-routes-scoped.test.ts` (11: SQL reale registrato da un proxy Drizzle + guardrail strutturale), casi in `webhook.test.ts`, `dev-guard.test.ts`, `export-keys.test.ts`.
- Modificati: `webhook.test.ts` («senza segreto → passa» diventa «→ rifiuta»: è il cambio richiesto); mock di `@/lib/env` in `settings-whatsapp-routes.test.ts` (ora espone l'`isMockEnabled` reale).
- Golden: `tests/golden/env.ts` imposta un `META_APP_SECRET` sintetico (tutti i POST firmati come Meta); **snapshot invariati**, 94/94.
- **Prova pre-correzione:** i test nuovi sul `src/` di `origin/main` → **32 falliti** su 72.

## Sabotaggi (applicati uno a uno, almeno un test rosso, ripristinati)

| # | Sabotaggio | Esito |
|---|---|---|
| S1 | primitiva senza segreto → `true` (comportamento vecchio) | rosso (1) |
| S2 | `checkSignature` ignora il gate | rosso (1) |
| S3 | gate sempre aperto | rosso (12) |
| S4 | gate = solo `NODE_ENV !== production` (ignora `WA_MOCK_ENABLED`) | rosso (3) |
| S5 | GET senza controllo del segreto | rosso (1) |
| S6 | POST senza controllo della firma | rosso (5) |
| S7 | log senza limite per minuto | rosso (1) |
| S8 | log con il token della URL | rosso (1) |
| S9 | `signatureRequired` sempre false | rosso (2) |
| S10 | `/api/settings/webhook` con `withAuth` | rosso (8) |
| S11 | JOIN di contact non filtrato per organizzazione (conversations) | rosso (2) |
| S12 | WHERE di leads con `eq` sciolto | rosso (1) |
| S13 | JOIN di tag non filtrato per organizzazione (contacts) | rosso (2) |
| S14 | nessun avviso di transizione | rosso (1) |
| S15 | avviso con il valore della chiave | rosso (1) |
| S16 | chiave d'istanza valida con più organizzazioni | rosso (1) |

## Prove

| Comando | Esito |
|---|---|
| `pnpm typecheck` · `pnpm lint` · `pnpm build` | ok |
| `pnpm test` | 67 file, 1036 test verdi (baseline 65/993) |
| `pnpm test:golden` (PostgreSQL 16 locale) | 10 file, 94 verdi, snapshot invariati |
| `pnpm test:e2e` (`next dev` + mock + PostgreSQL locale, `.env` sintetico) | **104/104** (96 + 8 della nuova sezione «seguridad») |
| Smoke `next start` (produzione) senza segreto | POST 503, handshake 503, token falso 404, mock 404, avviso `[boot]` e `[webhook]` nel log, token mai nel log |
| Smoke `next start` con segreto | senza firma 401, firmata col token 401, firmata col segreto 200, handshake 200 |

## Non verificato
- Nessuna chiamata reale da Meta né da Wapi (solo firme HMAC calcolate localmente, identiche all'algoritmo di Meta/Wapi).
- Nessun deploy: il VPS di produzione non è stato toccato.
- La sezione 009 (Embedded Signup) dell'E2E resta SKIP (servono `META_APP_ID`/`META_ES_CONFIG_ID` reali).

## Decisioni per l'owner
1. **Modo agenzia** (override del callback): Meta firma con l'App Secret dell'app dell'agenzia, quindi ogni istanza cliente ora deve avere quel segreto. Prima era «lascialo vuoto». Se non è accettabile condividerlo, serve un'altra soluzione (es. un inoltro firmato con un segreto per istanza, come fa Wapi): non implementata.
2. **Wapi**: il segreto dell'endpoint configurato in Wapi deve coincidere con `META_APP_SECRET` del CRM, altrimenti tutto → 401.
3. La chiave d'istanza ereditata resta valida con una sola organizzazione (scelta di C2); toglierla del tutto è una decisione di prodotto.
