# La Bambola — piano operativo della notte1–2novembre2026

Fuso: Europe/Rome. Obiettivo autorizzato: ambiente online di prova raggiungibile dagli Android di Rosanni e dell'equipaggio, separato da Hair. Termine del ciclo notturno: revisione e rapporto alle07:00 del2novembre. Non promettere la pubblicazione se un controllo essenziale fallisce.

## Checkpoint programmati

Automazione della chat `la-bambola-lavoro-notturno-e-revisione-finale`, attiva; riprese alle00:00,02:00,04:00, revisione finale alle07:00. Scadenza temporale impostata al2novembre. Evitare sovrapposizioni con agenti/build già in corso. Disattivare solo questa automazione dopo completamento o rapporto finale. Il computer deve rimanere acceso, con Codex disponibile e senza sospensione; non modificare impostazioni energetiche automaticamente.

| Fase | Lavoro | Criterio di uscita |
|---|---|---|
| Ora / primo checkpoint | Chiudere le5fasi EGM sul confine pubblico e la verifica delle segnalazioni dipendenze; definire anche logout per telefoni condivisi | Review realmente completate, blocchi risolti, scope aggiornato |
| Rilascio privato | Pacchetto sorgenti con hash; runtime e DB nuovi, build limitata, account nuovi, dati PRUEBA | App sana solo su rete privata; signup chiuso; ruoli owner/admin/member verificati |
| Pubblicazione | Aggiunta solo del nuovo DNS e della rotta bambola.heili.cloud; HTTPS; nessun riavvio Hair | TLS valido, proxy e header verificati, invarianti Hair identiche |
| Collaudo | Accessi, registrazione, QR, imbarco/sosta/rientro/sbarco, servizi, permessi e guasti; viewport Android | Prove effettive, controlli negativi e backup/ripristino Bambola riusciti |
|07:00 | Revisione finale indipendente di codice/prove e rapporto | URL/accessi se online; elenco verificato di risultati, limiti e blocchi; nessun falso via libera |

Le fasi sono dipendenti: gli orari sono checkpoint, non un permesso di saltare review o test. Se non è possibile pubblicare, completare documentazione/prove indipendenti consentite e consegnare un blocco preciso, senza rendere pubblico un ambiente incompleto.

## Stato concreto al23:08 del1novembre

- Versione locale3130 funzionante, build passata,44unit/50HTTP/13staff-browser/5public-browser; prova130passeggeri completata. Vedi DELIVERY.md per limiti reali.
- Accesso SSH al solo VPS Ubuntu1899808/186.241.16.46 verificato con chiave esistente e StrictHostKeyChecking=yes. Nessun dato/servizio reale modificato. WordPress1845608/72.62.44.45 escluso.
- Hair healthy, propri container/volumi; gateway comune second-brain-caddy-1. Invarianti e metadati raccolti in online-pilot.md, da rileggere immediatamente prima di ogni mutazione.
- bambola.heili.cloud non presente nella zona osservata; nessun record aggiunto. Snapshot DNS193330099; originali disponibili in risposta Hostinger, da salvare/rileggere prima dell'aggiunta. Nessun acquisto.
- Preflight indipendente completato; percorso ridotto respinto e convertito in5fasi complete. Modello revisore gpt-5.6-sol ha fallito due incarichi per quota; il singolo retry fresco di stage5 (`bambola_online_zoom_retry`) sta lavorando e ha confermato le letture. Non considerare le chiamate fallite come review valide. Analisi indipendente dipendenze ancora non completata.
- Audit `pnpm audit --prod`:34segnalazioni,5critical/13high. Non è un audit verde. JSON in C:/Users/stefa/beauty-qa-runtime/marine-preview/dependency-audit-online.json. Il coordinatore ha consultato advisory primari su Better Auth OAuth/MagicLink, Drizzle identifiers, Zod e Vitest; precondizioni e raggiungibilità vanno confermate nel runner/gateway effettivo. Nessun upgrade eseguito.
- Nessun codice deployment scritto, immagine costruita, account online creato, DNS o Caddy modificato. Solo brief/reviewlog/registro locale aggiornati. `git fetch origin` riuscito; coordina non trova ancora il registro nel commit HEAD: serve regolarizzare commit/push del solo perimetro prima di implementare, senza includere modifiche Hair ereditate per errore.

