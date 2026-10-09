# Specifica: Livello canali comune (005-livello-canali)

**Branch del pacchetto**: `notte/adr-canali` (M1.1, solo documenti) · implementazione: M1.2 (migrazione), M1.3 (adattatore WhatsApp), M1.4 (scheda contatto), M1.5 (agente AI e capacità), M1.6 (adattatore Instagram in modalità sviluppo, secondo canale reale)

**Creata**: 2026-10-10

**Stato**: Bozza — dipende dall'approvazione dell'[ADR 0001](../../docs/adr/0001-livello-canali.md) (D1)

**Carril (Costituzione VI)**: **ciclo completo** (`spec → plan → tasks → implement`): tocca il modello dati (migrazioni) e un contratto pubblicato (webhook). Documenti: questa spec, [plan.md](plan.md), [tasks.md](tasks.md). Le decisioni stanno nell'ADR; qui c'è il comportamento osservabile.

**Input**: «Lo stesso CRM gestisce WhatsApp, email, Instagram e Messenger» (`docs/visione/crm-multicanale-multicliente.md`). Fase M1 del piano: «WhatsApp invariato, modello pronto per gli altri canali» (`docs/piani/PIANO-CRM-MULTICANALE.md` §3).

## Contesto

- **Chi ne beneficia oggi:** nessuno vede differenze. È una fase di fondazione: il comportamento di WhatsApp deve restare **identico** per il titolare, gli operatori, l'agente AI, il cervello esterno (`/api/bot/*`), l'export (`/api/export/*`) e Meta/Wapi (URL del webhook).
- **Chi ne beneficia dopo:** l'agenzia che aggiunge Instagram, Messenger o email (M3, M4) senza toccare il nucleo, e il titolare che vede una persona come **un solo contatto** anche quando scrive da più canali.
- **Vincolo costituzionale:** i Principi II e VIII oggi limitano il prodotto a WhatsApp. M1.2–M1.5 non aggiungono dipendenze esterne né canali; M1.6 porta un secondo canale reale (Instagram, spento in produzione), quindi l'emendamento serve **prima del merge di M1.6** (ADR §6, D2).

## Scenari utente e test *(obbligatorio)*

### Storia 1 — WhatsApp funziona esattamente come prima (Priorità: P1)

Come titolare del negocio, dopo l'aggiornamento continuo a ricevere e inviare messaggi WhatsApp, vedere stati, allegati, eco dal telefono, modelli e risposte dell'agente **senza notare alcuna differenza**.

**Perché questa priorità:** se WhatsApp si rompe, si ferma il prodotto. Ogni altra storia è secondaria.

**Test indipendente:** la suite golden (`pnpm test:golden`) registrata sul codice di oggi passa, **senza modifiche ai file golden**, dopo ogni rilascio (R1, R2, R3). Il self-test end-to-end (`pnpm test:e2e`) resta verde.

