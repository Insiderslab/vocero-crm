# Agenda operativa e aggiornamento automatico — piano di lavoro

Richiesta di Stefano, 3 novembre 2026, Europe/Rome. Questo documento aggiunge il prossimo incremento al recupero del CRM La Bambola; non sostituisce CRM, ARM, automazioni o impostazioni. È un progetto da revisionare prima dell'implementazione, non una funzione già pubblicata.

## Risultato atteso

Una sola agenda mostra tour, prenotazioni e lavoro da preparare. L'amministrazione può creare e modificare dal calendario; l'equipaggio vede una scheda semplice con orari, passeggeri, pasti, attrezzature, incarichi e scansione QR. Un aggiornamento della prenotazione modifica automaticamente tutte queste viste.

Esempio: un contatto scrive «siamo in due sabato, due paelle». Heili collega il contatto alla prenotazione e al tour identificato, registra due posti e due paelle. Se la prenotazione è confermata, questi valori entrano nei totali confermati del tour. Una richiesta non confermata resta visibile separatamente. «Alla fine siamo tre, ma sempre due paelle» modifica la stessa prenotazione a tre posti e due pasti. «Spostiamoci a domenica» sposta la prenotazione e i suoi extra al tour confermato di domenica, sottraendoli da quello precedente. Non duplica contatto, prenotazione, posti o ordini.

## Priorità 1 — calendario utilizzabile

- Selettore Hoy / 3 días / 7 días / Mes, navigazione precedente/successivo e ritorno a oggi, fuso America/Caracas.
- Tap su una giornata o fascia libera apre «Nuevo tour», con data già compilata. Campi: titolo, orari, aperto/privato, capienza fino a130, passeggeri previsti e note. Se è un gruppo, il numero iniziale crea una prenotazione provvisoria associabile al contatto, non un totale indipendente dai posti venduti.
- Tap su un tour apre una scheda laterale su desktop e a tutta altezza su mobile; modifica senza cambiare sezione. Salvataggio esplicito con conferma visibile, errori e retry senza duplicati.
- Ogni tour mostra orario, posti confermati/capienza, richieste da confermare e riepilogo pasti/attrezzature. Stato espresso con testo oltre al colore.
- Vista mobile predefinita oggi, pulsanti grandi, dettagli progressivi. Nei7giorni evitare sette colonne illeggibili: giorni selezionabili e lista leggibile mantenendo l'intervallo visibile. Mese come panoramica con dettaglio del giorno selezionato.

## Priorità 2 — comandi e preparazione dal calendario

Preset modificabili: paella (quantità), materasso galleggiante (sì/no e quantità se pertinente), altri pasti, altre attrezzature, assistenza a bordo. Per ogni voce: quantità, note, responsabile selezionato dal team e stato da fare/in corso/fatto. Nessuna persona codificata nel nome di una sezione.

Distinguere richieste delle prenotazioni e preparazione organizzata per il tour: 12 paelle ordinate e15 da preparare sono valori diversi, non due registrazioni da sommare. Le attrezzature disponibili per il tour e quelle richieste dai clienti devono restare distinguibili. Le correzioni manuali sono tracciate e non vengono sovrascritte silenziosamente da una successiva estrazione.

## Priorità 3 — collegamento ARM e aggiornamenti automatici

