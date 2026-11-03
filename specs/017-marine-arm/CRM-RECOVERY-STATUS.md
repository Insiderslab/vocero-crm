# La Bambola — stato verificato al 3 novembre 2026

## Codice pronto, nuova versione non pubblicata

Revisione indipendente finale: PASS statico/locale. Le correzioni di rilascio richieste da Claude sono verificate; 71test operativi passati e1saltato nella review. Il candidato r3 resta congelato e disponibile. Nessuna nuova immagine remota verificata: due build sono state fermate dal controllo di integrità delle rotte esterne.

Blocco concreto: app.heili.cloud/ alterna HTTP200 e307 verso/dashboard anche senza build, mentre container/reti/Caddy/file sono invariati. I controlli non sono stati disabilitati. Hair non è stato modificato. Nessun deploy dei nuovi app/gateway Bambola, nessuna migrazione, invio o collegamento provider. Bambola conserva la versione pubblica precedente; ultimo controllo HTTPS /nautica200 e Hair /oggi307 verso login, certificati verificati.

## Funzioni del candidato

CRM originale ripristinato nella navigazione amministrativa: contatti, inbox, pipeline, Heili, automazioni, laboratorio e impostazioni. Tour/calendario si aggiungono al CRM. Area equipaggio separata e semplice, con permessi server: calendario, dettagli, attività assegnate a membri reali, ricerca/scansione biglietti e conferma movimento. WhatsApp visibile ma collegamento e invii disattivati nel pilota sintetico.

## Collaudo locale effettivo

Buildproduzione exit0;152unit test;61API e58dinieghi CRM per membro. Browser: accessi/navigazione, contatto salvato e ritrovato dopo reload, task Paella2 assegnato e stato persistente, camera negata con fallback, biglietto manuale, conferma imbarco, persistenza e duplicato. Larghezze390/320 verificate. Androidfisico, installazione, offline, tastiera/zoom200% e provaumana non eseguiti. Nessuna di queste prove è dichiarata test della nuova versione pubblica.

## Ancora pianificato

Agenda oggi/3giorni/7giorni/mese con modifica diretta; aggiornamenti automatici da conversazioni/prenotazioni; link di gruppo/agenzia; data di nascita; inviti; affiliazione previa approvazione e commissione10% sul tour incassato esclusi extra. Non inclusi nel candidato r3. Demo per il padre di Stefano disponibile in spagnolo in DEMO-PAPA.md.

## Ripresa

La pubblicazione è già autorizzata, senza nuova richiesta di permesso. La review statica resta valida sul medesimo artefatto. Occorre prima stabilità della route esterna; poi baseline nuova conservando le vecchie, build, attivazione isolata e gatepubblici. Modificare il guard richiederebbe un nuovo ciclo revisionato. Registro dettagliato in CRM-RELEASE-CANDIDATE.md e reviews/recovery-extension-02-sol.md. Password/cookie/biglietti non sono nei rapporti.
