# La Bambola — piano generale di migliorie

Richiesta di Stefano, notte del3novembre2026 (Europe/Rome). Obiettivo: un CRM/ARM completo per l'amministrazione e strumenti semplici per venditori, agenzie, equipaggio e passeggeri. Nessuna funzione dimostrativa deve essere presentata come realmente collegata se non lo è.

## Struttura che deve risultare immediatamente chiara

**Centro di gestione:** Panoramica, Calendario e tour, Contatti, Conversazioni, Vendite, Agenzie, Heili, Automazioni, Team, Impostazioni. Riutilizzare le sezioni CRM esistenti; aggiungere i moduli nautici. Niente pannelli informativi che prendano il posto delle funzioni vere. «Amministrazione» è un ruolo/area, non il nome di una persona.

**App equipaggio:** Oggi, Calendario, Scansiona, Attività. Il tour mostra orari, persone attese/a bordo/fuori barca, pasti e attrezzature da preparare, responsabili e note operative. Nessun prezzo, commissione, pipeline o configurazione. Azione principale: scansionare o cercare un passeggero e confermare il movimento.

**Area agenzia:** soltanto le proprie prenotazioni, partecipanti e stato di registrazione, link da condividere, materiale commerciale e commissioni. Accesso dopo approvazione. La registrazione di un affiliato non gli dà privilegi amministrativi.

**Pagina passeggero:** una pagina mobile breve, senza dover imparare il CRM o creare un account completo: dati personali, controllo dati, conferma e biglietto. L'accesso avviene tramite un link circoscritto alla prenotazione/tour.

## Flusso unico, tre modi per iniziare

1. **Cliente diretto:** il venditore conferma tour/data e prenotazione, copia un link per il gruppo. Ogni partecipante compila i propri dati. Il sistema associa automaticamente ogni registrazione alla prenotazione e al tour.
2. **Agenzia/tour operator:** l'agenzia approvata crea o riceve la propria prenotazione e condivide il suo link di gruppo. I passeggeri sono associati alla prenotazione e quindi all'agenzia. Non devono scegliere l'agenzia da una lista pubblica o scriverne il nome a mano.
3. **Compilazione assistita:** un venditore o un'agenzia autorizzata registra i partecipanti per loro conto, sullo stesso elenco e con gli stessi controlli. Il sistema registra chi ha compilato; la persona può verificare/correggere i dati entro le regole del tour. Nessun doppio passeggero se successivamente apre il link.

La vendita, i posti riservati, la registrazione anagrafica e il movimento di imbarco sono stati diversi. Quattro posti confermati possono avere soltanto due nominativi ancora compilati: visualizzare «2registrati su4attesi». Compilare un nominativo non deve vendere un secondo posto. Il gruppo confermato limita atomicamente le registrazioni disponibili; richieste oltre i posti vanno gestite dall'amministrazione, mai assorbite silenziosamente.

Per gruppi privati usare la stessa logica: tour riservato, capienza e numero concordato, elenco da completare. Per tour aperti sommare le prenotazioni confermate mantenendo il tetto130 e le regole già presenti.

## Dati di ogni passeggero

Nome; cognome; tipo e numero documento (cédula venezuelana come scelta iniziale, alternativa per altri documenti); data di nascita; email; numero WhatsApp con prefisso. La richiesta attuale include tutti questi dati; eventuali eccezioni operative per minori o persone senza contatti personali devono essere definite prima del rilascio, con riferimento al referente del gruppo e senza inventare email o telefoni.

Nome e cognome separati, documento trattato come stringa, data di nascita come data civile senza fuso. Valori verificabili e messaggi di errore brevi. La data di nascita è un nuovo campo da aggiungere al contratto attuale: non dichiararla già salvata. Conservare compatibilità dei nominativi esistenti, senza separare automaticamente i cognomi con ipotesi arbitrarie.

Il QR contiene solo un identificativo non prevedibile; nessuna cédula, email, data di nascita o telefono in chiaro. L'equipaggio vede solo i dati necessari alla verifica e al servizio. Dati completi ed esportazione nominativa riservati ai ruoli autorizzati. Formato richiesto dalla Capitaneria da verificare con l'operatore; non dichiarare conformità normativa non verificata. Consenso commerciale distinto dalla registrazione al viaggio.

## Collegamenti, ruoli e sicurezza pratici

- Gerarchia organizzazione → tour → prenotazione/gruppo → passeggeri. Agenzia e venditore sono attributi della prenotazione; non parametri liberamente modificabili dall'utente pubblico.
- Link di gruppo con scadenza/revoca, token opaco e limite posti; dopo la prima registrazione, accesso individuale per verificare dati e biglietto. Il link di gruppo non mostra l'anagrafica degli altri partecipanti.
- Invito del team da una schermata unica: nome, ruolo, contatto e «Copia invito». Invio WhatsApp/email come fase successiva a collegamento verificato, con anteprima e autorizzazione. Stato invitato/attivo/revocato; invito monouso/scaduto; nessuna password condivisa.
- Ruoli da rendere comprensibili: amministrazione, vendite, contabilità, equipaggio, agenzia. Introdurre solo i permessi necessari, con test server: nascondere un pulsante non basta. Soltanto un ruolo autorizzato può attribuire ruoli superiori. Non cambiare automaticamente l'account dell'amministratore durante un'anteprima equipaggio.
- Revoca di un membro, agenzia o invito effettiva anche nelle API; isolamento fra organizzazioni e fra agenzie; registrazione modificabile solo secondo stato del tour e permessi.

## Agenda e automazioni

