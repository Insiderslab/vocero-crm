# Mandato Codex — CRM Heili Orbit (vocero-crm) · 2 ottobre 2026

**Orchestratore:** GPT Sol (`gpt-5.6-sol`). **Esecutori:** GPT Luna (`gpt-5.6-luna`). Il mandato completo, con ruoli, regole, revisione e formato dei report, è in `Insiderslab/heili-platform`: `docs/mandati/PROMPT-CODEX-ORCHESTRATORE-SOL-2026-10-02.txt`. Questo file contiene solo i pacchetti del CRM (C1–C6). In caso di conflitto vale il mandato principale.

**Da leggere prima:**
- `CLAUDE.md` di questo repo: stack, mappa del codice e confini.
- Nel repo `heili-platform`:
  - `docs/audit/2026-10-01-stato-reale-e-architettura.md`, §5 (P3, P7) e §6.2 R8;
  - `docs/principio-autoriciclo.md`.

**Principio guida.** Il CRM diventa il **modulo `crm-orbit`** di Heili. Le personalizzazioni per cliente stanno nella configurazione, mai nel codice. Il CRM alimenta la memoria comune (Brain) attraverso un contratto dichiarato. Non legge né scrive le tabelle di altri moduli.

## Fatti verificati il 1/10 (origine dei pacchetti)

| Problema | Evidenza | Conseguenza |
|---|---|---|
| La Bot API sceglie un'organizzazione qualsiasi | `src/server/bot/auth.ts:39-46`: `resolveInstanceOrg()` legge la prima organizzazione con `limit(1)` **senza ordinamento** e la tiene in cache. `BOT_API_KEY` è unica per l'istanza (`auth.ts:16-30`). Superficie: `src/app/api/bot/{context,ficha,handoff,media,messages,profile,reset,typing}` | Con più organizzazioni, un bot può leggere, scrivere e inviare messaggi sui contatti di un altro cliente |
| Una chiave legge l'export di qualsiasi organizzazione | `src/server/export/auth.ts`: `EXPORT_API_KEY` unica, con `?org=` scelto da chi chiama | Fuga di dati tra organizzazioni |
| Una chiave Wapi unica per tutte le organizzazioni | `src/lib/meta/client.ts:23-37`, `src/lib/env.ts:25-35` (`WAPI_API_KEY`, `WAPI_ORG_IDS`) | Tutte le organizzazioni del CRM confluiscono in un'unica organizzazione Wapi |
| Dominio Wapi incoerente | `.env.example:51` usa `wapi.heili.cloud`, ma il record DNS esiste solo per `whapi.heili.cloud` | Configurazione errata |
| Rate limit solo in memoria | `src/lib/rate-limit.ts` | Non regge più processi o riavvii |

> **Gravità reale:** dipende da quante organizzazioni sono attive in produzione, dato **non verificato**. Il codice va corretto comunque, perché il CRM è già multi-organizzazione (commit `38bdc65`).

## Pacchetti

### C1 · Bot API per organizzazione — SECURITY-CRITICAL (onda 1)
**Cosa fare.**
- Chiavi bot **per organizzazione**: tabella con hash della chiave, `organization_id`, etichetta, `created_at`, `revoked_at`. Stesso stile di prefissi nanoid e Zod del repo.
- La route ricava l'organizzazione **dalla chiave**, mai da una scelta implicita.
- `resolveInstanceOrg()` resta solo per l'installazione con una sola organizzazione. Se le organizzazioni sono più di una e si usa la vecchia chiave d'istanza, la risposta è **sempre** 401 con un errore esplicito.
- Gestione delle chiavi dal pannello admin, riservata a owner/admin dell'organizzazione. La chiave si mostra una sola volta.

**Perimetro.** `src/server/bot/**`, `src/app/api/bot/**`, una migrazione Drizzle nuova, i test relativi, la pagina admin delle chiavi.