### Avanzamento successivo nella stessa sera

Stage5 Zoom-Out completato nel retry: chiusa l'ambiguità sul proxy (online solo con catena provata e MARINE_TRUST_PROXY_IP=true), definito snapshot immutabile sottoposto a review prima di trasferimento/build, esplicitata gestione DNS/maintenance503 nel rollback. Stage6 Comprehension avviato come `bambola_online_comprehension`, ancora da acquisire prima di stage7. La quota non è risultata un blocco persistente nel retry; non cambiare modello senza autorizzazione.

Registro del perimetro committato e pushato da solo: commit `e44fdf0`, branch remoto `codex/bambola-arm` in Insiderslab/vocero-crm. Nessun altro file o modifica Hair inclusi nel commit. Il nuovo controllo coordina è stato avviato: acquisirne l'esito, senza assumere superamento.

Il controllo ha rilevato sovrapposizioni con modalita-ascolto/beauty-mvp su componenti,migrazioni,test epackage/lock. Owner informato; fermate modifiche su tali file. Perimetro ristretto ai soli specs/017-marine-arm/,deploy/marine/,scripts/marine-release-pack.mjs,src/app/nautica/. Codice funzionale già collaudato congelato come input in sola lettura: niente nuove modifiche ai file condivisi. Salir va implementato nella layout/componente esclusiva sotto src/app/nautica/, test in deploy/marine. Registro aggiornato con commit/push; verificare il nuovo esito coordina prima di implementare. Questa scelta evita una nuova richiesta di coordinamento all'owner senza scavalcare le assegnazioni altrui.

Stage6 completato: rapporto integrale con le due parafrasi in reviews/online-06-comprehension.md;5finding accettati e risolti documentalmente. Target aggiornato: gate advisory esplicito, stato Hair immutato e solo ingress additivo, manutenzione503 PRIMA di creare DNS (rollback senza cancellazioni DNS non verificate), consegna credenziali solo con SCP a cartella Windows ACL, logout esclusivo. Registro ristretto commit `b2b4361` pushato. Prossimo passo di review: stage7 Critic (design,structural,style in contesti freschi), poi8 Zoom-Out e9 Readiness; non saltare a implementazione. Retry indipendente dell'analisi dipendenze ancora disponibile una sola volta; precedente tentativo fallito per quota, nessun report valido. Conta attuale5invocazioni revisori (incluse2fallite), tutti i writer/servizi restano fermi fino al gate design. Nessun deploy o DNS eseguito.

Controllo finale coordinamento dopo il restringimento: `node scripts/coordina.mjs verifica` exit0, «OK: marine-arm (codex) tocca solo il suo perimetro e nessun altro pacchetto attivo lo dichiara». Non riaprire gli scope condivisi senza nuova verifica. Automazione riletta da automation.toml: ACTIVE, heartbeat sulla chat01a198be-f68f-7c30-8ff8-4e05ee72b604, checkpoint0/2/4/7 e scadenza2novembre06:05UTC. Nessun processo di build o deployment remoto avviato al passaggio notturno.

## Decisioni e confini

Usare online-pilot.md come contratto operativo aggiornato. Progetto/root nuovi `bambola-arm` e `/opt/bambola-arm`; risorse limitate; nessuna porta app/DB pubblicata. Bootstrap privato tramite API esistenti BetterAuth, Rosanni admin e tre slot equipaggio di prova con password uniche, mai la password demo locale. Credenziali in file protetto consegnato a Stefano, nessun invio alle persone.

Il pilot è singola istanza e usa dati fittizi. Header IP autorevoli e prove di falsificazione obbligatori; limitatore esistente in memoria con reset al riavvio dichiarato; persistenza distribuita richiesta prima di più istanze. Non creare una nuova dipendenza cross-module soltanto per la precedente raccomandazione generica in DELIVERY.

