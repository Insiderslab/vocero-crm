# La Bambola — stato verificato al 3 novembre 2026

## Nuova versione non ancora pubblicata

La versione precedente resta online su https://bambola.heili.cloud. Il candidato corretto r9 e congelato localmente:541file; manifestef7bcab49494bf0577afec816dc239778db27cf4b470b596600a3cef96042bd7. Sul pacchetto esatto:94test operativi,93passati e1saltato. Nessuna build o attivazione r7/r8/r9 eseguita; r7 e r8 sono soltanto caricati sul server.

## Anomalia individuata

app.heili.cloud puo rispondere da due applicazioni: Heili e Approve condividono l'alias Docker web usato dal proxy. E un problema preesistente esterno a Bambola. Bambola usa un upstream univoco. Non sono stati modificati quei servizi, Hair, il proxy condiviso o il DNS. La nuova procedura conserva tutte le prove storiche e lega le due risposte gia osservate a configurazioni e servizi verificati identici; non accetta esiti arbitrari.

Ultimo controllo remoto in sola lettura: tutti i cinque gruppi protetti invariati (Caddy,container,app/gateway Bambola,reti,fileconfigurazione). Hair/oggi HTTP307 verso il login e Bambola/nautica HTTP200, TLS verificato. Nessun provider collegato, messaggio inviato, dato reale importato o pagamento attivato.

## Correzioni e revisioni

Il progetto della correzione ha completato cinque stadi indipendenti, con readiness PASS. La revisione post-codice r7 ha richiesto il controllo root-owned del file baseline e test negativi/concorrenza aggiuntivi: corretti in r8. La review Claude r7 si e interrotta a150.09secondi senza verdetto, quindi NON e superata. R8 e stato riesaminato: nessun nuovo difetto implementativo supportato, ma test di accettazione incompleti. R9 corregge solo il file di test, con matrice dei checkpoint, consumatori build/prepare, tempoUTC e esito non-app aggiuntivo. Il codice runtime rimane byte-identico a r8. Claude e fallito a248.11s per il limite6000token configurato dal coordinatore;4tentativiAPI automatici senza verdetto. La configurazione successiva e preparata con effortmedium e limite24000token, non ancora eseguita.

La precedente estensione autorizzata di2revisioni/600secondi e stata usata:SolBLOCKEDeClaudeINCOMPLETE,488.11secondi conservativi. Totale14invocazionimanuali e2235.77secondi, con4tentativiAPIinterniClaude registrati. E richiesta una nuova allocazione di2revisioni/10minuti per r9 secondo docs/metodo-egm-heili.md; non ancora autorizzata. Il deploy e gia autorizzato; non si richiede nuovamente il consenso alla pubblicazione. Nessun gate viene aggirato.

## Funzioni del candidato

CRM originale ripristinato: contatti,inbox,pipeline,Heili,automazioni,laboratorio,impostazioni. Tour/calendario aggiuntivi; equipaggio separato con permessi server,attivita assegnate,ricerca/scansione biglietti e conferma movimento. WhatsApp visibile, collegamenti/invii disattivati nel pilota sintetico.

Prove applicative locali precedenti ancora pertinenti: buildproduzione,152unit,61API,58dinieghiCRM; browser con contatto persistente,taskPaella2,assegnazione/stato,camnegata/fallback,biglietto/imbarco/reload/duplicato,larghezze320/390. Non equivalgono a prove della nuova versione pubblica. Androidfisico,installazione/offline,tastiera/zoom200% e provaumana non svolti.

Ancora pianificati: visteagenda oggi/3/7giorni/mese,aggiornamento da conversazioni/prenotazioni,linkgruppo/agenzia,data di nascita,inviti,affiliazione approvata e10%sul tour incassato esclusi extra.

## Ripresa senza rifare il lavoro

Completare le due review sul solo r9 immutabile; solo dopo PASS upload/verifica, writer audit-bound con archivio r6, guard,build,attivazione della sola Bambola,provepubbliche API/ruoli/provider/RSC/limiti/XFF/crossorg e UI. Fonte operativa: evidence-baseline-design.md finalStage9. Registri reviews/evidence-r7-postcode.md e reviews/evidence-baseline-design-register.md. Vecchie evidenze e account preservati. Nessuna password/cookie/biglietto nei rapporti.

