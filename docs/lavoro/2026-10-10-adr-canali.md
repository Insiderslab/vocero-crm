# Registro di lavoro — 2026-10-10 — M1.1: ADR e specifica del livello canali

**Mandato:** piano CRM multicanale, pacchetto M1.1 (`docs/piani/PIANO-CRM-MULTICANALE.md` §3).
**Esecutore:** Claude (Opus 5.5).
**Branch locale:** `notte/adr-canali`, creato da `origin/claude/keen-ptolemy-l0kv8g` @ `810272a`.
**Tipo:** solo documenti.
**Vincoli rispettati:** nessun push, nessuna PR, nessuna chiamata a Meta o a Wapi, nessun dato reale letto.
**Stato dell'ADR:** **Proposto**. L'owner deve approvarlo (D1) prima di M1.2.

## Ripresa

Il worktree esisteva già (ripresa dopo il riavvio del container). C'erano due bozze non committate:
- `docs/adr/0001-livello-canali.md`, 561 righe, con le parti (a)–(g) e rischi/decisioni;
- `specs/005-livello-canali/spec.md`, 164 righe.

Mancavano `plan.md` e `tasks.md`. Le bozze sono state rilette, verificate a campione contro il codice (righe di `schema.ts`, della route del webhook, di `send.ts`, di `ingest.ts`, di `heili-dm`) e **completate**, non riscritte.

## Cosa è stato fatto

**ADR `docs/adr/0001-livello-canali.md`**
- **(b)** `wapi_credentials` di C3 (letta con `git show notte/c3-wapi`, `6146791`): decisa come credenziale di *trasporto* dell'organizzazione, non account di canale. In M1 non si migra.
  - Nuova guardia richiesta: trasporto deciso **per canale**, perché senza di essa una chiamata Instagram andrebbe a Wapi con la chiave del gateway.
  - Sesta verifica del backfill: `wapi_credentials` invariata.
- **(d)** Riepilogo dell'inventario aggiornato: `wapi_credentials`; moduli `inbox`/`whatsapp`/`ai` con 28 file importatori in `src/` e 12 file di test.
- **(h)** §3.8 nuovo, ordine di lavoro corretto con Meta: sviluppo in modalità sviluppo, prova reale, video, poi App Review.
  - Verifica sui documenti di heili-dm: «Dm Heili» è *Live* ma con solo accesso **Standard**, e **nessuna review fatta** (`heili-dm/PROGETTO-STATO.md:25`, `:67`, `:69`, `:81`; `docs/setup.md:202-218`; `GUIDA-OPERATIVA.md:116`; `MIGLIORIE-ROADMAP.md:55`; `META_APP_REVIEW.md` contiene solo bozze).
  - Vincolo di un solo URL di callback per oggetto e per app: il CRM non può ricevere i webhook Instagram dell'app di heili-dm.
- **(i)** §3.9 nuovo, validazione con due canali reali in M1: pacchetto **M1.6**, adattatore Instagram in modalità sviluppo, spento in produzione.
  - Criteri «astrazione validata»: suite di contratto, nucleo non toccato, test negativi, guardia del trasporto, prova reale dell'owner o dichiarazione che non è stata fatta.
  - **Vincolo di schema:** `wa_identity DROP NOT NULL` per i contatti solo-Instagram prima di R3, con il passo di rollback relativo.
- **(j)** Sezione rischi e decisioni rinumerata. D2 ora vale prima di M1.6. D6 precisato: l'unione dei contatti fino a R3 ha un limite. Nuove decisioni D13–D17 e 5 rischi nuovi.

**Spec `specs/005-livello-canali/spec.md`**
- Storia 6 (secondo canale reale, 7 scenari).
- FR-015…FR-020, SC-007 e SC-008.
- Casi limite per C3 e per i contatti senza identità WhatsApp; fuori ambito e supposti aggiornati.

**Piano `specs/005-livello-canali/plan.md`** (nuovo)
- Contesto tecnico e Constitution Check: II e VIII non conformi per M1.6, giustificati nel tracciamento della complessità.
- Struttura proposta del codice.
- **Inventario esatto file:riga** (§5.1–5.11):
  - `wa_identity`: 20 righe di codice in 8 file;
  - `wa_message_id`: 23 righe in 7 file, più mock e script E2E;
  - `meta_credentials`: 6 funzioni, 11 file chiamanti;
  - `wapi_credentials` (C3);
  - `/api/webhooks/wa`;
  - export e importatori di `src/server/inbox/*`, `src/server/whatsapp/*`, `src/server/ai/*`;
  - 17 punti di scrittura per la doppia scrittura;
  - consumatori della finestra e sandbox.
