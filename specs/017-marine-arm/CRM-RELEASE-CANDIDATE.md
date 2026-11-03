# Candidato di rilascio CRM — 3 novembre 2026

Richiesta attuale: proseguire sulla piattaforma e pubblicare la nuova versione; presentazione per il padre di Stefano in spagnolo. La pubblicazione resta già autorizzata. Nessuna nuova autorizzazione di deploy è richiesta.

## Artefatto concreto

Pacchetto locale immutabile: `C:/Users/stefa/bambola-runtime/releases/20261103-crm-r1`.
Manifesto SHA-256: `29982f7312b6bb2c38c38e2fe41b571c036de0a733649537fd971567a3482d4f`.
536file, verificati da manifest.py. Provenienza: release precedente20261102-panels-r1, esattamente27file del nuovo overlay applicativo/gateway verificati per hash, più4file operativi/test. Il confronto dei manifesti mostra soltanto questi31file differenti. Nessun prelievo indiscriminato dal working tree con modifiche ereditate.

Non è stata costruita una nuova immagine Docker remota, né trasferito o attivato il pacchetto sul VPS. Il guardrail nuovo è soltanto per la build: non comprende un esecutore di rollout o rollback. Una procedura di attivazione con confronto dei cambiamenti attesi resta necessaria e va revisionata; non si può usare il vecchio ripristino della configurazione condivisa.

## Evidenze aggiornate

- Build locale di produzione e prove automatiche già documentate; codice invariato durante la ripresa.
- Creazione contatto: il modulo rifiutava il segno+ nel numero del test e mostrava la validazione. Corretto soltanto il dato sintetico del collaudo, usando cifre e prefisso; contatto ora verificato tramite ricerca prima e dopo ricarica. Screenshot `crm-qa/evidence/contact-create-after-reload.png` ispezionato dal coordinatore. Non era una prova di salvataggio riuscito nei tentativi precedenti. Accettare anche numeri incollati con+ rimane una miglioria UX da valutare, non introdotta di nascosto.
- Predisposto un tour UX separato con gruppo2, passeggera inventata registrata, due paelle assegnate alla membership corrente ed equipaggiamento non assegnato. Solo database QA locale; nessun altro tour o membro modificato. Codici e credenziali restano esclusi dai documenti.
- Verifica pubblica in sola lettura: Bambola /nautica200, Hair /oggi porta al login200 con TLS verificato. Nessun cambio remoto da questa sessione.
- Snapshot remoto23:36:53UTC: configurazione condivisa invariata rispetto al precedente controllo; Hair è stato aggiornato da un'altra attività alle23:07:01UTC e risulta healthy; il suo builder risulta exited. Baseline da acquisire sullo stato attuale prima di una build, non ripristinare il vecchio container Hair.

## Revisione

Il controllo di disponibilità in contesto fresco del revisore previsto ha risposto AVAILABLE; non è una review né approvazione. Richiesta all'owner un'estensione circoscritta di2review,20minuti e un eventuale ciclo di correzione per recuperoCRM/rilascio, come imposto dal limite della policy. L'estensione è in attesa di risposta; non è dedotta dal passare del tempo. Non avviate review sostanziali fuori budget. La presentazione `DEMO-PAPA.md` è stata riscritta in spagnolo.

## Sequenza proposta per l'attivazione, da revisionare

