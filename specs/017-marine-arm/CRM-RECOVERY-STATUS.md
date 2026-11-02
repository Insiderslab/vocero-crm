# La Bambola: recupero del CRM

## Risultato locale

La navigazione amministrativa riutilizza il CRM originale: contatti, conversazioni, pipeline, Heili, automazioni, laboratorio e impostazioni WhatsApp. Tour e calendario si aggiungono a queste sezioni. L'app equipaggio resta separata nella presentazione, con gli stessi controlli server sui ruoli.

L'equipaggio dispone di calendario, scansione e ricerca biglietto, conferma esplicita del movimento e dettagli del tour. Le attività possono essere assegnate a una membership effettiva della stessa organizzazione. I vecchi nomi liberi rimangono visibili come assegnazioni non verificate. Le sezioni usano nomi di ruolo, senza riferimenti a persone.

Il pilota conserva il divieto di invii, collegamenti a provider e dati reali. La schermata WhatsApp è visibile e dichiara che il collegamento è disattivato. Le affiliazioni con approvazione e commissione del 10% sul tour incassato, esclusi extra, rimangono nel backlog: non sono implementate da questa consegna.

## Prove

- Build di produzione finale: exit 0, 90,78 secondi, build ID `XOrloegVwcsOIZwhaBxq8`.
- Test unitari: 152/152 su 20 file. Le due regressioni emerse nei tentativi precedenti sono documentate nel registro e corrette.
- Gateway: 4 test statici superati; adattamento con il binario Caddy effettivo superato. Non equivale a una prova HTTP del gateway pubblicato.
- Profilo standard: la stessa build avviata separatamente conserva il link di registrazione nella pagina di login. Processo di prova terminato.
- API e browser: collaudo in corso su PostgreSQL e app isolati, soltanto fixture sintetiche. I risultati parziali non vengono presentati come collaudo concluso.
- Android fisici, installazione PWA e prove con operatori reali: non eseguiti.

## Revisione e rilascio

La revisione del design EGM a cinque stadi è conclusa. La revisione Claude consente la prosecuzione locale con condizioni; non approva la pubblicazione. La revisione indipendente del diff e delle prove finali resta necessaria.

La versione pubblica non è stata aggiornata da questo ciclo. Il vecchio controllo di rilascio rileva correttamente che la configurazione condivisa e Hair sono cambiati da un'altra attività. Non è stato aggirato o azzerato. Una nuova fotografia in sola lettura conferma il nuovo stato; un controllo separato di build è in preparazione. Nessuna configurazione, container o dato di Hair è stato modificato da questo lavoro.

Le evidenze tecniche complete sono nella directory privata `C:/Users/stefa/bambola-runtime/crm-qa`. Credenziali, cookie e codici dei biglietti non vengono copiati nei rapporti del repository.
