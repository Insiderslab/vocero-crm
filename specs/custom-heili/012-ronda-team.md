# Fase 12 — «Ronda delle 8:00» al team

> Personalizzazione sul fork distribuito in crm.heili.cloud.
> **Stato: ✅ IMPLEMENTATA** (2026-10-13), branch locale `team-broadcast`
> (base `origin/main` @ `30ccd1b`).
> **Carril: COMPLETO** — nuova migrazione `drizzle/0016_*.sql` (tabella
> `team_broadcast`) e nuovo contratto pubblicato `POST /api/bot/team-broadcast`.
> Come per la 007, piano e compiti stanno in questo stesso file (sezioni
> «Piano» e «Prove»): il contratto è piccolo e la spec resta l'unica fonte.
> Registro: `docs/lavoro/2026-10-13-ronda-team.md`.

## Problema

L'organizzazione interna «InsidersLab · Interno» usa il numero WhatsApp come
assistente del team (007: `restrict_to_allowlist` + `allowed_identities`).
Ogni mattina qualcuno deve dire a ogni persona del team le sue 3 priorità del
giorno. Le priorità vivono su Monday, ma il CRM **non** può parlare con Monday
(Costituzione II: nessun servizio esterno nuovo a runtime). Le calcola quindi
un generatore esterno (n8n, oppure un'attività pianificata di Claude con
accesso a Monday) che le consegna al CRM; il CRM le invia dal numero
dell'organizzazione.

Di mattina la finestra di 24 h con i colleghi è quasi sempre chiusa: serve un
**modello (template) Utility approvato da Meta**.

## Constitution Check

- **I (sicurezza)** ✔️ — autenticazione con chiave bot `vbk_` per
  organizzazione (solo hash SHA-256 a riposo). I log non contengono mai i
  parametri né i numeri completi (solo le ultime 3 cifre). La risposta e il
  registro della ronda mascherano i numeri allo stesso modo.
- **II (sovranità)** ✔️ — nessuna dipendenza nuova: il CRM parla solo con la
  WhatsApp Cloud API, come già fa. Monday e l'LLM che sceglie le priorità
  stanno nel generatore esterno, fuori dal CRM.
- **III (multi-tenancy)** ✔️ — l'organizzazione viene SOLO dalla chiave.
  Destinatari, modello, contatti, conversazioni, credenziali e registro sono
  letti/scritti con `organization_id` di quella chiave. Tabella nuova con
  `organization_id NOT NULL`, indici org-first.
- **IV (idempotenza)** ✔️ — `Idempotency-Key` obbligatoria; la stessa chiave
  entro 36 h restituisce il primo risultato e non invia nulla. Il claim è
  serializzato per organizzazione (advisory lock di transazione) e protetto da
  un indice UNIQUE `(organization_id, idempotency_key)`.
- **VIII (focus verticale)** ⚠️ giustificato — la costituzione esclude il
  «broadcast massivo». Questo NON lo è: i destinatari possono essere SOLO i
  numeri della lista del team (007), mai un contatto cliente; la lista deve
  essere attiva e non vuota; massimo 50 destinatari; massimo 3 ronde per ora
  per organizzazione. È comunicazione interna del negozio che usa l'istanza.
- **Doppia scrittura 005** ✔️ — i contatti nuovi nascono con
  `insertContactIfAbsent` (contatto + `contact_identity` nella stessa
  transazione): V1–V6 restano a 0.
- **Sandbox del Laboratorio** ✔️ — l'invio passa da `sendTemplate`, che
  rifiuta le conversazioni `is_test`; le conversazioni della ronda sono
  sempre reali (`getOrCreateConversation`).

## Storie

### US1 — Il generatore invia la ronda (P1)

`POST /api/bot/team-broadcast`, header `X-API-Key: vbk_…` e
`Idempotency-Key: <chiave>`.

```json
{
  "templateName": "ronda_mattutina",
  "language": "it",
  "params": ["team", "1) … · 2) … · 3) …"],
  "perRecipient": { "+393471110001": ["Marco", "1) … · 2) … · 3) …"] },
  "dryRun": false
}
```

**AC**
1. Autenticazione identica alle altre `/api/bot/*` (`authenticateBot`): 401
   senza chiave o con chiave revocata/di altro ambito. L'organizzazione è
   quella della chiave; il body non può sceglierla.
2. `Idempotency-Key` mancante o non valida (1–128 caratteri
   `[A-Za-z0-9._:-]`) → 400 `idempotency_key_required`.