La revisione di design deve decidere il logout: UI corrente non ha Salir. Aggiungerlo al perimetro e collaudarlo è preferibile a lasciare una sessione persistente su telefoni condivisi; non dichiararlo già implementato.

## Rapporto finale richiesto

Riportare una sola volta ciò che serve a Stefano: stato reale online/non online; URL corretto; dove trovare accessi; risultato verifiche e assenza di regressioni Hair; eventuale intervento indispensabile. Non scambiare viewport Android simulato per test su telefono fisico, manifesto CSV per approvazione Capitaneria, bozze per WhatsApp collegato. Non contattare personale o chiedere autorizzazioni al deploy già concesse. Non archiviare la chat.

## Snapshot e review codice — checkpoint01:30 Roma

Tre writer Luna completati e fermi. Nuovi file deployment, packer/manifest e logout esclusivo implementati. Integrazione:26testPython passati/1symlink Windows saltato; TypeScript e lintUI passati; Caddy reale2.11.4validate e Composeparser su VPS in sola lettura stdin passati. Il controlloCompose ha trovato una stringaYAML nonquotata, corretta. Testbrowserlogout con503 inizialmentefallito; passaggio a chiamataHTTP dell'endpointsign-out esistente e verifica finale delparent passata,4checkpointpiùassertions stato/sessione; causainiziale noncertificata.

Rilascio congelato C:/Users/stefa/bambola-runtime/releases/20261102-r1,520file,manifest5ba6500404f8dd902008e6a20982bf9f137aba526bf2da815299925c33ab1ddd. NONmodificare inposto. Invocazione14bambola_online_code_review frescoSol +15ClaudeCLI safe-mode/toolsnone stanno revisionando questo snapshot. Claudeprocess session51519, outputprivato bambola-runtime/reviews/claude-r1-output.json; verificare completamentoeffettivo. Evidenzeparent in bambola-runtime/evidence/pre-review-r1.txt. NessunrootBambolaremoto/DNS/Caddy/account creato; solo containerCaddyvalidate temporaneo networknone rimossoautomaticamente. Non avviarebuild prima di acquisirereview ecorreggerefinding.

## Checkpoint notturno 2novembre, circa01:25 Roma

Review EGM online completata realmente in5stadi;13invocazioni incl2quota failures. Report05–09 e dependency-triage conservati. Restano review codice esatto/Claude e prove runtime. Fresh fetch+coordina exit0. Tre esecutori gpt-6-luna avviati con perimetri disgiunti: runtime/compose/bootstrap/Dockerfile/backup, host/Caddy/build, packer/manifest/logout; nessun writer concorrente sugli stessi file. Nuovo runtime locale dedicato C:/Users/stefa/bambola-runtime (non beauty-qa-runtime). Due reti interne edge/data separano gateway e DB. No codice operativo remoto ancora eseguito, root /opt/bambola-arm assente; DNS/Caddy invariati. SSH read-only: tutti3container Hairhealthy, RAM disponibile3.7GB/disk40GiB. Node22-alpine amd64 fissato digest025b8e975a61d94e33abeafaad1255ef44e4898cf1a1b6446860009c72e6d284 da Dockerregistry. Non dichiarare il pilota online finché i gate reali non sono verificati.

### Aggiornamento review r1

Sol14 completato,4P1: vincolo immagineID/manifest, markerDNSmonotono/validato, bootstraproothelperdocumentato, gatewaynonroot/capdrop. Fixcycle1 inSOURCE dai writer runtime/host, nonmodificare r1. Claude15 NONvalido: outputdicecutoffnessunverdetto pur exit0,duration48705ms; noautorizzazionesecurity. Rawreviewpreservata. Totale15/20calls, prossimo16Solre-audit e17soloretryClaude conbundleridotto(no87KBmanifestcompleto), outputcapesplicito/1turno per evitarecutoff. Nessun deploy/DNS/publisheseguito; sitoancoranononline. Leggere reviews/online-10-code-r1.md.

### Checkpoint01:43 Roma — no publicar todavía

