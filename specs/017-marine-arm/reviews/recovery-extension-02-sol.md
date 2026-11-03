# Revisione finale indipendente r3 — 3 novembre 2026

Revisore: app_code_reviewer GPT-5.6 Sol, agente recovery_extension_final_sol, fork_turns:none, sola lettura. Seconda delle due review aggiuntive autorizzate. Intervallo osservato dal coordinatore 00:33:30–00:39:30 UTC (360 secondi, include orchestrazione; non è tempo nativo di calcolo). Claude precedente275.84s; totale intervalli contabilizzati635.84s su1200, chiamate2/2. Unico ciclo correttivo completato.

## Verdetto

PASS statico/locale per codice applicativo, gateway e correzione rollout r3. BLOCKED per build e attivazione runtime.

Nessun finding materiale residuo supportato nel codice applicativo, nell'allowlist gateway o nel normale percorso activate/rollback. B-R1–B-R4 implementati: route Bambola separata; compose wait180/timeout240; rollback solo base+panel con immagini/config precedenti e profilo assente; retry e lock; validazione prima del piano; test di attivazione/deriva Hair/rollback/retry. Il recupero manuale dei lock dopo crash è documentato e sufficiente; non richiede nuovo artefatto perché è runbook.

## Verifiche indipendenti dichiarate dal revisore

- Manifesto d4c1de657f7e866b024d5c6106ae2c28a035d000e8ec06bc5c56087be0849c76:538/538file, nessun mismatch.
- Overlay27/27hash. Baseline→r3:14aggiunti,19modificati,0rimossi. r2→r3:soltanto crm_rollout.py e relativo test.
- package.json, lockfile e51fileDrizzle invariati.
- Test rilanciati:71passati,1saltato perché symlink non disponibili suWindows.
- Evidenze consultate:152unit,61API, matrice locale member58/58con403, QA browser e workflow biglietto manuale.
- Il revisore ha verificato che la procedura stale-lock sia presente in CRM-RELEASE-CANDIDATE.md. L'aggiornamento richiesto al registro operativo (baselinevecchia/corrente, duebuildfallite, oscillazione) è stato scritto dal coordinatore.

## Blocco reale e disposizione

app.heili.cloud/ alterna200 senzaLocation e307 verso/dashboard conTLSvalido; container/reti/Caddy/config e risorse restano invariati. Entrambe le build private r3 sono state fermate dal guard durante installazione dipendenze. Nessuna immagine r3 verificata, nessun piano preparato, nessuna attivazione.

Non eseguire altre baseline/build/prepare/activate finché la route esterna non si stabilizza. Se si stabilizza senza cambiare il candidato, reviewstatica valida e ripresa possibile con nuova baseline preservando le precedenti. Qualunque modifica del guard richiede un nuovo ciclo autorizzato e revisionato. Non modificare servizi esterni per ottenere il PASS.

## Gate ancora da eseguire

Buildimmagine+label e controllopostcleanup; profilo marine/mount/faseactivated; integritàHair/Caddy/reti/route; loginowner/admin/member; matricepubblicadinieghi (403CRM,503provider); RSCsenza dati; provider503prima delproxy; negativeedge/bodycaps/crosstenant/XFF; eventualerollbackdrill oppure dichiarazione noneseguito. Androidfisico/offline/tastiera/zoom200% nonprovati. DBsuperuser e audit5critical/13high limitano ilpilota ai soli datisintetici.
