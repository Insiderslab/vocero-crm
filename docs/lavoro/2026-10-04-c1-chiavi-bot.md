# Registro di lavoro — 2026-10-04 — C1 · Chiavi bot per organizzazione

**Pacchetto:** C1 del mandato `docs/mandati/MANDATO-CODEX-CRM-2026-10-02.md` (problema P3 dell'audit del 1/10). **Esecutore:** Claude (sessione cloud). **Security-critical:** sì, richiede revisione indipendente prima del merge.

## Problema
`resolveInstanceOrg()` prendeva la prima organizzazione con `limit(1)` senza ordinamento e la teneva in cache. Con più organizzazioni, le 8 route `/api/bot/*` operavano su un'organizzazione arbitraria con l'unica `BOT_API_KEY` dell'istanza.

## Cosa cambia
- Nuova tabella `bot_api_key` (migrazione `drizzle/0009_green_killmonger.sql`, generata da drizzle-kit; il nome non è stato cambiato). Contiene: hash SHA-256 della chiave, prefisso visibile, etichetta, autore, `last_used_at`, `revoked_at`.
- `authenticateBot()` (`src/server/bot/auth.ts`):
  - **Chiave `vbk_…`:** l'organizzazione è quella della chiave. Una chiave revocata o sconosciuta riceve 401.
  - **Chiave d'istanza `BOT_API_KEY`:** è valida solo se esiste esattamente una organizzazione. Con più di una risponde 401 `instance_key_multi_org`; con nessuna 409 `no_org`. Niente più cache.
- Le 8 route del bot usano `authenticateBot`. `resolveInstanceOrg` è stata rimossa.
- Gestione delle chiavi, riservata a owner e admin:
  - `GET/POST /api/settings/bot-keys`: la chiave in chiaro viene restituita una sola volta, con `no-store`.
  - `DELETE /api/settings/bot-keys/:id`: revoca. Una chiave di un'altra organizzazione dà 404.
- `.env.example`: documentato il limite della chiave d'istanza.

## Prove
| Comando | Esito |
|---|---|
| `pnpm typecheck` | ok |
| `pnpm lint` | ok |
| `pnpm test` | 38 file, 282 test passati (baseline 268 + 14 nuovi) |
| `pnpm build` | ok |

**Test nuovi:**
- `tests/unit/bot-keys.test.ts` (10): la chiave di A risolve solo A, quella di B solo B; chiave revocata o inventata → 401; con più organizzazioni la chiave d'istanza è rifiutata; un errore in `touchKey` non blocca la richiesta.
- `tests/unit/bot-keys-routes.test.ts` (4): un member riceve 403 su elenco, creazione e revoca; la chiave nasce nell'organizzazione della sessione e il testo in chiaro non viene salvato; revocare la chiave di un'altra organizzazione dà 404 senza scritture.

**Sabotage test:** con il controllo multi-organizzazione disattivato e la ricerca della chiave forzata, 3 test sono diventati rossi (revocata, inventata, multi-organizzazione). Ripristinate le guardie, tornano verdi.

## Non verificato
- La migrazione non è stata applicata a un PostgreSQL reale (i test unitari usano dati simulati).
- Nessuna interfaccia nel pannello: per ora la gestione delle chiavi è solo via API.
- Da verificare con l'owner quante organizzazioni ci sono in produzione: se più di una, i bot esterni che usano `BOT_API_KEY` riceveranno 401 dopo il rilascio e servirà una chiave `vbk_` per ciascuna organizzazione (**passo di migrazione operativo**).
- Il rate limit resta in memoria del processo, come prima.