R2 congelado521files en bambola-runtime/releases/20261102-r2, manifest9909b64f44a39455cb69deccaab74b74073aafcb1ba1b1198227b7537fa04899. Sol16 completado:4P1r1 materialmenteresueltos, nuevoP1 importsubprocess ausente enr2runtime.py(defaultinspector falla). SOURCEactualcontieneimport yLunaañadióregressiondefaultinspector; fixcycle2 encurso hasta recibirelClaude17. Claude17 único retry fresco safe-mode/toolsnone inputreducido156KB, output8192/thinking4096; session94409 aúncorriendo, outputbambola-runtime/reviews/claude-r2-output.json. No iniciarotrareview/reintento sin adquirirresultado; quedan3invocaciones18/19/20 delpresupuesto.

Gatewayreal: capdropALL causaEPERM porfilecapNET_BIND_SERVICE delbinariofijado; añadirsoloNET_BIND_SERVICEenbounding conuid65532 yNNPpermitióvalidaciónCaddyexit0. Procesoaisladoreal mostróCapEff0 CapBnd0400 NoNewPrivs1 yHTTP200; aislado networknone yeliminado. Pruebatoolterminóexit1porCRLFfinaldelpipelineWindows despuésdelHEALTH_OK, no ocultarlo comofullscriptpass. Compose/isolationexigenestosvaloresefectivos yNET_RAWausente. ÚltimalecturaVPS: ningúncontainerBambola/probe, Caddyhashoriginal4da4…001, tresHairIDs/start/restarts0/healthidénticos. NingúnDNSniappremotocreado.

## Checkpoint 01:52 Roma — build locale completata, gate Claude aperto

Snapshot corrente r3: `C:/Users/stefa/bambola-runtime/releases/20261102-r3`, 521 file, manifest `ed29a574abd2b83b458ec3965e2908ff7d59381ff6e4aef61af647ccfd9c6b60`. Non modificare la cartella congelata. Sol18 ha completato la revisione circoscritta e le letture richieste: nessun P0/P1 supportato nel delta r2-r3; dettagli e limiti in `reviews/online-12-code-r2-r3.md`. Tutti i writer sono fermi.

La build locale `pnpm build` è terminata con exit 0; il launcher ha riaperto l'anteprima 3130, PID 66696. La sessione exec 88036 è conclusa: non aspettarla ancora. Non equivale a build dell'immagine sul VPS. Suite Python r3: 38 passati e 1 saltato su Windows.

Claude17 è terminato con errore di limite output (8192 token), senza verdetto. Anche Claude15 non aveva prodotto un verdetto valido. È esaurito l'unico retry fresco previsto; è già stata posta a Stefano una domanda asincrona per un solo tentativo aggiuntivo mirato, più output e massimo 10 minuti, senza saltare la review. Nessuna risposta ricevuta a questo checkpoint. Non ripetere la domanda, non rilanciare Claude e non eseguire attività dipendenti prima della risposta. Il permesso di deploy resta valido e non va richiesto di nuovo.

Budget: 18/20 invocazioni revisori, 2/2 cicli di correzione. Nessuna build remota, nessun root `/opt/bambola-arm`, account, DNS o modifica Caddy Bambola. Prossima ripresa: acquisire eventuale risposta, preservare snapshot e prove; se ancora bloccato, proseguire soltanto su documentazione/verifiche indipendenti. Alle 07:00 consegnare lo stato reale, anche se non online, e disattivare soltanto l'automazione notturna.

### Consegna tecnica al checkpoint 01:54 Roma

Codice di preparazione online e documenti versionati e pushati sul branch `codex/bambola-arm`, commit `40c63cc`. Sono stati inclusi soltanto i 34 file del perimetro online; la baseline applicativa ereditata e le altre modifiche locali non sono state committate o ripristinate. Il commit da solo non sostituisce lo snapshot completo verificato. `git diff --check` ha segnalato solo due righe vuote finali in `host.py` e `build.py`, conservate per non alterare il codice congelato; non dichiarare questo controllo integralmente verde.

