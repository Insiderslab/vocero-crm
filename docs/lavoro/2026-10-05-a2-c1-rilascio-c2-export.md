# Registro di lavoro — 2026-10-05 — A2 · Rilascio C1 e C2 (chiavi di export per organizzazione)

**Mandato:** sciame del 5/10/2026, pacchetto A2 (`vocero-crm`); C2 del mandato `docs/mandati/MANDATO-CODEX-CRM-2026-10-02.md`. **Esecutore:** Claude. **Branch:** `claude/keen-ptolemy-l0kv8g` (nessun push). **Security-critical:** sì, serve revisione indipendente prima del merge.

Controllo preliminare: `git fetch` + `git branch -r | grep -i codex` → nessun branch `origin/codex/*` in questo repo, quindi nessun lavoro Codex da rivedere al posto di questo.

## 1. Procedura di rilascio C1
`docs/ops/rilascio-c1.md`: backup con `pg_dump -Fc` e verifica del dump, rilascio con migrazione automatica all'avvio (`0009`, e `0010` se C2 è incluso), una chiave `vbk_` per InsidersLab e una per La Bambola tramite `POST /api/settings/bot-keys` (con l'organizzazione attiva giusta), aggiornamento del bot per organizzazione, verifica (incluso il `401 instance_key_multi_org` della vecchia chiave), rimozione di `BOT_API_KEY`, sezione C2 (`vex_`), revoca, rollback. Nessun segreto: solo segnaposto.

**Rilievo:** il registro C1 (4/10) dice "nessuna interfaccia nel pannello". Il mandato dello sciame chiede la creazione "dalla pagina impostazioni": quella pagina **non esiste**. La procedura usa quindi l'API dalla console del browser con la sessione owner/admin. Una pagina vera è lavoro da fare (vedi prompt Codex).

## 2. C2 — Chiavi di export per organizzazione

### Problema
`src/server/export/auth.ts` (prima): un'unica `EXPORT_API_KEY` d'istanza e `?org=<id|slug>` scelto da chi chiama → chi ha la chiave legge l'export di **qualsiasi** organizzazione.

### Cosa cambia
- **Una sola fonte (Legge §3.2):** nuovo `src/server/api-keys.ts` con la logica che prima stava in `src/server/bot/auth.ts`, parametrizzata per ambito (`bot` → `vbk_`, `BOT_API_KEY`, limite 600/min; `export` → `vex_`, `EXPORT_API_KEY`, limite 300/min). `src/server/bot/auth.ts` resta come facciata con gli stessi nomi esportati (le 8 route bot non cambiano).
- **Tabella:** la stessa `bot_api_key` (nome storico di C1) con nuova colonna `scope text not null default 'bot'`. Migrazione `drizzle/0010_warm_guardsmen.sql` generata con `pnpm db:generate` (con `DATABASE_URL` fittizia, senza leggere `.env`). Le righe C1 esistenti diventano `scope = 'bot'`.
- **Autenticazione:** `authenticateApiKey(req, scope)` accetta una chiave solo se il prefisso è quello dell'ambito **e** la riga ha lo stesso `scope`; revocata/sconosciuta → 401. Chiave d'istanza: solo con una organizzazione, come in C1.
- **Export:** `authenticateExport()` ricava l'organizzazione dalla chiave. `?org=` è facoltativo; se presente deve essere l'id o lo slug della stessa organizzazione, altrimenti `403 org_mismatch`. `withExport` non legge più `?org=` per scegliere i dati.
- **Gestione:** `src/server/api-keys-admin.ts` (una sola fonte) serve `/api/settings/bot-keys` (invariato nel comportamento) e il nuovo `/api/settings/export-keys` (+ `/[id]` per la revoca). Elenco, creazione e revoca sono filtrati per organizzazione della sessione **e** per ambito; solo owner/admin; chiave in chiaro una volta sola con `no-store`.
- `.env.example`: documentato il nuovo comportamento di `EXPORT_API_KEY`.

Righe: route `bot-keys` da 107 a 14; `bot/auth.ts` da 131 a 42; la logica comune (`api-keys.ts` 156, `api-keys-admin.ts` 122) serve entrambi gli ambiti invece di essere copiata per l'export.

### Prove
| Comando | Esito |
|---|---|
| `pnpm typecheck` | ok |
| `pnpm lint` | ok |
| `pnpm test` | 40 file, 302 test passati (baseline 38 file / 282; +20 nuovi) |
| `pnpm build` | ok (route `/api/settings/export-keys` e `/[id]` presenti) |

**Test nuovi:**
- `tests/unit/export-keys.test.ts` (15): chiave di A → solo org A, di B → solo org B; chiave A con `?org=` di B (id e slug) → 403; revocata e inventata → 401; `vbk_` su export → 401 e `vex_` su bot → 401; riga con ambito diverso dal prefisso → 401; `EXPORT_API_KEY` con 1 organizzazione → quella, con 2 → 401 `instance_key_multi_org` anche con `?org=`; `BOT_API_KEY` non vale per export; `withExport` passa all'handler solo l'organizzazione della chiave e con `?org=` altrui non esegue l'handler.
- `tests/unit/export-keys-routes.test.ts` (5): member → 403; la chiave nasce `vex_`, `scope = export`, nell'organizzazione della sessione, testo in chiaro non salvato; elenco e revoca filtrano per organizzazione **e** ambito (SQL controllato con `PgDialect`); revoca di chiave altrui/altro ambito → 404 senza scritture.
- Modifiche a test esistenti: il doppio di `bot-keys.test.ts` restituisce anche `scope: "bot"` (campo nuovo, necessario; senza, il codice nega: fail-closed); `bot-keys-routes.test.ts` verifica in più che la chiave nasca con `scope = bot`. Nessun test indebolito.

**Sabotage test** (eseguiti, poi ripristinati; ogni riga ha fatto fallire i test indicati):
| Sabotaggio | Test rossi |
|---|---|
| `api-keys.ts`: tolto `key.scope !== scope` | 1 (riga con ambito diverso) |
| `export/auth.ts`: tolto il controllo `org_mismatch` | 3 |
| `api-keys.ts`: soglia multi-organizzazione disattivata | 2 (bot ed export) |
| `api-keys-admin.ts`: elenco senza filtro di ambito | 1 |
| `api-keys-admin.ts`: insert senza `scope` | 2 (bot ed export) |
| `export/handler.ts`: `withExport` senza autenticazione | 1 |

## Non verificato
- Nessuna migrazione (`0009`, `0010`) applicata a un PostgreSQL reale; i test usano doppi senza database.
- La procedura `docs/ops/rilascio-c1.md` non è stata eseguita (produzione fuori perimetro).
- Le query delle 4 route `/api/export/*` filtrano per `org.id` (controllato con grep), ma non c'è un test d'integrazione su database reale che lo dimostri.
- Rate limit ancora in memoria del processo e comune a tutte le chiavi dello stesso ambito (non per chiave/organizzazione): un'organizzazione può esaurire il limite dell'altra. Era così anche prima.
- Nessuna pagina nel pannello per le chiavi (bot ed export).
- La CI su GitHub non è stata eseguita (nessun push).
- Effetto sui consumatori reali di `EXPORT_API_KEY` sconosciuto: con 2 organizzazioni ricevono 401 dopo il rilascio finché non usano una chiave `vex_` (passo 7 della procedura).
