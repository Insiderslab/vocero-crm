# Fase 9 — Usabilità P1/P2 (test di usabilità del 2026-10-11)

> Customización sobre el fork desplegado en crm.heili.cloud.
> **Stato: in corso** — branch locale `ux-p1` (base `origin/main` @ `0bc731e`).
> Il test di usabilità è stato fatto sulla produzione `e23332e`; ogni rilievo
> è stato ricontrollato su `0bc731e` prima di toccare il codice.
> **Corsia: COMPLETA** — migrazione nuova `drizzle/0015_*.sql` (una colonna in
> `agent_profile`). Registro: `docs/lavoro/2026-10-11-usabilita-p1.md`.

**Constitution Check**:
- II (sovranità) ✔️ — nessun servizio esterno nuovo. L'avviso di E1 è un
  evento SSE dentro l'app (niente email, Slack o notifiche push).
- I (segreti) ✔️ — nessun segreto nuovo.
- III (multi-tenancy) ✔️ — la rotta nuova lavora solo sulla conversazione
  dell'organizzazione della sessione; il nuovo evento SSE va solo al canale
  dell'organizzazione.
- IV (idempotenza) ✔️ — il secondo tentativo è uno solo e non si ripete; il
  messaggio di cortesia parte una volta per passaggio a un umano.
- Sandbox del Laboratorio ✔️ — le conversazioni `is_test` non ricevono né il
  secondo tentativo né il messaggio di cortesia, e il messaggio di cortesia
  passa da `sendText` (finestra 24 h e guardia della sandbox).

## E1 (CRITICO) — il provider IA fallisce e il cliente non riceve risposta

Oggi `runAgentTurn` passa la conversazione a un umano con motivo `error`
quando `chatJson` fallisce, e nessuno se ne accorge.

### US1.a — Secondo tentativo più tardi
**AC**
1. Se `chatJson` risponde `provider_error` in una conversazione reale, il
   turno NON passa subito a un umano: si programma UN secondo tentativo dopo
   `AGENT_RETRY_MS` (default 60 000 ms; `0` = nessun secondo tentativo).
2. Il secondo tentativo è in memoria, come la mappa di coalesce (nessuna coda
   esterna), e gira con lo stesso lucchetto per conversazione: mai due turni
   insieme.
3. Non può ripetersi: il secondo tentativo non ne programma un terzo. Se
   fallisce di nuovo (qualsiasi errore) → passaggio a un umano `error`.
4. Non può rispondere due volte: il secondo tentativo NON parte se nel
   frattempo è arrivato un messaggio nuovo (entrante o uscente) dopo quello a
   cui doveva rispondere, se la conversazione è passata a un umano, se l'IA è
   spenta, o se c'è già un turno in corso o in attesa. Un turno normale
   annulla il secondo tentativo in attesa.
5. `invalid_output` (il modello risponde ma non in JSON valido, dopo i 3
   tentativi di `chatJson`) resta come oggi: passaggio a un umano `error`.
6. Laboratorio: nessun secondo tentativo (risultato immediato, come oggi).

### US1.b — Messaggio di cortesia
**AC**
1. Campo nuovo facoltativo per organizzazione `agent_profile.error_reply`
   (`text`, NULL). Migrazione 0015 con `SET LOCAL lock_timeout = '5s'` e
   snapshot che discende da 0014.
2. Quando il turno passa DAVVERO a un umano per `error` (la conversazione non
   aveva già un passaggio attivo), il testo si invia una volta con `sendText`
   (finestra 24 h, sandbox, credenziali). Non si invia se dopo l'ultimo
   entrante c'è già un uscente con lo stesso testo.
3. Vuoto = spento. Se l'invio non è possibile (finestra chiusa, nessuna
   connessione) si registra nel log e non si ritenta.
4. Si modifica nella pagina Agente IA, sezione «Comportamento» (es/en/it).
   L'API `PUT /api/agent/profile` accetta `errorReply` (≤ 1000, vuoto → null).

### US1.c — Visibilità nella posta
**AC**
1. Filtro «Assistenza umana» (conversazioni con passaggio attivo) accanto a
   Tutte / Non lette / Fase, con il conteggio.
