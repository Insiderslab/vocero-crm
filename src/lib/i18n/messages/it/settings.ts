import type base from "../es/settings";

/** Dizionario IT — schermate delle impostazioni. */
const messages: typeof base = {
  title: "Impostazioni",
  tabs: {
    whatsapp: "WhatsApp",
    branding: "Marchio",
    templates: "Modelli",
    team: "Team",
    apiKeys: "Chiavi API",
  },
  branding: {
    title: "Marchio del CRM",
    description:
      "Questo CRM è tuo: dagli il nome della tua attività e il tuo colore. Si riflettono in tutta l'interfaccia e nella schermata di accesso.",
    currencyLabel: "Valuta dell'attività",
    currencyHelp:
      "È l'unica che la Pipeline somma. Gli importi acquisiti in un'altra valuta vengono mostrati, ma restano fuori dal totale della loro colonna.",
    accentLabel: "Colore d'accento",
    accentHelp:
      "Con un colore personalizzato, i toni derivati (hover, sfondi tenui) vengono calcolati automaticamente e il contrasto viene regolato.",
    preset: {
      azulAcero: "Blu acciaio",
      grafito: "Grafite",
      verdeApagado: "Verde spento",
      ciruela: "Prugna",
    },
    custom: "Personalizzato",
    previewButton: "Pulsante di esempio",
    saveError: "Impossibile salvare",
    saved: "Marchio salvato ✓",
    submit: "Salva marchio",
  },
  favicon: {
    title: "Icona della scheda",
    previewAlt: "Anteprima dell'icona della scheda",
    own: "Logo personalizzato",
    ownHelp: "Sostituisce quello generato. Puoi rimuoverlo per tornare a quello.",
    generated: "Generato dal tuo marchio",
    generatedHelp:
      "L'iniziale sul tuo colore d'accento. Carica un logo per sostituirla.",
    tooBig: "L'icona non può superare {{kb}} KB.",
    uploadError: "Impossibile caricare l'icona",
    removeError: "Impossibile rimuovere l'icona",
    uploading: "Caricamento…",
    change: "Cambia logo",
    upload: "Carica logo",
    remove: "Rimuovi",
    formats:
      "PNG, SVG, ICO, JPEG o WebP, fino a {{kb}} KB. Quadrata si vede meglio.",
  },
  team: {
    title: "Crea account del team",
    description:
      "Niente email né inviti: condividi tu stesso la password temporanea con il tuo collega (viene mostrata UNA sola volta).",
    createError: "Impossibile creare l'account",
    created: "Account creato ✓",
    shareNow: "Condividi questi dati ora (non verranno più mostrati):",
    passwordPrefix: "password",
    submit: "Crea account",
    membersTitle: "Membri",
    owner: "Proprietario",
    member: "Membro",
  },
  apiKeys: {
    forbidden:
      "Solo il proprietario o un amministratore dell'organizzazione gestisce le chiavi API.",
    bot: {
      title: "Chiavi del bot (vbk_)",
      description:
        "Per il cervello esterno che usa /api/bot/*. Ogni chiave vale solo per questa organizzazione.",
    },
    export: {
      title: "Chiavi di export (vex_)",
      description:
        "Per script e automazioni in sola lettura su /api/export/*. Ogni chiave vale solo per questa organizzazione.",
    },
    labelLabel: "Nome della chiave",
    labelPlaceholder: "es. bot di produzione, n8n",
    submit: "Crea chiave",
    createError: "Impossibile creare la chiave",
    created: "Chiave «{{label}}» creata ✓",
    shareNow:
      "Copiala ora: non verrà più mostrata. Salvala nel gestore dei segreti del servizio che la userà.",
    copy: "Copia chiave",
    copied: "Copiata ✓",
    hide: "Nascondi",
    listError:
      "Impossibile caricare l'elenco delle chiavi: ricarica la pagina. Potrebbero esserci chiavi attive.",
    empty: "Ancora nessuna chiave di questo tipo.",
    createdAt: "creata {{date}}",
    lastUsed: "ultimo uso {{date}}",
    neverUsed: "mai usata",
    revoke: "Revoca",
    revoked: "Revocata",
    confirmRevoke:
      "Revocare la chiave «{{label}}»? Il servizio che la usa smetterà subito di funzionare.",
    revokeError: "Impossibile revocare la chiave",
  },
  templates: {
    intro:
      "I modelli permettono di riaprire le conversazioni con la finestra di 24 ore chiusa. Meta li approva in ore o giorni e può riclassificare la categoria (il che cambia il costo per conversazione). Questa schermata interroga Meta sullo stato ogni volta che la apri; Sincronizza forza la verifica senza ricaricare.",
    sync: "Sincronizza",
    syncUpdated: "{{count}} modello/i aggiornato/i",
    syncUpToDate: "Tutto aggiornato",
    syncError: "Impossibile sincronizzare",
    rejectionReason: "Motivo del rifiuto: {{reason}}",
    empty:
      "Ancora nessun modello. Crea il primo qui sopra — per esempio un «siamo ancora disponibili, riprendiamo il tuo preventivo?» per le conversazioni fredde.",
    status: {
      draft: "Bozza",
      pending: "In attesa di Meta",
      approved: "Approvato",
      rejected: "Rifiutato",
    },
    createTitle: "Nuovo modello",
    createIntro1: "Corpo con tutte le variabili che ti servono: numerale ",
    createIntro2:
      "… in ordine e senza salti. Viene inviato all'approvazione di Meta alla creazione.",
    languageLabel: "Lingua",
    categoryLabel: "Categoria",
    utilityOption: "UTILITY (follow-up)",
    bodyLabel: "Corpo",
    bodyPlaceholder: "Ciao {{1}}, ti confermo la tua sessione il {{2}} alle {{3}}.",
    variableOne: "1 variabile: all'invio ne verrà chiesto il valore.",
    variableMany: "{{count}} variabili: all'invio verranno chiesti i {{count}} valori.",
    createError: "Impossibile creare il modello",
    submitting: "Invio a Meta…",
    submit: "Crea e invia per l'approvazione",
  },
  whatsapp: {
    forbidden:
      "Solo il proprietario o un amministratore dell'organizzazione gestisce la connessione WhatsApp.",
    reconnectTitle: "Il token di WhatsApp è scaduto o è stato revocato.",
    reconnectBody:
      "Gli invii sono in pausa. Incolla un nuovo token qui sotto e prova la connessione per riconnetterti.",
    connectedNumber: "Numero connesso: {{number}}",
    tokenTail: "token …{{last4}}",
    // 009 — Embedded Signup + coexistence
    coexTitle: "Collega il numero dell'app WhatsApp Business",
    coexDescription:
      "Il numero resta nell'app del telefono e arriva anche nel CRM: rispondi da dove vuoi. Si apre una finestra di Meta: entra con Facebook, scegli il numero dell'app e conferma sul telefono.",
    coexPoint1: "Apri l'app WhatsApp Business sul telefono almeno ogni 13 giorni, altrimenti Meta scollega il numero dal CRM.",
    coexPoint2: "Puoi condividere fino a 6 mesi di chat: entrano nel CRM come storico, senza attivare l'IA.",
    coexPoint3: "Gruppi, messaggi effimeri e liste broadcast non passano al CRM.",
    coexButton: "Collega con Meta",
    coexConnecting: "Collegamento con Meta…",
    coexCancelled: "Collegamento annullato nella finestra di Meta.",
    coexSdkFailed: "La finestra di Meta non si è caricata. Controlla i blocchi pubblicità o il dominio consentito nell'app Meta.",
    coexFailed: "Non è stato possibile completare il collegamento.",
    coexSuccess: "Numero {{number}} collegato (app + CRM).",
    coexSyncRequested: "Abbiamo chiesto a Meta rubrica e storico: arrivano nei prossimi minuti.",
    coexSyncFailed: "Non è stato possibile chiedere a Meta rubrica o storico: i messaggi nuovi arrivano comunque.",
    coexBadge: "App + CRM",
    coexKeepAlive: "Ricorda di aprire l'app WhatsApp Business sul telefono almeno ogni 13 giorni.",
    disconnectedTitle: "Meta ha scollegato il numero dal CRM.",
    disconnectedBody:
      "Succede di solito se l'app WhatsApp Business non viene aperta per ~14 giorni, se è cambiato il telefono o se l'accesso è stato rimosso. Apri l'app e ricollega con Meta.",
    connected: "Connesso",
    titleReconnect: "Riconnetti / aggiorna il numero",
    titleConnect: "Connetti il tuo numero di WhatsApp",
    connectDescription:
      "Incolla le credenziali di WhatsApp Cloud API. Il token viene validato con Meta PRIMA di essere salvato ed è archiviato cifrato.",
    originTitle: "Da dove viene il token?",
    originDirectTitle: "Modalità diretta",
    originDirect1: "L'attività ha la propria app su ",
    originDirect2: ": usa un token di ",
    originSystemUser: "utente di sistema",
    originDirect3:
      " (non scade) con i permessi di WhatsApp. In questa modalità conviene configurare anche l'App Secret per la firma del webhook.",
    originAgencyTitle: "Modalità agenzia (Tech Provider)",
    originAgency1:
      "La tua agenzia esegue l'Embedded Signup sulla SUA piattaforma e il suo backend ottiene il token del cliente; te lo consegna per incollarlo qui. Il webhook si collega con l'",
    originAgencyWaba: "override per WABA",
    originAgency2: " (checklist di 5 passi nel README).",
    wabaPlaceholder: "ID dell'account WhatsApp Business",
    phoneIdPlaceholder: "ID del numero di telefono",
    tokenLabel: "Token di accesso",
    tokenPlaceholderSaved: "Salvato (…{{last4}}) — incollane uno nuovo per cambiarlo",
    tokenValid: "✓ Token valido per {{display}}. Ora puoi salvare.",
    noServer: "Nessuna connessione con il server",
    validationFailed: "La validazione non è riuscita",
    saveError: "Impossibile salvare la connessione",
    testing: "Verifica…",
    test: "Prova connessione",
    save: "Salva connessione",
    webhookTitle: "Webhook di WhatsApp",
    webhookDesc1:
      "Incolla questi valori nel pannello di Meta (modalità diretta) o usali nell'override del backend della tua agenzia (a livello WABA). ",
    webhookDescStrong: "Salva la connessione PRIMA di configurare il webhook:",
    webhookDesc2:
      " la verifica (handshake) funziona senza salvare, ma i messaggi si ricevono solo se la connessione è salvata — vengono instradati tramite il tuo Phone Number ID.",
    httpsWarning:
      "L'URL configurato non è https: Meta richiede https per i webhook. Imposta APP_BASE_URL con il tuo dominio pubblico.",
    urlLabel: "URL del webhook (callback URL)",
    copyUrl: "Copia URL",
    copiedUrl: "Copiato ✓",
    urlHelp:
      "L'URL contiene il token segreto nel percorso: trattalo come una password.",
    copyToken: "Copia verify token",
    copiedToken: "Copiato ✓",
    signatureActive:
      "Verifica della firma attiva (META_APP_SECRET configurato): ogni evento viene validato con x-hub-signature-256.",
    signatureInactive:
      "Nessun App Secret configurato: il webhook resta protetto dall'URL segreto (normale in modalità agenzia). Per il livello extra di firma, aggiungi META_APP_SECRET all'istanza.",
    wapi: {
      title: "Chiave Wapi di questa organizzazione",
      description:
        "Se la tua istanza usa il gateway Wapi, ogni organizzazione usa la PROPRIA chiave (hlp_live_…). Viene salvata cifrata e non viene mai più mostrata: vedi solo gli ultimi 4 caratteri.",
      forbidden:
        "Solo il proprietario o un amministratore dell'organizzazione gestisce la chiave Wapi.",
      gatewayOff:
        "Questa istanza non ha il gateway Wapi attivo (WAPI_BASE_URL): la chiave si può salvare, ma oggi non viene usata e tutto va diretto a Meta.",
      routing: {
        own_key: "Gli invii di questa organizzazione passano da Wapi con la sua chiave.",
        legacy_global:
          "Modalità legacy: questa organizzazione usa la chiave globale dell'istanza. Salva una chiave propria per non dipendere più da quella.",
        blocked:
          "Invii bloccati: l'istanza elenca più organizzazioni per Wapi e questa non ha una chiave propria. Salva qui sotto la sua chiave.",
        direct: "Gli invii di questa organizzazione vanno diretti a Meta.",
      },
      configured: "Chiave salvata (…{{last4}})",
      notConfigured: "Nessuna chiave propria",
      keyLabel: "Chiave Wapi",
      keyPlaceholder: "hlp_live_…",
      save: "Salva chiave",
      saving: "Salvataggio…",
      saved: "Chiave salvata ✓",
      saveError: "Impossibile salvare la chiave",
      invalidFormat: "La chiave deve iniziare con hlp_live_",
      remove: "Revoca chiave",
      confirmRemove:
        "Revocare la chiave Wapi di questa organizzazione? Gli invii tramite Wapi si fermeranno finché non ne salvi un'altra.",
      removeError: "Impossibile revocare la chiave",
      loadError:
        "Impossibile caricare lo stato della chiave Wapi: ricarica la pagina.",
    },
  },
};
export default messages;