3. Body con Zod **strict** (un campo sconosciuto → 422 `invalid_body`):
   - `templateName`: 1–512 caratteri;
   - `language`: codice tipo `it`, `es`, `es_MX`, `en_US`;
   - `params`: 1–10 stringhe;
   - `perRecipient` (facoltativo): mappa numero → 1–10 stringhe, massimo 50
     voci. La chiave si scrive come nella lista del team (`+39 347 …`; anche
     solo cifre) e si normalizza con la STESSA funzione (`allowlist.ts`). Una
     chiave non valida o due chiavi uguali dopo la normalizzazione → 422;
   - `dryRun` (facoltativo, booleano).
4. **Parametri su una riga**: Meta rifiuta nei parametri del corpo `\n`,
   `\t` e più di 4 spazi di fila. Decisione: si **normalizzano** (non si
   rifiutano): ogni sequenza di spazi bianchi (a capo, tab, spazi multipli)
   diventa UNO spazio, si tolgono gli altri caratteri di controllo e gli
   spazi agli estremi. Dopo la normalizzazione ogni parametro deve avere 1–1024
   caratteri, altrimenti 422 `invalid_body`.
5. **Destinatari**: SOLO `agent_profile.allowed_identities` dell'organizzazione,
   e SOLO se `restrict_to_allowlist = true` e la lista non è vuota.
   Altrimenti 409 `no_team_list`. Mai un altro contatto, nemmeno se nominato in
   `perRecipient` (le chiavi fuori lista si ignorano e si riportano mascherate
   in `unknownRecipients`). Più di 50 numeri in lista → 409 `team_too_large`.
6. **Modello**: deve esistere tra i modelli sincronizzati DELL'organizzazione
   con stesso nome e lingua (`template_not_found`), stato approvato
   (`template_not_approved`) e un numero di variabili del corpo uguale ai
   parametri ricevuti, sia `params` sia ogni voce di `perRecipient`
   (`template_params_mismatch`). Tutti 422.
7. Senza numero WhatsApp collegato → 409 `not_connected`; token scaduto →
   409 `reconnect_required`. Questi controlli avvengono PRIMA di consumare la
   chiave di idempotenza.
8. **Idempotenza**: la stessa `Idempotency-Key` entro 36 h restituisce il
   risultato registrato della prima volta con `replayed: true` e non invia
   nulla (anche se nel frattempo lista o modello sono cambiati). Una ronda con
   la stessa chiave ancora in corso → 409 `broadcast_in_progress`. Dopo 36 h
   la chiave torna libera.
9. **Limite**: al massimo 3 ronde (non `dryRun`) per organizzazione nell'ultima
   ora mobile. La quarta → 429 `rate_limited` con `Retry-After`. Una replica
   idempotente non conta.
10. Per ogni destinatario: si trova o si crea il contatto per identità
    normalizzata (come l'ingest: `getOrCreateContactByIdentity`; se si crea,
    contatto + `contact_identity` nella stessa transazione) senza riattivare
    un contatto archiviato; si apre/riusa la conversazione reale; si invia con
    `sendTemplate` (stesso percorso del composer e delle automazioni). Il
    messaggio resta in Posta come `type = template`, `origin = template`, con
    il corpo renderizzato, e la Posta lo vede in tempo reale (`message.new`).
11. Il modello si invia anche con la finestra di 24 h aperta (un modello è
    sempre ammesso; un messaggio identico per tutti). Diverso dalle
    automazioni, che saltano la finestra aperta per non spendere.
12. Esito per destinatario: `sent` (con `messageId`), `failed` (con il
    `error` = codice tipizzato: `meta_error`, `meta_unavailable`, …) oppure
    `skipped` (`reason`: `dry_run`, o `aborted` quando un errore
    dell'organizzazione — token scaduto, numero scollegato, chiave Wapi
    mancante — rende inutile continuare: si smette di chiamare Meta).
13. `perRecipient`: chi ha una voce usa i suoi parametri, gli altri `params`.
14. `dryRun: true`: stessi controlli (401/400/422/409), nessun invio, nessun
    contatto creato, nessuna riga registrata, non conta per il limite; ogni
    destinatario risulta `skipped` / `dry_run`.
15. Risposta 200:
    `{ broadcastId, replayed, dryRun, template: { name, language }, total,
    sent, failed, skipped, results: [{ recipient: "…001", status, … }],
    unknownRecipients }`. I numeri sono SEMPRE mascherati alle ultime 3 cifre.
16. Log: una riga di riepilogo (`[team-broadcast] org … sent/failed/skipped`)
    e una per ogni fallimento con numero mascherato e codice. Mai i
    parametri.
17. La rotta è nell'inventario dei ruoli
    (`tests/unit/helpers/route-roles.ts`) con la politica `bot-key`.

