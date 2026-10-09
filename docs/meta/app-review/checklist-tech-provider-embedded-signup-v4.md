# Checklist: Tech Provider ed Embedded Signup v4

> Embedded Signup **v2 e v3 sono ritirate il 15/10/2026** (dato dell'owner, da riconfermare nella documentazione Meta). Il CRM oggi non usa Embedded Signup, quindi non si rompe nulla: il flusso (pacchetto K2) si costruisce **direttamente su v4**. Mai implementare v2/v3.
> Le voci marcate **[verificare]** sono ciò che si ricorda della documentazione Meta e **non è stato controllato** (nessuna chiamata a Meta in questo pacchetto): confermarle nel pannello e nella documentazione prima di agire. Tutti i passaggi sul pannello li fa l'owner.

## A. Prerequisiti dell'azienda

- [ ] Business Verification dell'azienda completata nel Business Manager (il piano la dà per fatta; confermare lo stato).
- [ ] Una sola app Meta per il CRM, in modalità **Live** (K0 verifica se si può consolidare le tre app esistenti: «Whatpp Business Insiderslab», «Whapi by Heili», «Dm Heili»). Mantenere app separate solo se K0 dimostra che serve.
- [ ] Pagine pubbliche raggiungibili e con titolare impostato (`LEGAL_ENTITY_NAME`, `LEGAL_CONTACT_EMAIL`): `/privacy`, `/termini`, `/cancellazione-dati`.
- [ ] Testi legali **rivisti da un avvocato** (oggi sono bozze).
- [ ] Icona dell'app 1024x1024, categoria dell'app, email di contatto dell'app, dominio dell'app: vedi `valori-pannello-meta.md`.

## B. Diventare Tech Provider  **[verificare ogni voce]**

- [ ] L'app è di tipo Business e collegata al Business Manager verificato.
- [ ] Accettati i termini per i Tech Provider nel pannello WhatsApp.
- [ ] Richiesto l'**accesso avanzato** a `whatsapp_business_management` e `whatsapp_business_messaging` tramite App Review (note e video: `note-permessi.md`, `copioni-video.md`, Video 1).
- [ ] Verificare se serve anche `business_management` per l'onboarding dei clienti e, se sì, aggiungere nota e scena (oggi non è nelle note: **non chiederlo senza prova che serva**).
- [ ] Verificare i requisiti di fatturazione per i Tech Provider (linea di credito condivisa o pagamento diretto del cliente) e decidere il modello con l'owner. Decisione dell'owner, non dell'agente.
- [ ] Webhook dell'app: URL e verifica configurati (vedi `valori-pannello-meta.md`), campi sottoscritti per WhatsApp (almeno messaggi e stato dei modelli).
- [ ] Segreto dell'app (`META_APP_SECRET`) impostato sull'istanza, così la firma dei webhook viene verificata. **Il valore non va mai nel repository né in questi documenti.**

## C. Embedded Signup v4 (K2)  **[verificare ogni voce]**

Prima di scrivere codice K2, K0 deve confermare con la documentazione corrente:

- [ ] Configurazione di **Facebook Login for Business** per il caso WhatsApp: si crea una *configuration* nel pannello e se ne usa l'identificativo nel pulsante. Annotare in `docs/meta/` il nome del campo e dove si trova (l'ID non è un segreto, ma si inserisce come variabile d'ambiente, non nel codice).
- [ ] Flusso a **codice**: il popup restituisce un codice di autorizzazione di breve durata, che il **server** scambia con il token aziendale. Il segreto dell'app non esce mai dal server.
- [ ] Evento di completamento dal popup (messaggio con WABA ID e Phone Number ID): leggerlo come **dato non fidato** (§ Seconda Legge), convalidare origine e forma, e verificare lato server con una chiamata alla Graph API che quel WABA appartenga davvero al token.
- [ ] Dopo il collegamento: iscrizione del WABA ai webhook, registrazione del numero (se richiesta), lettura dei modelli.
- [ ] Token aziendale **cifrato per organizzazione** (come le altre credenziali, `lib/crypto`), mai mostrato per intero, mai nei log.
- [ ] Il flusso lega il risultato **all'organizzazione dell'utente collegato**: stato firmato che contiene l'organizzazione e scade (modello: `heili-dm/lib/meta/oauth.ts`). Test negativo con due organizzazioni: il WABA collegato da A non compare in B.
- [ ] Comportamento se l'utente chiude il popup o rifiuta i permessi: messaggio chiaro, nessuno stato a metà.
- [ ] Verificare se la stessa configurazione può collegare anche Messenger e Instagram (pulsante unico «Collega Meta»): è la domanda di K0. Se no, tre pulsanti.
- [ ] Verificare quali versioni della Graph API e quale *sessionInfoVersion* richiede v4 e fissarle in un'unica costante del codice (`META_GRAPH_API_VERSION` esiste già).

## D. Instagram (K3) e Messenger (K4)

- [ ] Instagram: Business Login for Instagram, **non serve una Pagina Facebook**. Riusare `heili-dm/lib/meta/oauth.ts` (stato firmato, token cifrato AES-GCM). Permessi: `instagram_business_basic`, `instagram_business_manage_messages` **[verificare nomi]**. App Review della messaggistica.
- [ ] Instagram: l'account deve essere professionale (business o creator); il revisore ha bisogno di un account di prova e di un secondo account per scrivere.
- [ ] Messenger: Facebook Login for Business, scelta della Pagina, token della Pagina cifrato, iscrizione della Pagina ai webhook. Permessi in `note-permessi.md` **[nomi da confermare in K0]**.
- [ ] Per ogni canale: callback di **deautorizzazione** e di **cancellazione dati** (K1). Finché non ci sono, nel pannello si usa l'URL con le istruzioni `/cancellazione-dati` (vedi `valori-pannello-meta.md`).

## E. Prima dell'invio dell'App Review

- [ ] I flussi K2/K3/K4 sono in produzione e funzionano con un account vero (non mock).
- [ ] Le tre pagine pubbliche si aprono da una finestra anonima in HTTPS.
- [ ] Utente di prova per il revisore: credenziali **inserite nel pannello Meta** (campo delle istruzioni per il revisore), mai nel repository.
- [ ] Note e video corrispondono scena per scena (tabella di controllo in `copioni-video.md`).
- [ ] Si chiedono solo i permessi usati.
- [ ] I tempi di Meta non si accorciano: M3 parte solo ad approvazione ottenuta.

## F. Dopo l'approvazione

- [ ] Passare l'app a Live (se non lo è già) e ripetere il collegamento con un cliente reale con il suo consenso.
- [ ] Annotare data e esito in `docs/lavoro/`.
