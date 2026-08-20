import type base from "../es/settings";

/** Dizionario IT — schermate delle impostazioni. */
const messages: typeof base = {
  title: "Impostazioni",
  tabs: {
    whatsapp: "WhatsApp",
    branding: "Marchio",
    templates: "Modelli",
    team: "Team",
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
    reconnectTitle: "Il token di WhatsApp è scaduto o è stato revocato.",
    reconnectBody:
      "Gli invii sono in pausa. Incolla un nuovo token qui sotto e prova la connessione per riconnetterti.",
    connectedNumber: "Numero connesso: {{number}}",
    tokenTail: "token …{{last4}}",
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
  },
};
export default messages;