1. Approvare diff applicativo, risultati e nuovi guardrail; congelare eventuali correzioni in un nuovo candidato, senza sovrascrivere r1.
2. Trasferire esclusivamente il candidato verificato sotto `/opt/bambola-arm/releases/20261103-crm-r1` e verificarne di nuovo il manifesto. Vietato usare il working tree come sorgente remota o includere segreti.
3. Acquisire baseline nuova con crm_host: hash/inode configurazione condivisa, identità e salute degli altri container, reti/porte e risposte HTTPS. Conservare le vecchie evidenze. La baseline lega manifest e proprio hash; una variazione inattesa interrompe il processo.
4. Eseguire build_crm con manifesto e baseline bloccati, immagine Node immutabile prevista dal helper e risorse già limitate. Verificare identità immutabile dell'immagine risultante e rimozione del solo builder Bambola. Nessuna chiamata al vecchio host.py rollback.
5. Predisporre un override dedicato e nuovo, con immagine app verificata e `APP_WORKSPACE=marine`. Riutilizzare i soli segreti già esistenti di Bambola senza stamparli. Nessun provider o pagamento. Preparare il nuovo gateway da template con IP esatto del proxy condiviso, salvato come file nuovo immutabile; non sovrascrivere gateway precedente o Caddy condiviso.
6. Validare l'override mantenendo le reti interne e nessuna porta host pubblicata; controllare che le sole differenze attese siano immagine/profilo app e mount della configurazione del gateway. Preservare DB, volumi, risorse, altri servizi e impostazioni di sicurezza. Non stampare un `docker compose config` con valori di credenziali.
7. L'attivatore deve verificare la baseline immediatamente prima della mutazione e applicare soltanto i servizi `app gateway` del progetto fisso `bambola-arm`, con `up -d --no-deps` e file assoluti verificati. Vietati down, prune, orphan removal, restart o reload di altri servizi. L'attivatore e il suo confronto delle modifiche attese non sono ancora implementati/approvati.
8. Dopo l'attivazione verificare immagini/configurazione attese, profilo marine, salute, isolamento, TLS, accessi e negativi del gateway, sessioni, aggiornamenti e flusso di biglietto con fixture. Il confronto post-rilascio deve ammettere soltanto le modifiche attese e verificate dei due container Bambola; non un generico flag che ignori tutte le loro differenze. Tutti gli altri servizi e la configurazione condivisa devono corrispondere alla nuova baseline.
9. In caso di fallimento, ripristinare esclusivamente le versioni precedenti dei due servizi Bambola con override/configurazioni conservati, solo dopo controllo dello stato esterno. Se sono intervenute modifiche concorrenti, fermarsi senza scritture di ripristino sugli altri servizi. Consegnare URL e accessi solo quando i controlli pubblici sono realmente passati.

Questa sequenza non è uno script eseguito e non equivale ad approvazione. L'autorizzazione owner alla pubblicazione è già presente; restano le revisioni e verifiche tecniche elencate.

## Chiusura del collaudo indipendente dalla review

Rapporto completo privato: `C:/Users/stefa/bambola-runtime/crm-qa/usability-report.md`. Contatto creato e ritrovato dopo ricarica verificato; navigazione CRM e diniego equipaggio verificati; calendario/dettagli e paella2 assegnata al membro corrente verificati nella fixture nuova. Cambio stato attività e scansione/ricerca manuale/conferma movimento nella nuova UI restano non eseguiti dopo fallimenti dei locator del collaudo; non sono trasformati in pass. Nessun movimento di imbarco effettuato dalla prova UI. Browser di test chiusi. Nessun aggiornamento pubblico in questo turno e nessuna review finale iniziata fuori dal budget: l'estensione richiesta rimane in attesa.

## Ripresa autorizzata, candidato r3 (sostituisce gli stati precedenti)

L'estensione è stata approvata da Stefano: due revisioni, venti minuti, un solo ciclo correttivo. Claude ha completato la prima review in 275.84 secondi; esito condizionato alla correzione della procedura operativa. Correzioni completate e 45 test mirati passati. La seconda e ultima review Sol è iniziata il 3 novembre alle 00:33 UTC in contesto nuovo; massimo residuo 924.16 secondi.

Artefatto r3 immutabile, 538 file, manifesto d4c1de657f7e866b024d5c6106ae2c28a035d000e8ec06bc5c56087be0849c76. Verificato localmente e dopo trasferimento in /opt/bambola-arm/releases/20261103-crm-r3. Baseline nuova acquisita senza modificare le precedenti: SHA256 5096137bffd49af345d700784900146bafdec6e643f18c260c0eedffc6e34408. Build privata remota avviata con limiti 1CPU/2GB e controllo continuo degli altri servizi. Nessuna attivazione ancora eseguita.

Ora sono presenti crm_rollout.py e test del flusso di attivazione/ripristino. Il codice mantiene i soli servizi Bambola app/gateway come bersagli, usa i file Compose precedenti per rollback, aspetta salute e verifica separatamente la nuova destinazione /dashboard. Le dichiarazioni precedenti di helper non implementato o review in attesa di autorizzazione sono superate da questo aggiornamento.

Test UI locali: paella assegnata, cambio stato persistente, camera negata con fallback, ricerca manuale, imbarco esplicito, persistenza e duplicati completati. Android fisico e uso umano restano non provati. L'API di creazione membri è owner-only, usa signup interno senza callback di verifica/invio email (auth/index.ts e on-signup.ts ispezionati); nessun invito o messaggio è stato inviato.
