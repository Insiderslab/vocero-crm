# 016 — Modalità ascolto e lettura per Heili Core

> **Pacchetto 016** · branch `claude/ascolto-orbit` (base `origin/main` @ `c5c4d37`) · 2026-10-31.
> **Corsia: ciclo completo**, con la migrazione `drizzle/0020_modalita_ascolto.sql`.
> Progetto di riferimento: `heili-platform:docs/analisi/2026-10-31-ascolto-canali-e-strato-limbico.md`,
> §3.2 (requisiti del contratto CRM → Core v1) e §3.4 (stato dello spazio, invariante IA-1).
> Valgono le Leggi di Heili (`docs/LEGGI-AI-CODING.md`) e la costituzione (`.specify/memory/constitution.md`).

## Problema

Heili Core avrà una **fase di ascolto**: per 3–4 settimane legge le conversazioni tra un'azienda e i suoi
clienti finali e ne ricava conoscenza, **senza rispondere**. Durante questa fase il team dell'azienda
continua a rispondere come sempre, anche dalla Posta di Orbit. Sono proprio le sue risposte che Heili
studia.

Oggi Orbit non ha né un modo per **spegnere tutto ciò che invia da solo** né un modo per far **leggere al
Core** contatti, identità e messaggi in modo incrementale e affidabile:
- l'agente AI è acceso di default su ogni conversazione (`conversation.ai_enabled = true`);
- l'export C2 ha `since` solo sui messaggi;
- l'export dei contatti non contiene email, BSUID né identità di canale, e contiene note e scheda (`ficha`);
- l'export non segnala i contatti archiviati.

## Comportamento osservabile

### A. Modalità ascolto per organizzazione

1. Nuova tabella `listening_mode`, **una riga per organizzazione**, con:
   - `id` (`lsm_…`) e `organization_id` (UNIQUE, FK con cascade);
   - `enabled` (default `false`);
   - `enabled_at`, `enabled_by` (id utente) e `updated_at`.

   Nessuna riga equivale a `enabled = false`.
2. **Con la modalità ascolto accesa, Orbit non invia nulla da solo a un cliente finale.**

   | Via | Comportamento |
   |---|---|
   | Agente AI (`maybeRunAgentTurn`, `runAgentTurn`) | Il turno **non si pianifica**; un turno già pianificato, il secondo intento (`agent_retry_at`) o «Riprova» escono all'inizio di `runAgentTurn`: nessuna chiamata al modello né scrittura nel CRM. Il Laboratorio (`is_test`) prosegue |
   | Invio di testo con `aiGenerated: true` (`channels/core/send.ts`) | `SendError("listening_mode")`, nessuna chiamata al provider, nessun messaggio salvato. Difesa in profondità: copre un turno già pianificato prima dell'accensione |
   | Cervello esterno `/api/bot/*` | Ogni azione che parla con Meta (invio, «letto», «sta scrivendo») risponde **409 `listening_mode`** e non chiama Graph. Le letture restano possibili |
   | Automazioni (`automations/engine.ts`) | L'organizzazione si salta: nessun invio, conteggiata come saltata nelle statistiche del giro. Lo stato si rilegge prima di ogni invio: un'accensione a giro iniziato ferma il giro |
   | Invio di una **persona** dalla Posta (testo, allegato, posizione, contatti, modello, avvio di conversazione) | **Invariato**: le risposte del team sono permesse e sono il materiale dell'ascolto |
   | Ronda del team (012) | **Invariata**: i destinatari sono solo i numeri del team (007), mai clienti finali |

3. **Messaggio informativo GDPR:** Orbit non lo invia da solo. L'azienda lo imposta come messaggio di
   benvenuto della propria app WhatsApp Business (coexistence) oppure lo manda un operatore. Così l'invariante
   resta senza eccezioni nel codice.