- Collegamenti espliciti organizzazione → tour → prenotazione → contatto/gruppo → passeggeri → extra, note e allegati. Collegare al tour esatto, non soltanto alla data; una giornata può avere più partenze. Un lead non diventa automaticamente un passeggero registrato.
- Da una prenotazione confermata o da una registrazione valida, aggiornare subito i riepiloghi. Da chat/testo/audio estrarre data, tour, numero persone e richieste; applicare automaticamente soltanto dati espliciti, attribuiti alla prenotazione corretta e compatibili con stato e disponibilità. Per ambiguità o conflitti, una proposta in attesa con una domanda mirata.
- Foto e note pertinenti restano collegate alla prenotazione e visibili nel dettaglio autorizzato. Una foto non dimostra da sola quantità o conferma di acquisto. Audio: conservare il collegamento al messaggio e la trascrizione verificabile, senza inventare dati mancanti.
- Deduplicazione per messaggio/evento e comando; gestire notifiche ripetute, messaggi in ritardo, correzioni e annullamenti. Conservare provenienza e cronologia, senza mostrare dettagli tecnici all'equipaggio.
- Totali calcolati lato server dalle stesse prenotazioni; notifica di modifica alle viste aperte e ricaricamento automatico come ripiego. Al ritorno online ricaricare lo stato autorevole: nessun imbarco o salvataggio dichiarato riuscito mentre è incerto.
- Il calendario rimane utilizzabile manualmente anche senza WhatsApp. Il collegamento reale richiede un'integrazione funzionante: nel pilota attuale i provider e gli invii sono disattivati. Non promettere acquisizione WhatsApp attiva dalla sola schermata di configurazione.

## Riuso e modifiche necessarie

Riusare MarineApp, il calendario mensile esistente, Luxon, transazioni e idempotenza del backend marine, prenotazioni, servizi con bookingId, assegnazioni per membership, QR e proiezioni per ruolo. Nessuna nuova libreria necessaria per il primo incremento. La logica generica resta riutilizzabile; i preset nautici sono configurazione del modulo.

Il calendario attuale riceve al massimo50tour e limita i mesi a quelli caricati: non basta per il nuovo comportamento. Progettare una query per intervallo con risultati completi/paginati e riepiloghi server, navigazione nei mesi futuri anche vuoti, filtri di organizzazione e proiezione sicura per equipaggio. Una vista limitata non deve sembrare completa.

Nuovi contratti da revisionare: modifica del tour e delle quantità con controllo versione; differenza fra preventivo/conferma/registrazione; extra e disponibilità; collegamento fra eventi ARM e prenotazioni; aggiornamenti simultanei. Preservare capienza130, conflitti fra tour della stessa barca, idempotenza, isolamento tra organizzazioni e regole di check-in/check-out. Commissione agenzia10% solo sul tour incassato, mai su paelle o altri extra; il portale affiliati resta un incremento separato.

## Ordine di esecuzione e collaudo

1. Completare la revisione indipendente del recupero CRM e del rilascio isolato; preservare la versione pubblica finché i controlli non passano.
2. Revisionare il design dell'agenda e dei nuovi contratti, poi implementare le quattro viste e creazione/modifica con dati sintetici.
3. Aggiungere preset e riepiloghi derivati dalle prenotazioni; verificare aggiornamento fra amministrazione ed equipaggio in due sessioni.
4. Collegare l'estrazione ARM in simulazione: 2posti+2paelle; modifica3posti+2paelle; cambio data; annullamento; messaggio duplicato; ordine fuori sequenza; data ambigua; capienza superata; operatore e agente che modificano insieme.
5. Provare touch a320/390px, tastiera, rete interrotta, ripresa e doppio tap. Verificare calendario e ordini dopo ricarica, non soltanto un toast. Android fisico e prova con equipaggio restano prove separate da effettuare realmente.
6. Rilasciare soltanto La Bambola dopo le revisioni e prove obbligatorie; verificare TLS, ruoli, profilo marine e integrità degli altri servizi. Niente messaggi reali, pagamenti o dati passeggeri durante i collaudi.

## Blocco operativo attuale

La revisione indipendente finale del ciclo corrente e il collaudo UI sono stati interrotti dal limite di utilizzo del modello previsto. Non sono approvati per questo motivo. Nessun modello sostitutivo o limite è stato aggirato. Si può completare la progettazione, ma pubblicazione e lavoro dipendente dalla revisione restano sospesi finché il revisore richiesto è nuovamente disponibile. Nessuna nuova automazione notturna è stata creata da questo piano.
