# La Bambola: pannelli amministratore e calendario

Richiesta del2novembre2026: vedere tutti i pannelli e integrare un calendario. Completata la navigazione del pilota su https://bambola.heili.cloud/nautica. Guida: specs/017-marine-arm/PANNELLI.md. ARM/agenzie/team sono anteprime informative, non integrazioni attive.

EGM ridotto: nessuna modifica a API, guardie, schema, provider o dipendenze. Pre-review fresca con limite50individuato e corretto; re-audit PASS. Implementazione e QA GPT-6 Luna; post-review GPT-5.6 Sol ha richiesto prova stale/error, aggiunta e verificata da nuovo revisore.4invocazioni reviewer complessive; budget20/30min rispettato, durate individuali precise non acquisite. Letture e risultati in specs/017-marine-arm/reviews/panels-design.md e panels-code.md. Non è una review completa a cinque stadi.

Baseline sorgente r5 immutabile, solo2file UI diversi; manifest07ac97fdd0638d631339b32fd075a1120c83b3dceaae95a59c992de463789ec2 verificato prima/dopo trasferimento. Build limitata e app-only rollout; immagine e comando persistente nel README di deploy/marine. Nessuna lettura di segreti di altri servizi, nessun messaggio, nessun pagamento, nessun dato di passeggeri reali. Account/ambiente runtime conservati; Hair e servizi preesistenti invariati. Rollback limitato all'immagine app precedente.

Prove: baseline44test PASS; finale48test marine PASS, typecheck PASS, lint mirato PASS, build PASS, browsermock7/7 PASS, pubblico30/30 PASS con0scritturemarine. Lint globale resta rosso perunusedargument preesistente in deploy/marine/bootstrap.mjs, fuori dal delta. ProvaAndroidfisica e limiti di sicurezza del pilota precedente restano aperti. Server di anteprima locale temporaneo3140 terminato dopo le prove.

Evidenze locali senza credenziali: C:/Users/stefa/bambola-runtime/evidence/panels-source.json, panels-build.json, panels-before.json, panels-deploy.json; qa/panels-calendar-ui-evidence/panels-calendar-ui.json e qa/evidence/panels-online.json. Gli artefatti non contengono password. Non usareaccounts.json delpilota perbootstrap nuovamente.