4. Il codice HTTP di `listening_mode` è **409** in tutte le rotte che traducono `SendError`.
5. **Impostazioni → Modalità ascolto** (`/settings/listening`), solo owner e admin (`withAdminAuth`):
   - `GET /api/settings/listening` → `{ enabled, enabledAt }`;
   - `PUT /api/settings/listening` con `{ enabled: boolean }` (Zod, nient'altro accettato). Salva
     `enabled_by` dall'utente della sessione;
   - pagina con un interruttore e una spiegazione in es, en e it.

   Testo in it: «Modalità ascolto: Heili legge le conversazioni e impara, ma non risponde. Agente AI,
   automazioni e cervello esterno sono fermi. Le risposte scritte dal tuo team funzionano come sempre.»
6. **Posta:** quando la modalità è accesa, una striscia informativa in alto dice «Modalità ascolto attiva:
   l'agente AI e le automazioni non inviano messaggi».

### B. Lettura per Heili Core: `/api/export/core/*`

È solo lettura, con la stessa chiave `vex_` per organizzazione (`withExport`). L'organizzazione sale
**sempre** dalla chiave, e ogni tabella letta passa da `scoped()`.

1. `GET /api/export/core/state` restituisce:
   ```json
   { "schema": "orbit.core-feed/v1", "organizationId": "...", "organizationSlug": "...",
     "listening": { "enabled": true, "enabledAt": "..." }, "serverTime": "..." }
   ```
   Il Core lo legge **a ogni pull**: se l'organizzazione non è quella attesa per lo spazio, o se
   `listening.enabled` è falso mentre lo spazio è in ascolto, si ferma.
2. `GET /api/export/core/contacts?after=<cursore>&limit=<1..1000, default 500>`
   - Ordine e cursore su `(changed_at, id)`, dove `changed_at = greatest(contact.updated_at,
     contact.archived_at, max(contact_identity.created_at del contatto))`. Un'identità aggiunta dopo fa
     ricomparire il contatto.
   - **Campi:** `id`, `name`, `phone`, `waIdentity`, `waUserId`, `email`, `source`, `identities` (lista di
     `{ channel, externalId, channelAccountId }`), `createdAt`, `updatedAt`, `changedAt`.
   - **Mai** `notes`, `ficha`, tag o dati della trattativa (minimizzazione).
   - **Contatto archiviato:** `{ id, deleted: true, changedAt }` e nient'altro. È il segnale di
     cancellazione per il Core.
3. `GET /api/export/core/conversations?after=&limit=`
   - Cursore su `(updated_at, id)`; escluse le conversazioni del Laboratorio (`is_test`) e quelle di un contatto archiviato.
   - **Campi:** `id`, `contactId`, `channel` (quello della cuenta; `whatsapp` se non c'è),
     `channelAccountId`, `aiEnabled`, `lastInboundAt`, `createdAt`, `updatedAt`.
4. `GET /api/export/core/messages?after=&limit=`
   - Cursore su `(created_at, id)`. `created_at` è l'ora di inserimento in Orbit, non l'ora di WhatsApp:
     un messaggio arrivato in ritardo ha comunque un `created_at` nuovo.
   - Il consumatore rilegge **tutte e tre le liste** con una sovrapposizione di 5 minuti e deduplica per
     `id`. Copre le transazioni che finiscono in ordine diverso; il contratto lo dice.
   - Esclude `is_test` e i messaggi di un contatto archiviato.
   - **Campi:** `id`, `conversationId`, `contactId`, `channel`, `direction`, `origin`, `aiGenerated`,
     `type`, `text`, `waTimestamp`, `createdAt`, `hasMedia` (booleano, nessun file né URL).
5. **Risposta delle liste:**
   ```json
   { "schema": "orbit.core-feed/v1", "organizationId": "...", "listening": true,
     "items": [ ... ], "nextCursor": "<opaco>" | null }
   ```
   - Il cursore è opaco, base64url di `<ISO>|<id>` con l'ISO in microsecondi. Uno malformato, con una
     data impossibile (anno 0, 31 febbraio) o con un id non valido → **422 `invalid_cursor`**, senza
     toccare il database.
   - `limit` fuori dai limiti → 422.
6. Le rotte esistenti `/api/export/{contacts,conversations,leads,messages}` **non cambiano**: le usano
   n8n e gli script di analisi.

## Test richiesti (prima i negativi)

- **Isolamento:**
  - il test strutturale e quello sul proxy di Drizzle di `export-routes-scoped.test.ts` si estendono alle
    4 rotte nuove: ogni tabella del FROM/JOIN è filtrata per l'organizzazione della chiave;
  - la chiave di B non legge A.
- **Minimizzazione:** nessuna risposta contiene `notes`, `ficha` o tag (test sulla forma dell'oggetto).
- **Laboratorio:** `is_test` escluso da conversazioni e messaggi.
- **Cursore:** malformato → 422; due pagine consecutive non ripetono e non perdono elementi a parità di
  `created_at` (test sulla costruzione della condizione keyset).
- **Modalità ascolto**, ciascuno con un sabotaggio annotato nel registro (si toglie la guardia e il test
  deve fallire):
  1. turno dell'agente non pianificato;
  2. `sendText` con `aiGenerated` → `listening_mode`, adattatore mai chiamato;
  3. `/api/bot/messages` → 409, Graph mai chiamato;
  4. automazioni → nessun `sendTemplate` per l'organizzazione in ascolto, sì per un'altra;
  5. invio di un operatore → permesso;
  6. `PUT /api/settings/listening` da un `member` → 403; corpo con campi in più → 422.
- `pnpm typecheck && pnpm lint && pnpm build && pnpm test` tutti verdi; `pnpm db:generate` produce la sola
  migrazione 0020.
- E2E: se l'ambiente consente l'app con i mock (`tests/e2e/`), uno scenario «accendo l'ascolto → arriva un
  messaggio → l'agente non risponde → l'operatore risponde dalla Posta». Se non si può, il registro dice
  perché.

## Perimetro dei file

- **Schema e migrazione:** `src/lib/db/schema.ts` (tabella `listening_mode`), `src/lib/db/ids.ts`
  (prefisso `lsm`), `drizzle/0020_*.sql` e `drizzle/meta/*`.
- **Logica:** `src/server/listening/mode.ts` (nuovo, unica fonte della regola), `src/server/ai/trigger.ts`,
  `src/server/channels/core/send.ts`, `src/server/channels/errors.ts` (codice `listening_mode`),
  `src/server/automations/engine.ts`.
- **Rotte:** `src/app/api/bot/*` (solo le rotte che chiamano Meta), le rotte che mappano `SendError`,
  `src/app/api/settings/listening/route.ts`, `src/app/api/export/core/**`.
- **Interfaccia:** `src/app/(app)/settings/listening/page.tsx` + componente, la voce nel menu delle
  impostazioni, la striscia nella Posta, `src/lib/i18n/messages/*`.
- **Test:** `tests/unit/listening-*.test.ts`, `tests/unit/export-core-*.test.ts`,
  `tests/unit/export-routes-scoped.test.ts`.
- **Registro:** `docs/lavoro/2026-10-31-modalita-ascolto.md`.

## Fuori perimetro

- Telefono in E.164: lo normalizza il Core in lettura. Cambiare `wa_identity` romperebbe l'identità dei
  contatti esistenti.
- Unione dei contatti (T036).
- Instagram e Messenger (M3).
- Spedizione automatica dell'informativa.
- Webhook in uscita verso il Core: il modello resta il pull.