- Comandi per rigenerare l'inventario; sequenza delle migrazioni; elenco dei golden per file; sabotaggi; D-CI.

**Compiti `specs/005-livello-canali/tasks.md`** (nuovo): T001–T057 per fase (M1.2 → M1.6, poi R3), con test negativi e sabotaggi per ogni guardia nuova.

## Controlli prima del commit

| Comando | Esito |
|---|---|
| `pnpm install --frozen-lockfile` | ok (lockfile invariato) |
| `pnpm typecheck` | verde |
| `pnpm lint` | verde |
| `pnpm test` | 45 file, 349 test verdi |
| `pnpm build` | verde |
| `pnpm db:generate` | non eseguito: nessuno schema cambiato (solo documenti) |

**Test negativi e di sabotaggio:** nessuno in questo pacchetto, perché non aggiunge codice né guardie. Sono **specificati** per i pacchetti successivi: `plan.md` §7.1–7.4 e `tasks.md` T007, T009–T011, T021, T032, T034, T037, T043–T044, T051.

## Non verificato

- **Stato attuale dell'app «Dm Heili» nella console Meta.** Ho letto solo i documenti di heili-dm, al 31/08 e al 05/10. Una richiesta di review fatta dopo non risulterebbe. L'owner controlla (D14).
- **Vincoli Meta citati a memoria e non riconfermati qui** (nessun accesso a Meta né al web, per mandato), da riconfermare in K0:
  - un solo callback per oggetto webhook e per app;
  - esistenza e comportamento delle «app di test» derivate;
  - capacità di Instagram e Messenger (finestra, lunghezza del testo, tag);
  - nomi dei permessi Messenger.
- **Numeri di riga:** esatti su `810272a` e su `6146791` (C3) al momento della scrittura, ricavati con `grep` e controllati a campione con `sed`. Cambiano a ogni commit: `plan.md` §5.12 dà i comandi per rigenerarli.
- **Rollback di R1 con il migratore Drizzle** (immagine vecchia su DB con migrazione più recente): non provato. È un compito di M1.2 (T020).
- **Durata della migrazione ed `EXPLAIN`:** non misurati (M1.2).
- **ID deterministici del backfill:** `md5` troncato a 20 caratteri; collisioni teoricamente possibili, non calcolate. Da valutare in M1.2.

## Falle e segnalazioni (Legge Zero, inazione)

1. **Già segnalate dal registro C3, ancora presenti su `810272a`:**
   - `src/app/api/settings/whatsapp/route.ts:34` (`PUT`) non controlla il ruolo: un `member` può sostituire numero e token Meta;
   - `src/app/api/settings/webhook/route.ts:7-16` restituisce a qualunque ruolo l'URL con il segreto `META_WEBHOOK_VERIFY_TOKEN` e lo stesso valore in `verifyToken`. Senza `META_APP_SECRET` chi lo conosce può iniettare eventi.

   Con il livello canali (ADR §3.5) gli URL per canale riusano lo stesso segreto per i canali Meta. La pagina «Canali» (K1) deve mostrarli solo a owner e admin. Non corretto qui: fuori perimetro.
2. `message.wa_message_id` è univoco **sull'istanza** (`src/lib/db/schema.ts:349`) e l'ingesta fa `onConflictDoNothing` su quella colonna (`src/server/inbox/ingest.ts:307`, `:395`). Lo stesso `wamid` in due organizzazioni farebbe scartare in silenzio il messaggio della seconda. Improbabile con Meta, non verificato. Chiuso in R3 dall'indice per organizzazione (ADR §3.2).
3. Codice morto: `getOrCreateContact` (`src/server/inbox/ingest.ts:149-161`) non ha chiamanti. Da rimuovere con un `refactor:` dedicato (T057).
4. **Correzione al piano** (D15): `PIANO-CRM-MULTICANALE.md` mette M3 e K3/K4 «dopo l'App Review», ma la review richiede la funzione già funzionante. Non ho modificato il piano: un altro pacchetto (`notte/app-review`) lavora in parallelo sui materiali della review. Va corretto dopo l'approvazione dell'ADR.

## Decisioni per l'owner (dettaglio in ADR §6)

- **D1:** approvare l'ADR.
- **D2:** emendare la costituzione prima del merge di M1.6.
- **D13:** aggiungere M1.6 a M1. Cambia la visione, che dice «WhatsApp come unico adattatore» in M1.
- **D14:** quale app Meta per il CRM (proposta: un'app propria) e controllo nella console dello stato di review di «Dm Heili».
- **D15:** correggere l'ordine nel piano.
- **D16:** chi fa la prova reale con Meta e su quale ambiente.
- **D17:** Instagram spento in produzione fino a R3.
- Restano aperte D3–D12 della bozza.