**Scenari di accettazione:**
1. **Dato** un numero collegato, **quando** arriva un messaggio di testo da `5215512345678`, **allora** il contatto viene creato con identità `525512345678`, la conversazione e il messaggio compaiono nella bandeja in ≤ 2 s e l'agente parte come oggi.
2. **Dato** lo stesso payload consegnato due volte, **quando** viene elaborato, **allora** esiste un solo messaggio e un solo evento SSE `message.new`.
3. **Dato** un contatto creato da BSUID, **quando** arriva un messaggio con telefono e lo stesso BSUID, **allora** il messaggio va **allo stesso contatto** (riconciliazione di oggi).
4. **Dato** un messaggio uscito con stato `read`, **quando** arriva un `delivered` in ritardo, **allora** lo stato resta `read`.
5. **Dato** un eco `smb_message_echoes` dal telefono del titolare, **quando** viene elaborato, **allora** compare come uscente `manual`, non apre la finestra e mette in pausa l'AI (`manual_reply`).
6. **Dato** l'URL `/api/webhooks/wa/<token>` configurato in Meta e in Wapi, **quando** si aggiorna il CRM, **allora** l'URL continua a funzionare senza riconfigurare nulla (GET di verifica e POST).
7. **Dato** un operatore che invia testo, allegato, posizione, contatti o modello, **quando** la richiesta parte, **allora** la richiesta a Graph (percorso, body) e la risposta HTTP del CRM (compresi i codici d'errore `window_closed`, `reconnect_required`, `meta_unavailable`, `sandbox_violation`, …) sono identiche a oggi.
8. **Dato** il cervello esterno che chiama `GET /api/bot/context?waIdentity=…`, **quando** il CRM è in R3, **allora** risponde con la stessa conversazione e lo stesso DTO di oggi.

---

### Storia 2 — Nessun dato tra organizzazioni diverse (Priorità: P1)

Come agenzia che ospita più clienti sulla stessa istanza, ho la garanzia che la nuova struttura dei canali non mescoli mai contatti, conversazioni, messaggi o credenziali di organizzazioni diverse, nemmeno per un errore del codice.

**Perché questa priorità:** Legge Zero.

**Test indipendente:** test negativi con due organizzazioni A e B nella suite golden e nei test della migrazione; test di sabotaggio sulle FK composte.

**Scenari di accettazione:**
1. **Dato** un payload per il numero di B, **quando** viene elaborato, **allora** in A non cambia nessuna riga.
2. **Dato** uno stato con il `wamid` di un messaggio di A che arriva sul numero di B, **quando** viene elaborato, **allora** il messaggio di A non cambia.
3. **Dato** il backfill su un DB con A e B, **quando** termina, **allora** ogni conversazione punta a un `channel_account` della **sua** organizzazione, e la query di verifica n. 5 dell'ADR §3.3 restituisce 0.
4. **Dato** un tentativo (anche da codice) di inserire una `contact_identity` di A che punta a un contatto di B, **quando** si scrive nel DB, **allora** il DB lo rifiuta (FK composta).
5. **Dato** un secondo `channel_account` con lo stesso `(channel, external_account_id)` in un'altra organizzazione, **quando** si salva, **allora** viene rifiutato (come oggi `meta_credentials_phone_uq`).

---

### Storia 3 — Aggiornamento e ritorno indietro senza perdere dati (Priorità: P1)

Come owner che rilascia in produzione, posso applicare la migrazione e, se qualcosa non va, tornare alla versione precedente senza perdere messaggi o contatti.

**Perché questa priorità:** la migrazione M1.2 è il punto più delicato del piano (§5 Rischi).

**Test indipendente:** su un PostgreSQL usa e getta: (a) applicazione da zero; (b) aggiornamento da un DB con dati simulati di produzione (≥ 100 000 messaggi, 2 organizzazioni); (c) rollback di R1 riavviando l'immagine precedente; (d) ripetizione del backfill (idempotenza).

**Scenari di accettazione:**
1. **Dato** un DB di produzione simulato, **quando** parte R1, **allora** le cinque verifiche dell'ADR §3.3 danno 0 righe anomale e la durata è registrata.
2. **Dato** R1 applicato, **quando** si riavvia l'immagine precedente, **allora** l'app parte, riceve e invia; al ritorno a R1/R2 il backfill ripetuto riallinea le righe scritte nel frattempo.
3. **Dato** un backfill eseguito due volte, **quando** termina la seconda, **allora** non ci sono righe duplicate.
4. **Dato** un DB in cui una riga non è allineata, **quando** parte la migrazione di R2 (o R3), **allora** la migrazione fallisce con un messaggio chiaro e il container non serve traffico (fail-closed).
5. **Dato** R3 pronto, **quando** l'owner lo rilascia, **allora** esiste un backup verificato da un ripristino riuscito e R2 è stato in produzione per il periodo concordato (D10).

---

### Storia 4 — Un canale nuovo si aggiunge senza toccare il nucleo (Priorità: P2)

Come agenzia che estende il CRM, aggiungo un canale scrivendo un adattatore e una riga di registro, e il nucleo (ingesta, invio, sandbox, finestra, agente AI) lo gestisce senza modifiche.

**Perché questa priorità:** è lo scopo di M1, ma si vede solo in M3/M4.

**Test indipendente:** in M1.3 un `FakeChannelAdapter` (solo nei test) passa la **stessa suite di contratto** dell'adattatore WhatsApp, senza modifiche a `src/server/channels/core/*`.

**Scenari di accettazione:**
1. **Dato** un adattatore registrato con slug `fake`, **quando** arriva un POST su `/api/webhooks/fake/<token>` con firma valida, **allora** contatto, conversazione e messaggio vengono creati con `message.channel = 'fake'` e l'idempotenza vale come per WhatsApp.
2. **Dato** uno slug non registrato, **quando** arriva un POST, **allora** la risposta è 404 senza leggere il body.
3. **Dato** un adattatore la cui firma non è valida, **quando** arriva un POST, **allora** la risposta è 401 e non si scrive nulla.
4. **Dato** una conversazione del Laboratorio su qualsiasi canale, **quando** l'agente risponde, **allora** l'adattatore **non** viene chiamato (sandbox nel nucleo).

---

### Storia 5 — Ogni canale dichiara cosa sa fare (Priorità: P2)

Come titolare, l'interfaccia e l'agente AI non mi promettono funzioni che il canale non ha: finestra di risposta, modelli, allegati, lunghezza del testo.

**Perché questa priorità:** Prima Legge («non si promettono funzioni che il canale non ha»).

**Test indipendente:** unit test delle capacità e della finestra calcolata dalle capacità; in M1 i valori di WhatsApp riproducono le costanti di oggi (`WINDOW_MS`, `MEDIA_LIMITS`).

**Scenari di accettazione:**
1. **Dato** WhatsApp, **quando** si leggono le capacità, **allora** la finestra è di 24 h, i modelli sono richiesti fuori finestra e i limiti degli allegati coincidono con `MEDIA_LIMITS`.
2. **Dato** un canale con `replyWindow: unbounded` (email, in M4), **quando** l'agente risponde dopo 3 giorni, **allora** il nucleo non applica l'handoff `ventana`.
3. **Dato** un canale con `templates: "none"`, **quando** la UI mostra una conversazione a finestra chiusa, **allora** non offre l'invio di un modello (M1.4/M1.5).

---

### Storia 6 — Il contratto regge un secondo canale reale (Priorità: P2, obbligatoria per chiudere M1)

Come agenzia, prima di investire in Instagram e Messenger per i clienti, voglio la prova che il livello canali regge un provider **diverso** da WhatsApp, non solo un adattatore finto.

**Perché questa priorità:** un adattatore finto scritto da chi ha scritto il contratto conferma soprattutto sé stesso (ADR §3.9). Scoprire in M3 che il contratto non regge costerebbe una seconda migrazione dopo R3.

**Test indipendente:** in M1.6 l'adattatore Instagram passa la stessa suite di contratto di WhatsApp con fixture sintetiche; `git diff --stat` di M1.6 non tocca il nucleo; la prova end-to-end reale la fa l'owner in modalità sviluppo con un account Instagram di prova (gli agenti non chiamano Meta).

**Scenari di accettazione:**
1. **Dato** un account Instagram di prova collegato all'organizzazione A, **quando** arriva un webhook `object: "instagram"` con un DM, **allora** si crea un contatto con identità `instagram` (IGSID, legata all'account) e il messaggio compare nella bandeja con `channel = 'instagram'`.
2. **Dato** lo stesso IGSID ricevuto da un account di A e da un account di B, **quando** vengono elaborati, **allora** esistono due contatti separati, uno per organizzazione.
3. **Dato** un webhook Instagram con firma mancante o errata, **quando** arriva, **allora** la risposta è 401 e non si scrive nulla, anche se `META_APP_SECRET` di WhatsApp non è configurato.
4. **Dato** un'organizzazione con chiave Wapi propria (C3), **quando** il CRM invia un DM Instagram, **allora** la richiesta va a `graph.instagram.com` e **mai** a `WAPI_BASE_URL`.
5. **Dato** `CHANNELS_ENABLED=whatsapp` (default), **quando** arriva un POST su `/api/webhooks/instagram/<token>`, **allora** la risposta è 404 e Instagram non compare nell'interfaccia.
6. **Dato** uno stato OAuth creato per l'organizzazione A, **quando** il callback arriva con la sessione di un utente di B, o di un `member` di A, **allora** il collegamento è rifiutato e nessun `channel_account` viene creato.
7. **Dato** un messaggio `is_echo` inviato dall'app Instagram del titolare, **quando** viene elaborato, **allora** compare come uscente `manual` e mette in pausa l'AI come l'eco di WhatsApp.