2. Le conversazioni con passaggio attivo vanno in cima alla lista (ordine
   stabile; dentro ogni gruppo l'ordine di sempre).
3. Etichetta visibile con il motivo; per `error`: «Errore del provider IA».
4. Pulsante «Riprova risposta IA» nel pannello del contatto:
   `POST /api/conversations/[id]/agent-retry` (`withAuth`: owner, admin e
   member, come riattivare l'IA della conversazione). Toglie il passaggio,
   riaccende l'IA della conversazione e lancia SUBITO un turno (senza
   coalesce, con il lucchetto). 409 se l'IA non è configurata o l'agente è
   spento; 404 se la conversazione non è dell'organizzazione. Se il provider
   fallisce ancora, passaggio `error` immediato (nessun secondo tentativo
   programmato: il clic È il secondo tentativo).

### US1.d — Avviso nell'app
**AC**
1. Ogni passaggio a un umano deciso dall'agente pubblica l'evento SSE
   `conversation.handoff` `{ conversationId, reason }` (solo nel canale
   dell'organizzazione).
2. L'app mostra un avviso (toast) in ogni pagina, con il nome del contatto,
   il motivo e un collegamento alla conversazione. Niente servizi esterni.

## E2 (ALTO) — lingue mescolate

**AC**
1. Fasi della pipeline: un'organizzazione NUOVA nasce con i nomi delle fasi
   nella lingua dell'interfaccia di chi la crea (registrazione: cookie, poi
   `Accept-Language`, poi default dell'istanza; pannello admin: lingua del
   super-admin). I dati esistenti non si riscrivono.
2. Visualizzazione: se il nome di una fase è ESATTAMENTE uno dei nomi
   predefiniti (in qualsiasi delle tre lingue), si mostra l'etichetta tradotta
   nella lingua corrente. Una fase rinominata si mostra come è scritta. Nel
   gestore delle fasi, lasciare il campo com'è non rinomina la fase.
3. Laboratorio: nomi delle persone tradotti (per chiave); date con
   `Intl` nella lingua corrente. Scheda del lead («Ficha / Todavía vacía») e
   date della posta («9 de octubre») nella lingua corrente.
4. Valuta di un'organizzazione nuova: EUR se la lingua è l'italiano,
   altrimenti il default dell'istanza (MXN). Si scrive nella marca
   dell'organizzazione alla creazione; le organizzazioni esistenti non
   cambiano (si modifica in Impostazioni → Marca). Segnaposto del nome del
   modello WhatsApp tradotto.
5. **E9** — il titolo della scheda mostrava la chiave cruda
   `meta.titleSuffix`: la chiave vera è `common.meta.titleSuffix`.

## E3/E6 — stati di caricamento e primo clic perso

**AC**
1. Contatti, posta, pipeline, agente, laboratorio e automazioni mostrano uno
   scheletro di caricamento finché i dati non arrivano: mai «Nessun
   contatto» (o equivalente) durante il caricamento.
2. `loading.tsx` per le sezioni dell'app: la navigazione mostra subito lo
   scheletro invece di lasciare la pagina precedente senza segnali.
3. Causa del primo clic perso: vedi registro (E5/E6).

## E4 — ordine dei messaggi

**AC**
1. Ordine deterministico ovunque si legga il filo (API, contesto dell'IA,
   trascrizione del Laboratorio, export, anteprima): `created_at`, poi
   direzione (`in` prima di `out` a parità di istante), poi `id`.
2. Test con domanda e risposta allo stesso istante (precisione al secondo,
   come l'import dello storico).

## E5 — `?_rsc=` 503 in produzione
Indagine dal codice e dalla configurazione; comandi in sola lettura per
l'owner nel registro.

## E7/E8/E10 — rifiniture visive

**AC**
1. E7: l'orario nelle bolle in uscita ha contrasto sufficiente; il
   separatore della data non è tagliato.
2. E8: nel piede della barra laterale il pulsante della lingua non si
   sovrappone al ruolo e il nome non si tronca senza motivo.
3. E10: l'interruttore dell'agente («Acceso») è un vero switch con la
   manopola visibile, `role="switch"`, `aria-checked` ed etichetta.
4. Il piede della colonna della pipeline non ripete «Nessun importo
   inserito»: si nasconde se nessuna scheda ha un importo.

## Fuori ambito
- Copioni del Laboratorio (testi del cliente simulato) e KB demo restano in
  spagnolo: sono dati che vede il modello.
- Notifiche fuori dall'app (email, Slack, push): vietate dalla Costituzione II.

## Prove
- Unità: decisioni pure (secondo tentativo, cortesia, ordinamento della
  posta, nomi delle fasi, lingua dalle intestazioni, valuta), chiavi i18n.
- Golden (PostgreSQL reale): secondo tentativo riuscito / fallito,
  nessun doppio invio, cortesia una volta, rotta «Riprova», evento SSE,
  ordine dei messaggi a parità di istante.
- E2E (`scripts/e2e-selftest.mjs`, sezione «009-usabilità»).
- Un sabotaggio per ogni guardia nuova.
