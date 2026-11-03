# La Bambola — stato verificato al 3 novembre 2026

## Nuova versione non ancora pubblicata

La versione precedente resta online su https://bambola.heili.cloud. Il candidato corretto r8 e congelato localmente:541file; manifestce601db7f67f54d11593aaf26b8b4c9abe90538b6f833edaa0180575b47edc80. Sul pacchetto esatto:91test operativi,90passati e1saltato. Nessuna build o attivazione r7/r8 eseguita; r7 e soltanto caricato sul server.

## Anomalia individuata

app.heili.cloud puo rispondere da due applicazioni: Heili e Approve condividono l'alias Docker web usato dal proxy. E un problema preesistente esterno a Bambola. Bambola usa un upstream univoco. Non sono stati modificati quei servizi, Hair, il proxy condiviso o il DNS. La nuova procedura conserva tutte le prove storiche e lega le due risposte gia osservate a configurazioni e servizi verificati identici; non accetta esiti arbitrari.

Ultimo controllo remoto in sola lettura: tutti i cinque gruppi protetti invariati (Caddy,container,app/gateway Bambola,reti,fileconfigurazione). Hair/oggi HTTP307 verso il login e Bambola/nautica HTTP200, TLS verificato. Nessun provider collegato, messaggio inviato, dato reale importato o pagamento attivato.

## Correzioni e revisioni

Il progetto della correzione ha completato cinque stadi indipendenti, con readiness PASS. La revisione post-codice r7 ha richiesto il controllo root-owned del file baseline e test negativi/concorrenza aggiuntivi: corretti in r8. La review Claude r7 si e interrotta a150.09secondi senza verdetto, quindi NON e superata. R8 attende il riesame indipendente e la review Claude completa.

Il ciclo ha12invocazioni e un conteggio conservativo1747.66/1800secondi. Restano52.34secondi, insufficienti per completare entrambe le review richieste. Serve un'estensione mirata di2revisioni e10minuti secondo docs/metodo-egm-heili.md. Il deploy e gia autorizzato; non si richiede nuovamente il consenso alla pubblicazione. Nessun gate viene aggirato.

## Funzioni del candidato

CRM originale ripristinato: contatti,inbox,pipeline,Heili,automazioni,laboratorio,impostazioni. Tour/calendario aggiuntivi; equipaggio separato con permessi server,attivita assegnate,ricerca/scansione biglietti e conferma movimento. WhatsApp visibile, collegamenti/invii disattivati nel pilota sintetico.

Prove applicative locali precedenti ancora pertinenti: buildproduzione,152unit,61API,58dinieghiCRM; browser con contatto persistente,taskPaella2,assegnazione/stato,camnegata/fallback,biglietto/imbarco/reload/duplicato,larghezze320/390. Non equivalgono a prove della nuova versione pubblica. Androidfisico,installazione/offline,tastiera/zoom200% e provaumana non svolti.

Ancora pianificati: visteagenda oggi/3/7giorni/mese,aggiornamento da conversazioni/prenotazioni,linkgruppo/agenzia,data di nascita,inviti,affiliazione approvata e10%sul tour incassato esclusi extra.

## Ripresa senza rifare il lavoro

Completare le due review sul solo r8 immutabile; solo dopo PASS upload/verifica, writer audit-bound con archivio r6, guard,build,attivazione della sola Bambola,provepubbliche API/ruoli/provider/RSC/limiti/XFF/crossorg e UI. Fonte operativa: evidence-baseline-design.md finalStage9. Registri reviews/evidence-r7-postcode.md e reviews/evidence-baseline-design-register.md. Vecchie evidenze e account preservati. Nessuna password/cookie/biglietto nei rapporti.