### US2 — Il proprietario vede l'ultima ronda (P2)

Nella pagina Agente IA, sezione «Accesso riservato», una riga di sola lettura:
«Ronda: ultima inviata il … a N persone (esito)», oppure «Ronda: ancora
nessuna». Nessuna impostazione nuova.

**AC**
1. `GET /api/agent/profile` aggiunge `restriction.lastBroadcast`
   (`{ at, status, total, sent, failed, skipped } | null`), solo per
   owner/admin come il resto di `restriction`. Ultima riga di
   `team_broadcast` della sessione (per organizzazione).
2. Esito: «tutti inviati», «N non inviati», «in corso». i18n es/en/it.

### US3 — Documentazione per il proprietario (P1)

`docs/ops/ronda-team.md` (italiano): modello Utility `ronda_mattutina`
(it, es) con il testo proposto, nota sulla possibile riclassificazione in
Marketing, come creare la chiave `vbk_` in Impostazioni, schema del flusso
n8n (07:55 Europe/Rome → Monday → LLM → HTTP con credenziale n8n e
`Idempotency-Key = ronda-YYYY-MM-DD`), l'alternativa con un'attività
pianificata di Claude, e `perRecipient` per personalizzare.

## Piano

- **Dati**: tabella `team_broadcast` (migrazione 0016, solo catalogo, `SET
  LOCAL lock_timeout = '5s'` come 0013–0015, snapshot concatenato a 0015):
  `id`, `organization_id` (FK cascade), `idempotency_key`, `template_name`,
  `language`, `status` (`running` | `done`), `total`, `sent`, `failed`,
  `skipped`, `result` (jsonb: la risposta già mascherata, per la replica),
  `created_at`, `finished_at`. UNIQUE `(organization_id, idempotency_key)`,
  indice `(organization_id, created_at)`. La stessa tabella serve
  idempotenza, limite orario e riga in pagina: niente parametri salvati (il
  testo inviato sta già nei messaggi).
- **Codice**:
  - `src/server/team-broadcast/validation.ts` — puro: schema Zod, normalizzazione
    dei parametri, chiave di idempotenza, chiavi di `perRecipient`, maschera.
  - `src/server/team-broadcast/service.ts` — controlli, claim (transazione con
    `pg_advisory_xact_lock` per organizzazione: pulizia della chiave scaduta,
    replica, limite, insert), invio sequenziale con pausa di 150 ms, chiusura
    della riga con il risultato.
  - `src/app/api/bot/team-broadcast/route.ts` — sottile: auth, header, body,
    servizio, mappatura degli errori in HTTP.
  - Ore e limiti calcolati con l'orologio dell'app (JS), non con `now()` del
    database: un solo orologio per scrivere e confrontare.
- **Interfaccia**: `agent-client.tsx`, riga sotto il titolo della sezione.

## Fuori ambito (e perché)

- Il CRM non chiama Monday né sceglie le priorità (Costituzione II).
- Nessuna pianificazione interna: il «quando» lo decide il generatore.
- Nessuna sostituzione automatica del nome in `{{1}}`: il nome lo manda il
  generatore in `perRecipient` (il CRM non sa come il team vuole essere
  chiamato).
- Nessun nuovo tentativo automatico dei falliti: una ronda è un evento; chi
  vuole ritentare manda una nuova chiave (e conta per il limite).
- Una ronda interrotta a metà (crash del processo) resta `running`: la stessa
  chiave risponde 409 `broadcast_in_progress` per 36 h invece di rischiare un
  doppio invio. Si riparte con una chiave nuova.

## Prove

- Unità: schema strict, normalizzazione e limiti dei parametri, chiave di
  idempotenza, chiavi `perRecipient`, maschera, testo della riga in pagina.
- Golden (PostgreSQL reale, file nuovo, asserzioni esplicite, nessuna
  istantanea esistente cambia): solo la lista (un cliente della stessa
  organizzazione non riceve nulla); 409 senza lista / restrizione spenta;
  422 modello sconosciuto / non approvato / parametri sbagliati;
  normalizzazione dei parametri arrivata a Meta; idempotenza (la seconda
  chiamata non invia) e scadenza a 36 h; limite 3/ora; isolamento A/B;
  `perRecipient`; messaggi in uscita persistiti e visibili (SSE
  `message.new`, `contact_identity`, V1–V6 = 0); `dryRun` non scrive nulla.
- E2E (`scripts/e2e-selftest.mjs`, sezione «012») con wa-mock.
- Sabotaggi: restrizione della lista, idempotenza, ambito
  dell'organizzazione, normalizzazione dei parametri.