Specifiche dettagliate in [AGENDA-AUTOMATICA-PLAN.md](AGENDA-AUTOMATICA-PLAN.md): Oggi/3giorni/7giorni/Mese, tap per creare, modifica nella scheda del tour, preset pasti e attrezzature, attività assegnate e riepiloghi automatici. Sostituire la vista dei soli50tour con interrogazione per intervallo, senza nascondere tour futuri o mostrare liste parziali come complete.

WhatsApp, testo e audio possono alimentare il collegamento contatto-prenotazione, le quantità e le note. Esempio: due persone e due paelle per sabato producono una richiesta collegata a quel tour; dopo conferma entrano nei totali. Una correzione aggiorna la stessa prenotazione. Heili domanda soltanto quando non può identificare con certezza tour, gruppo o variazione. Note e foto utili sono collegate al gruppo o alla lavorazione operativa pertinente, con visibilità limitata.

Automazioni prioritarie: richiesta di completamento dati; promemoria partenza con luogo/orario; riepilogo equipaggio; variazione del tour; richiesta feedback dopo il rientro. Prima implementare e provare bozze e anteprime con dati sintetici, poi attivare soltanto canali, consenso e regole effettivamente configurati. Nessun invio reale è autorizzato dal solo inserimento di una voce nel piano.

## Affiliazione e amministrazione

Registrazione agenzia automatica, accesso solo dopo approvazione; tag CRM dedicato e provenienza delle vendite. Materiale condivisibile e offerte segmentate, senza invii promozionali impliciti a chi si registra. Commissione10% sul tour effettivamente incassato, esclusi extra; rimborsi e annullamenti rettificano la base. Non sommare importi USD/VES senza una regola di conversione esplicita. Liquidazione sempre tracciata e approvata, nessun pagamento automatico in questo incremento.

## Ordine operativo

| Priorità | Consegna concreta | Prova di accettazione |
|---|---|---|
| P0 | Consolidare CRM originale e accessi; completare revisione pendente | Amministratore trova tutte le sezioni; equipaggio non legge CRM/contabilità; nessuna regressione Hair |
| P1 | Agenda quattro viste e creazione/modifica tour | Da un giorno vuoto creo un tour, inserisco gruppo/pasti/attrezzature, ricarico e ritrovo i dati |
| P1 | Link unico di gruppo, diretto o agenzia, e modulo completo | Due partecipanti si registrano da telefoni diversi e risultano nel gruppo/agenzia corretti senza vedere dati altrui |
| P1 | App equipaggio e inviti con copia link | Un nuovo membro accetta invito, apre il proprio tour, vede le attività e completa una scansione autorizzata |
| P2 | Riepiloghi automatici e modifiche simultanee | Prenotazione, calendario e due sessioni equipaggio mostrano gli stessi conteggi, anche dopo correzione/annullamento |
| P2 | ARM da testo/audio con approvazione mirata | Messaggi duplicati non duplicano posti; ambiguità non modificano il tour sbagliato; storico e fonte consultabili |
| P3 | Portale affiliati, commissioni e automazioni attive | Agenzia vede solo le proprie vendite; commissione esclude extra/rimborsi; invii collaudati e autorizzati |

L'ordine è una sequenza di consegne verificabili, non una promessa che tutti i moduli saranno online al mattino. Riutilizzare componenti, autenticazione, registro movimenti e servizi; evitare una seconda applicazione separata dal sistema centrale.

## App Android collegata al sistema centrale

PWA con icona La Bambola, accesso personale e apertura diretta all'area equipaggio. Percorso guidato per aggiungerla alla schermata iniziale, da collaudare su Android fisico. Tutti i dati vengono dal backend centrale; aggiornamenti propagati dopo i salvataggi, ricarica automatica come ripiego. Nessun archivio di passeggeri duplicato sul telefono e nessuna sincronizzazione manuale.

Scansione: apri tour → Scansiona → scheda nominativo/stato → Conferma imbarco. Segnalazioni chiare per tour diverso, documento incompleto, già imbarcato e codice non valido. Ricerca per nome/codice quando la fotocamera non funziona. Senza rete: indicare impossibilità di confermare, conservare l'incertezza e applicare il percorso di riconciliazione già previsto, senza verde ingannevole. Rientro e sbarco restano distinti.

## Collaudo e presentazione a papà

Tre percorsi con persone inventate: vendita diretta per due persone e due paelle; agenzia con gruppo da quattro e due registrazioni completate; equipaggio che controlla preparazione e biglietto. Verificare nome/cognome/cédula/data nascita/contatti, cambio tour, posto pieno, doppio tap, QR duplicato, link scaduto, accesso agenzia estranea e modifica concorrente. Android fisico, camera e installazione sono test reali separati dal viewport simulato.

Mostrare sempre cosa è già funzionante, cosa è pronto solo localmente e cosa è ancora progetto. Il percorso dimostrativo è in [DEMO-PAPA.md](DEMO-PAPA.md). Non costruire schermate finte presentate come integrazioni attive.

## Stato della sessione

Il recupero CRM è salvato nel commit locale9fb505c: build e test automatici completati, collaudo UI parziale. La revisione indipendente finale è fallita per quota di utilizzo del revisore richiesto, non per un verdetto positivo o negativo sul codice. Il nuovo controllo di build isolato è preparato ma non ancora approvato/eseguito. La versione online non è stata aggiornata da questo ciclo; Hair è rimasto intatto. Le funzioni nuove di questo piano richiedono design/review e non sono implementate. Nessuna automazione notturna è stata riattivata e nessun lavoro in background viene promesso oltre la sessione attiva.