### Casi limite

- Conversazioni del Laboratorio (`is_test`) senza `channel_account`: il canale è `whatsapp` per regola esplicita, e non toccano mai un provider.
- Organizzazione senza numero collegato e con conversazioni (seed demo, mock): `channel_account_id` resta NULL e il comportamento è quello di oggi (`not_connected` all'invio).
- Riconnessione con un numero diverso: oggi `saveCredentials` aggiorna la riga dell'organizzazione e le conversazioni restano. Con `channel_account` si aggiorna **la stessa riga** (`external_account_id` nuovo): stesso comportamento.
- Messaggio uscente fallito prima dell'invio (`external_message_id` NULL): nessun conflitto d'univocità.
- `wamid` uguale in due organizzazioni: oggi il secondo viene scartato; da R3 viene salvato in entrambe (ADR §3.2, nota d'isolamento).
- Contatto archiviato che riscrive: viene riattivato come oggi.
- Payload con `entry` di più numeri: ogni evento si instrada per il suo account.
- Organizzazione con chiave Wapi (C3, `wapi_credentials`) e senza numero collegato: nessun `channel_account`; la chiave resta dov'è e l'instradamento è identico a C3.
- Chiave Wapi revocata dopo R1: nessun effetto sui dati dei canali (la tabella non entra nella migrazione).
- Contatto solo-Instagram prima di R3: `wa_identity` NULL (M1.6); non compare in `GET /api/bot/context?waIdentity=`, e l'export non inventa un valore. In produzione Instagram resta spento fino a R3 (ADR D17).
- Token Instagram scaduto (60 giorni) in modalità sviluppo: `checkHealth` restituisce `expiring` o `reconnect_required`; nessun invio parte con un token scaduto.

## Requisiti *(obbligatorio)*

### Requisiti funzionali

- **FR-001** Il sistema DEVE definire il contratto `ChannelAdapter` e i tipi `InboundEvent`, `OutboundMessage`, `ChannelCapabilities`, `ConnectionHealth` dell'ADR §3.1 in un modulo senza dipendenze dal DB.
- **FR-002** `parse` DEVE essere puro (niente DB, rete, orologio) e preservare l'ordine di elaborazione di oggi (per WhatsApp: stati prima dei messaggi di ogni `change`).
- **FR-003** La sandbox del Laboratorio, l'ordine dei controlli d'invio, la finestra di risposta, l'idempotenza, la monotonìa degli stati e la risoluzione dell'organizzazione DEVONO restare nel nucleo; nessun adattatore li reimplementa.
- **FR-004** Il sistema DEVE aggiungere `channel_account`, `contact_identity`, `conversation.channel_account_id`, `message.channel`, `message.external_message_id` con i vincoli dell'ADR §3.2, comprese le FK composte con `organization_id`.
- **FR-005** La migrazione DEVE seguire tre rilasci (R1 espandi + backfill + doppia scrittura; R2 letture nuove + verifica; R3 contrazione) con il rollback dell'ADR §3.3.
- **FR-006** Il backfill DEVE essere idempotente e ripetuto all'inizio di R2 e R3; le verifiche DEVONO bloccare la migrazione (eccezione) se trovano righe non allineate.
- **FR-007** In R1 e R2 ogni scrittura su `meta_credentials`, `contact`, `conversation` e `message` DEVE scrivere anche la struttura nuova, nella stessa transazione.
- **FR-008** Il webhook DEVE essere servito da `/api/webhooks/<slug>/[token]` con l'ordine di controlli dell'ADR §3.5; l'URL `/api/webhooks/wa/<token>` DEVE restare valido e identico nel comportamento.
- **FR-009** I canali nuovi DEVONO verificare la firma in modo obbligatorio (fail-closed); WhatsApp in M1 mantiene la regola di oggi (D3).
- **FR-010** I contratti pubblicati DEVONO restare identici: `/api/bot/*` (compreso `?waIdentity=`), `/api/export/*` (campo `waIdentity`), i codici di `SendError` nelle risposte HTTP, gli eventi SSE (il DTO del messaggio può ricevere solo campi **additivi**, es. `channel`).
- **FR-011** L'unione di contatti tra canali DEVE richiedere la conferma di un owner o admin e lasciare un audit; l'unica unione automatica ammessa è quella attestata dal provider nello stesso evento e canale (WhatsApp telefono+BSUID).
- **FR-012** Una suite golden con DB reale DEVE essere registrata sul codice di oggi **prima** di qualsiasi modifica e DEVE passare senza modifiche ai golden dopo M1.2 e M1.3. Senza DB fallisce (non si salta).
- **FR-013** Ogni guardia nuova (FK composte, verifiche di R2/R3, routing per slug, firma dei canali nuovi) DEVE avere un test di sabotaggio registrato.
- **FR-014** Le capacità di WhatsApp DEVONO riprodurre le costanti di oggi (`WINDOW_MS` 24 h, `MEDIA_LIMITS`, modelli fuori finestra).
- **FR-015** `wapi_credentials` (C3) NON DEVE essere migrata né letta dal nucleo in M1; l'instradamento Graph resta quello di C3 per WhatsApp.
- **FR-016** Il trasporto Graph DEVE essere deciso per canale: il desvío a Wapi vale solo per `whatsapp`; ogni altro canale va diretto al suo host Meta (fail-closed: canale sconosciuto → nessuna chiamata).
- **FR-017** M1.6 DEVE fornire un adattatore Instagram reale che passa la suite di contratto comune senza modifiche al nucleo; se il nucleo va cambiato, la modifica DEVE passare da una revisione dell'ADR.
- **FR-018** I canali diversi da WhatsApp DEVONO essere spenti per istanza finché l'owner non li accende (`CHANNELS_ENABLED`, default `whatsapp`): webhook 404, nessuna voce nell'interfaccia.
- **FR-019** Il collegamento OAuth di un canale DEVE legare lo stato a organizzazione, utente e nonce in cookie `httpOnly`, e verificare al callback sessione, organizzazione e ruolo owner/admin.
- **FR-020** Nessun agente DEVE chiamare Meta; la prova reale del secondo canale è dell'owner e il suo esito (o la sua assenza) DEVE essere scritto nel registro.

### Entità chiave

- **Account di canale** (`channel_account`): un collegamento di un'organizzazione a un canale (numero WhatsApp, profilo Instagram, Pagina Facebook, indirizzo email), con credenziale cifrata, scadenza e stato.
- **Identità del contatto** (`contact_identity`): come una persona è identificata in un canale; univoca per organizzazione, canale e ID esterno.
- **Conversazione**: appartiene a un contatto e (per le reali) a un account di canale.
- **Messaggio**: ha un canale e un ID esterno univoco per organizzazione e canale.
- **Adattatore di canale**: modulo che traduce il provider da e verso gli eventi normalizzati e dichiara le capacità.

## Criteri di successo *(obbligatorio)*

- **SC-001** 100 % dei casi golden verdi senza modifiche ai file golden dopo R1, R2 e R3.
- **SC-002** 0 righe anomale nelle cinque verifiche del backfill su una copia con ≥ 100 000 messaggi e 2 organizzazioni; durata registrata nel registro di M1.2.
- **SC-003** Il self-test end-to-end esistente resta verde; il test end-to-end WhatsApp dell'owner è riuscito prima di R3.
- **SC-004** Un adattatore finto passa la suite di contratto **senza** diff in `src/server/channels/core/*`.
- **SC-005** Tutti i test negativi con due organizzazioni passano; ogni sabotaggio registrato fa fallire almeno un test.
- **SC-006** Zero modifiche ai contratti pubblicati (verificate dai test esistenti di `/api/bot/*`, `/api/export/*` e dai golden HTTP).
- **SC-007** L'adattatore Instagram passa il 100 % della suite di contratto; `git diff --stat` di M1.6 su `src/server/channels/core/`, `src/server/ai/` e sul gestore dei webhook è vuoto.
- **SC-008** Prova end-to-end reale dell'owner in modalità sviluppo riuscita (DM in entrata, risposta, eco), oppure dichiarata «non eseguita» nel registro di M1.6 con il motivo.

## Fuori ambito

- Messenger, email, collegamento con un clic e pagina «Canali» (pacchetti K, M3.2, M4): solo il modo di innestarli è definito qui. Instagram entra in M1 **solo** in modalità sviluppo (M1.6), spento in produzione; l'apertura ai clienti (M3.1) richiede l'App Review.
- Rinnovo automatico dei token Instagram (M3.1) e allegati in uscita su Instagram (serve un URL firmato a tempo).
- Migrazione di `wapi_credentials` (resta com'è; D9).
- Più account dello stesso canale per organizzazione (D4).
- UI dell'unione dei contatti e badge del canale (M1.4).
- Cambio del prompt dell'agente (M1.5): cambia il comportamento e ha i suoi golden.
- Firma obbligatoria per WhatsApp (D3, rilascio separato).
- Rimozione di `contact.phone` e `contact.wa_user_id`: restano attributi.

## Supposti (Costituzione VII)

- I `wamid` di Meta sono univoci almeno per numero; **non verificato** che lo siano sull'istanza (ADR §3.2).
- Il migratore Drizzle non fallisce se il DB ha una migrazione più recente del codice; **da verificare in M1.2**.
- PostgreSQL ≥ 11 (aggiunta di colonna con default senza riscrittura); l'immagine di produzione usa PostgreSQL 16 (`specs/001-vocero-core/plan.md`).
- Le capacità di Instagram e Messenger nell'ADR §3.6 sono da confermare in K0 con la documentazione Meta.
- L'app «Dm Heili» di heili-dm è *Live* con solo accesso Standard e **senza** App Review (documenti di heili-dm al 31/08 e al 05/10: ADR §3.8); lo stato attuale nella console Meta **non è verificato** (D14).
- Meta ammette un solo URL di callback per oggetto webhook e per app: da riconfermare in K0.
