import type { LegalMessages } from "@/lib/legal";

/**
 * Pagine pubbliche: privacy, termini, cancellazione dei dati. BOZZA da far
 * rivedere a un avvocato prima del lancio commerciale (la nota sta in
 * docs/lavoro/2026-10-10-app-review.md, non nella pagina). {{entity}},
 * {{email}} e {{product}} si riempiono con legalContext().
 */
const legal: LegalMessages = {
  chrome: {
    skipToContent: "Vai al contenuto",
    lastUpdated: "Ultimo aggiornamento",
    draftLabel: "bozza",
    draftNotice: "Documento in revisione legale",
    nav: "Informazioni legali",
    privacy: "Informativa sulla privacy",
    terms: "Termini del servizio",
    deletion: "Cancellazione dei dati",
    login: "Accesso",
  },
  privacy: {
    title: "Informativa sulla privacy",
    summary:
      "Come {{product}} tratta i dati degli account utente e delle conversazioni WhatsApp (Instagram e Messenger: in arrivo) che le aziende gestiscono con il servizio.",
    sections: [
      {
        title: "1. Chi è il titolare",
        body: [
          "{{product}} è un CRM di messaggistica per le aziende, offerto da {{entity}} («noi»). Contatto per ogni questione di privacy: {{email}}.",
          "Ci sono due tipi di dati, con ruoli diversi. Per i dati degli account utente (chi accede al CRM) siamo titolari del trattamento. Per i dati delle persone che scrivono a un'azienda su WhatsApp (e, in arrivo, su Instagram o Messenger), il titolare è l'azienda cliente che usa {{product}}; noi agiamo come responsabili del trattamento e seguiamo soltanto le sue istruzioni.",
        ],
        list: [],
      },
      {
        title: "2. Quali dati trattiamo",
        body: ["In base all'uso che ne fa ogni azienda:"],
        list: [
          "Utenti del CRM: nome, indirizzo email, password (conservata solo come impronta cifrata, mai in chiaro), ruolo nell'azienda e dati di sessione (indirizzo IP e browser).",
          "Contatti e conversazioni: nome del contatto, identificativo del canale (numero WhatsApp o identificativo utente assegnato da Meta), contenuto dei messaggi, allegati, data e stato di consegna.",
          "Dati che l'azienda aggiunge: note, etichette, fasi della pipeline commerciale e schede di qualificazione.",
          "Collegamento con Meta: identificativi dell'account aziendale collegato (per esempio WhatsApp Business e numero di telefono) e la credenziale di accesso che Meta concede all'azienda. La credenziale è conservata cifrata e non viene mai mostrata per intero.",
          "Solo se l'azienda collega il numero della sua app WhatsApp Business al CRM (coexistence) e lo sceglie nella finestra di Meta: lo storico delle chat di quell'app (fino a 6 mesi) e i nomi della rubrica dell'app. La rubrica serve solo a dare un nome ai contatti che scrivono all'azienda: non crea contatti né conversazioni.",
        ],
      },
      {
        title: "3. Perché li usiamo",
        body: [
          "Solo per fornire il servizio che l'azienda ha scelto: ricevere i messaggi dei suoi clienti, permetterle di rispondere, organizzare contatti e opportunità, e mantenere la sicurezza e il buon funzionamento della piattaforma.",
          "Base giuridica: l'esecuzione del contratto con l'azienda cliente, il nostro legittimo interesse alla sicurezza del servizio e, per i dati dei suoi clienti finali, la base stabilita dall'azienda titolare (per esempio il consenso o il rapporto contrattuale).",
        ],
        list: [],
      },
      {
        title: "4. Con chi condividiamo i dati",
        body: [
          "Non vendiamo i dati e non li usiamo per la pubblicità. Intervengono solo questi soggetti terzi:",
        ],
        list: [
          "Meta Platforms (WhatsApp; Instagram e Facebook Messenger: in arrivo): attraverso i canali che l'azienda collega, riceviamo e inviamo messaggi tramite le loro interfacce ufficiali.",
          "Fornitore di infrastruttura e hosting: dove girano l'applicazione e il database; agisce come responsabile del trattamento.",
          "Fornitore di modelli linguistici (compatibile con OpenRouter): solo se l'azienda attiva l'agente AI, il contenuto delle conversazioni necessario a redigere una risposta viene inviato a quel fornitore. Se l'azienda non lo attiva, nessun contenuto esce verso un'AI.",
        ],
      },
      {
        title: "5. Dati ricevuti da Meta",
        body: [
          "I dati che arrivano dalle API di Meta si usano soltanto per le funzioni richieste dall'azienda (ricevere e rispondere ai messaggi e gestire i suoi contatti). Non si vendono, non si usano per la pubblicità né per creare profili estranei al servizio, e non si trasferiscono a terzi, salvo i responsabili indicati sopra.",
        ],
        list: [],
      },
      {
        title: "6. Per quanto tempo li conserviamo",
        body: [
          "Conserviamo i dati finché l'account dell'azienda è attivo. Alla fine del contratto, o quando riceviamo una richiesta di cancellazione valida, li eliminiamo nei tempi descritti nella pagina di cancellazione dei dati. Alcuni dati possono essere conservati più a lungo solo se lo impone una legge.",
        ],
        list: [],
      },
      {
        title: "7. Sicurezza",
        body: [
          "Ogni azienda vede soltanto i propri dati: l'accesso è separato per organizzazione. Le credenziali dei canali sono cifrate a riposo e le comunicazioni usano HTTPS. Nessuna misura è infallibile: se rileviamo una violazione dei dati che ti riguarda, interverremo e la comunicheremo come richiede la legge.",
        ],
        list: [],
      },
      {
        title: "8. I tuoi diritti",
        body: [
          "Puoi chiedere accesso, rettifica, cancellazione, limitazione od opposizione al trattamento e la portabilità dei tuoi dati, e presentare reclamo all'autorità di protezione dei dati del tuo Paese (in Italia, il Garante per la protezione dei dati personali). Se sei cliente finale di un'azienda, rivolgi prima la richiesta a quell'azienda; se scrivi a {{email}} gliela inoltreremo. Per chiedere la cancellazione segui la pagina «Cancellazione dei dati».",
        ],
        list: [],
      },
      {
        title: "9. Cookie",
        body: [
          "Usiamo solo cookie tecnici: la sessione di accesso e le tue preferenze di lingua e tema. Non usiamo cookie pubblicitari né di analisi di terze parti.",
        ],
        list: [],
      },
      {
        title: "10. Modifiche",
        body: [
          "Se cambiamo questa informativa, pubblicheremo la nuova versione in questa pagina con la data di aggiornamento.",
        ],
        list: [],
      },
    ],
  },
  terms: {
    title: "Termini del servizio",
    summary:
      "Condizioni d'uso di {{product}}, il CRM di messaggistica per WhatsApp (Instagram e Messenger: in arrivo).",
    sections: [
      {
        title: "1. Oggetto",
        body: [
          "{{product}} è un servizio di {{entity}} che permette a un'azienda di ricevere e gestire le conversazioni dei propri clienti su WhatsApp (e, in arrivo, su Instagram e Messenger), organizzare contatti e opportunità e, se lo attiva, avvalersi di un agente AI. Usandolo accetti questi termini a nome tuo e dell'azienda che rappresenti.",
        ],
        list: [],
      },
      {
        title: "2. Account",
        body: [
          "L'accesso avviene su invito o con registrazione autorizzata. Sei responsabile della custodia delle tue credenziali e di ciò che si fa con il tuo account. Devi avere la capacità di vincolare l'azienda che rappresenti.",
        ],
        list: [],
      },
      {
        title: "3. Canali e piattaforme di terzi",
        body: [
          "Colleghi i tuoi account aziendali di Meta. Ti impegni a rispettare i termini e le policy di Meta applicabili, in particolare quelli di WhatsApp Business e della piattaforma Meta. Meta può limitare, sospendere o modificare i suoi servizi, la finestra di 24 ore o i modelli di messaggio: non controlliamo queste decisioni e non ne rispondiamo.",
        ],
        list: [],
      },
      {
        title: "4. Responsabilità sulle tue comunicazioni",
        body: ["Sei responsabile delle tue conversazioni e, in particolare, devi:"],
        list: [
          "avere una base giuridica valida e, quando serve, il consenso preventivo delle persone a cui scrivi in messaggistica;",
          "informare i tuoi clienti su come tratti i loro dati;",
          "inviare solo messaggi legittimi e rispettare le revoche e le opposizioni.",
        ],
      },
      {
        title: "5. Uso consentito",
        body: ["È vietato usare il servizio per:"],
        list: [
          "inviare spam, messaggi ingannevoli o di massa senza consenso;",
          "contenuti illegali, offensivi, discriminatori o che violano diritti di terzi;",
          "tentare di accedere ai dati di altre organizzazioni, aggirare i controlli di sicurezza o sovraccaricare il servizio;",
          "rivendere l'accesso senza un accordo scritto.",
        ],
      },
      {
        title: "6. Agente AI",
        body: [
          "L'agente AI è facoltativo e lo attiva e supervisiona l'azienda. Le sue risposte possono essere errate o incomplete: decidi tu quando usarlo, puoi passare una conversazione a una persona e sei responsabile di ciò che viene inviato ai tuoi clienti.",
        ],
        list: [],
      },
      {
        title: "7. Dati personali",
        body: [
          "Per i dati dei tuoi clienti finali sei il titolare del trattamento e noi siamo il responsabile, secondo l'informativa sulla privacy. Se ti serve, possiamo sottoscrivere un accordo sul trattamento dei dati (DPA).",
        ],
        list: [],
      },
      {
        title: "8. Disponibilità e garanzie",
        body: [
          "Ci impegniamo perché il servizio funzioni in modo continuativo, ma è offerto «così com'è», senza garanzia di disponibilità ininterrotta, di assenza di errori o di funzionamento dei servizi di terzi.",
        ],
        list: [],
      },
      {
        title: "9. Responsabilità",
        body: [
          "Nei limiti consentiti dalla legge, non rispondiamo di danni indiretti né di mancato guadagno, né di malfunzionamenti di piattaforme di terzi. Nulla di quanto sopra limita la responsabilità che la legge non permette di limitare.",
        ],
        list: [],
      },
      {
        title: "10. Sospensione e cessazione",
        body: [
          "Puoi smettere di usare il servizio quando vuoi. Possiamo sospendere un account che violi questi termini o metta a rischio la sicurezza. Alla cessazione, i tuoi dati sono trattati come indicato nell'informativa sulla privacy e nella pagina di cancellazione dei dati.",
        ],
        list: [],
      },
      {
        title: "11. Modifiche e legge applicabile",
        body: [
          "Possiamo aggiornare questi termini e pubblicheremo qui la nuova versione. Sono regolati dalla legge italiana, fatti salvi i diritti inderogabili che ti spettano secondo il tuo Paese. Contatto: {{email}}.",
        ],
        list: [],
      },
    ],
  },
  deletion: {
    title: "Cancellazione dei dati",
    summary:
      "Come chiedere che cancelliamo i tuoi dati da {{product}}, e come revocare l'accesso che hai dato da WhatsApp (e, in arrivo, da Facebook o Instagram).",
    sections: [
      {
        title: "1. Come chiederla",
        body: [
          "Scrivi a {{email}} con oggetto «Cancellazione dei dati» e indica chi sei (il tuo nome e il canale con cui hai usato il servizio: numero WhatsApp o email del tuo account; in arrivo: account Instagram o Facebook) e che cosa vuoi cancellare. Non inviare password o credenziali: non ci servono.",
          "Trattiamo le richieste manualmente. Per proteggere i tuoi dati possiamo chiederti una conferma di identità prima di cancellare qualsiasi cosa.",
        ],
        list: [],
      },
      {
        title: "2. Se hai scritto a un'azienda",
        body: [
          "Se sei cliente finale di un'azienda che usa {{product}}, quell'azienda è la titolare dei tuoi dati. Puoi chiederlo direttamente a lei; se scrivi a noi, le inoltreremo la richiesta e la eseguiremo su sua istruzione.",
        ],
        list: [],
      },
      {
        title: "3. Se hai collegato un account Meta",
        body: [
          "Puoi revocare in qualsiasi momento l'accesso che hai dato a {{product}} dal tuo account Facebook (in arrivo; integrazioni aziendali, oppure app e siti web) o Instagram (in arrivo; app e siti web); i nomi esatti dei menu possono variare. Dopo la revoca non possiamo più ricevere né inviare messaggi su quell'account. I dati già conservati non si cancellano da soli: chiedine la cancellazione come spiegato sopra.",
        ],
        list: [],
      },
      {
        title: "4. Che cosa cancelliamo",
        body: ["Quando accettiamo una richiesta cancelliamo, secondo il suo ambito:"],
        list: [
          "il contatto, le sue conversazioni, i messaggi e gli allegati;",
          "le note, le etichette e le opportunità collegate;",
          "l'account utente e le credenziali dei canali collegati, se l'account dell'azienda viene chiuso.",
        ],
      },
      {
        title: "5. Tempi ed eccezioni",
        body: [
          "Confermiamo la ricezione e completiamo la cancellazione entro 30 giorni. Possiamo conservare lo stretto necessario se lo impone una legge o per difendere diritti in un procedimento; in tal caso te lo spiegheremo. Le copie di sicurezza vengono eliminate al termine del loro ciclo di conservazione.",
        ],
        list: [],
      },
    ],
  },
};

export default legal;