Archivio pronto ma non trasferito: `C:/Users/stefa/bambola-runtime/releases/20261102-r3.tar.gz`, 859299 byte, SHA256 `3d53967c8256b6845dc0451bd8a7e9ef8aa43c8c76a10f1291747f3da3031a95`. Verificati tutti i 522 file dell'archivio, incluso il manifest, confrontando i byte con lo snapshot r3. Evidenza `C:/Users/stefa/bambola-runtime/evidence/archive-r3.json`. Nessun permesso di pubblicazione dedotto dalla creazione dell'archivio. Su questo Windows usare `py -3 -B`, perché `python` risolve all'alias Microsoft Store non configurato; l'errore dell'alias è stato corretto nel successivo controllo effettivo.

Fresh fetch e controllo coordinamento exit 0. Anteprima `http://127.0.0.1:3130/nautica` risponde HTTP200 dopo il riavvio. Nessun processo build/review ancora in attesa. La domanda per il tentativo Claude aggiuntivo resta pendente; automazione mantenuta attiva per i checkpoint e il rapporto delle 07:00.

## Checkpoint 02:58 Roma — nessun cambiamento del blocco

Heartbeat acquisito alle 01:56 UTC. Nessuna nuova risposta dell'owner: non rilanciata la review Claude e non effettuate operazioni dipendenti. Agenti della chat tutti completati, nessun writer concorrente; nessun container Bambola presente e `/opt/bambola-arm` ancora assente sul VPS. Preview locale PID 66696 attivo, `/nautica` HTTP200. Fresh fetch + `coordina verifica` exit 0.

Nuova lettura SSH del 2 novembre alle 01:56–01:57 UTC: Caddy SHA256 invariato `4da4ca1fe5a6c3949016a2660d7fbef9bef26d49459ea262b35f8f4a128fb001`; tutti e tre i container Hair conservano ID e StartedAt del checkpoint precedente, restart 0 e healthy. `/oggi` pubblico restituisce HTTP401, senza bypassare l'autenticazione. Il primo comando inspect ha usato erroneamente il nome `hair-arm-gateway-1` ed è uscito 1; la verifica successiva per ID ha confermato il nome effettivo `hair-arm-hair-arm-gateway-1` e lo stato sano. Non era un guasto del gateway. Usare quel nome esatto o l'ID osservato nei controlli successivi.

Attività indipendente completata: aggiunta in `online-pilot.md` una riconciliazione documentale fra matrice pre-codice e interfacce effettive r3 (image ID/manifest, bootstrap wrapper, dns-intent, logout e nomi test). Nessun codice o snapshot modificato. Trovate copie accessibili dei due riferimenti esterni segnalati dal reviewer in `C:/Users/stefa/heili-egm-metodologia/docs/GUIDA-HEILI.md` e `COORDINAMENTO-AGENTI.md`: fornire questi percorsi al revisore finale, senza retrodatare letture del precedente reviewer. Automazione ancora ACTIVE, stessa chat e scadenza. Conteggi immutati 18/20, fix cycle 2/2; non inviare un altro avviso per lo stesso blocco.

## Checkpoint 05:05 Roma — indice prove pronto

Nessuna risposta per il tentativo Claude aggiuntivo; blocco invariato, nessuna nuova invocazione o implementazione. Agenti tutti completati, nessun container/root Bambola sul VPS. Caddy e i tre container Hair invariati alla lettura SSH delle 04:03:14 UTC; HTTP401 atteso sull'accesso pubblico Hair con TLS verificato. Preview locale HTTP200 e launcher ready, PID 66696 ancora attivo. Hash archivio r3 invariato. I report locali preesistenti sono stati riletti (50 HTTP, 13 UI equipaggio, 5 UI passeggero e prova 130 persone sintetiche): nessun test nuovo dichiarato per effetto di questa lettura.

Preparato `FINAL-REVIEW-INPUT.md` con riferimenti esatti, portata delle prove, limiti, dati pubblici non segreti dei container e incarico per il revisore fresco delle 07:00. È materiale di ingresso, non il verdetto finale. Nessuna modifica al codice o allo snapshot; non anticipare la review, non sostituire quella Claude e non inviare un altro avviso per lo stesso blocco.