**Accettazione.**
- Test negativi: la chiave dell'organizzazione A non vede né modifica i contatti di B in nessuna delle 8 route.
- Una chiave revocata viene rifiutata.
- Con più organizzazioni la chiave d'istanza viene rifiutata.
- Sabotage test documentati.

### C2 · Export per organizzazione — SECURITY-CRITICAL (onda 2)
**Cosa fare.**
- Chiavi di export per organizzazione, con lo stesso modello di C1, riusando il codice di C1 e senza duplicarlo.
- Se c'è, `?org=` deve coincidere con l'organizzazione della chiave.

**Perimetro.** `src/server/export/**`, `src/app/api/export/**` (o la route attuale), i test relativi.

**Accettazione.** Test negativi di accesso incrociato tra organizzazioni.

### C3 · Credenziali Wapi per organizzazione — SECURITY-CRITICAL (onda 2)
**Cosa fare.**
- Chiave Wapi salvata **per organizzazione e cifrata**, con lo stesso meccanismo di `metaCredentials.token_cipher` e `src/lib/crypto`.
- `resolveGraphTransport` usa la chiave dell'organizzazione della conversazione.
- `WAPI_API_KEY` globale resta solo come compatibilità per l'installazione mono-organizzazione, con avviso nei log all'avvio.
- Correggere il dominio in `.env.example` e nella documentazione (`whapi.heili.cloud`).

**Accettazione.**
- Test: due organizzazioni usano due chiavi diverse.
- Senza una chiave dell'organizzazione non si ricade su quella di un'altra.

### C4 · Igiene del fork (onda 2, non security-critical)
**Cosa fare.**
- README: badge e link che oggi puntano all'upstream `kevinrivm`. Mantieni l'attribuzione MIT e il file `LICENSE` invariato.
- Elenco dei branch residui dell'upstream e di `feat/wapi-adapter`, che duplica l'adapter già su `main`, da proporre all'owner per l'archiviazione. **Non cancellare branch.**

### C5 · Il CRM alimenta il Brain (onda 3)
**Cosa fare.**
- Manifest `heili.module.v1` del modulo `crm-orbit`, secondo il contratto definito dal pacchetto B3 nel repo `heili-platform`.
- Endpoint di sola lettura per organizzazione (chiave di C2): contatti, lead, fasi e conversazioni modificati da un cursore temporale, con `updated_at` e cancellazioni (tombstone).
- Consenso esplicito per organizzazione prima di qualsiasi esposizione al Brain.
- Il connettore `orbit` lato Brain lo costruisce l'esecutore del pacchetto Brain corrispondente: qui solo il contratto e l'endpoint.

**Accettazione.**
- Test di paginazione con cursore, tombstone e rifiuto senza consenso.
- Nessun campo di credenziale nelle risposte.

### C6 · Identità comune (onda 4, prima solo progetto)
**Cosa fare.**
- Documento e prototipo: login OIDC dello stesso IdP di Heili (oggi Auth0) dentro Better Auth, con mapping esplicito `(iss, sub)` verso l'utente e un'organizzazione CRM collegata a un workspace Heili.
- Nessuna attivazione in produzione.

**Prima di scrivere codice** porta il piano all'orchestratore e all'owner.

## Validazione
```
pnpm install --frozen-lockfile
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```
- La CI della PR (`.github/workflows/ci.yml`) deve essere verde. Al 1/10 GitHub non registra esecuzioni CI per questo repo: se le Actions non partono, segnalalo all'orchestratore e non dichiarare verde.
- Branch: `codex/c<n>-<slug>`. PR in bozza. **Nessun merge su `main`** senza l'approvazione dell'owner.

## Fuori perimetro
- VPS, container, DNS, Meta, Auth0 e qualunque servizio di produzione.
- Dati reali e `.env`.
- Dipendenze nuove.
- Il repo `wapi`: le modifiche lì richiedono un mandato separato.
