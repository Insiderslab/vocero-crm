# La Bambola — rilascio verificato, 3 novembre 2026

## Online

Il candidato r9 è pubblicato su https://bambola.heili.cloud. Il CRM amministrativo si apre su /dashboard; l'equipaggio usa /nautica. Gli account esistenti sono conservati. Nessuna credenziale è inclusa in questo rapporto.

Pacchetto: 20261103-crm-r9, 541 file. Manifest SHA-256: ef7bcab49494bf0577afec816dc239778db27cf4b470b596600a3cef96042bd7.
Immagine attiva: sha256:eb8d7abe3c23cb03363852d3c796bc82a49d8bf47965f114d78f23cd5b37cb88.
Baseline: 110023f6ea3cedfa96a5a27d21fae072b0c2db484956a9f1bbd87460f50632b8.

## Revisioni e rilascio

Le ultime due revisioni autorizzate sono PASS: Claude fresco (143,87 secondi) e revisore indipendente Sol (240 secondi riservati come limite conservativo). Totale estensione 383,87/600 secondi, due invocazioni. Nessuna ulteriore modifica all'applicazione. Suite operativa congelata: 94 test, 93 superati, uno saltato su Windows.

Preflight: prove storiche integre, root ownership e hash verificati, età inferiore a 24 ore. Baseline r6 archiviata preservando le evidenze. Build isolata 1 CPU/2 GB completata, builder rimosso, immagine verificata. Preparazione e attivazione completate dai soli helper revisionati. Nessuna modifica a Hair, DNS, Caddy condiviso o altri servizi.

## Prove pubbliche

- API: TLS, login owner/amministrazione/equipaggio, accessi CRM, 58 dinieghi ai membri, registrazione di due passeggeri fittizi, assegnazione attività, idempotenza, imbarco e duplicato.
- Browser: dashboard in spagnolo, navigazione CRM, calendario e attività del team, camera negata e alternativa manuale, conferma imbarco, persistenza dopo reload e duplicati; larghezze simulate 320 e 390 pixel.
- Il primo percorso amministratore si era fermato perché il test cercava “Agente” invece dell'etichetta effettiva “Agent Heili”. Verifica successiva con etichetta osservata superata su agente, tour, impostazioni e WhatsApp disattivato. Nessuna modifica di prodotto necessaria.
- Isolamento tra organizzazioni: lettura e scrittura negate correttamente, sessione ripristinata e logout. Primo tentativo non eseguito per file account remoto assente; ripetizione con manifest sintetico temporaneo privato, eliminato dopo la prova, superata.
- Matrice negativa pubblica: 68 verifiche superate, zero fallimenti; 14 metodi provider disattivati, 16 pagine RSC prive del marcatore privato sintetico, percorsi vietati/codificati, limiti body e quattro tentativi login invalidi con XFF variato (quarto HTTP 429).
- Controllo finale: servizi propri sani, immagine e profilo attesi, porte private e reti conformi. Metadati degli altri container, reti e configurazioni invariati. Hair /oggi restituisce 307 al login con TLS verificato, come la baseline.

Evidenze locali in C:/Users/stefa/bambola-runtime/crm-qa: r9-build-session.txt, r9-prepare-result.txt, r9-activate-result.txt, r9-tenant-proof-result.txt, r9-final-integrity.json; evidence/online-verify-2026-11-03T12-13-10-268Z.json, evidence/online-2026-11-03T12-14-19.775Z/results.json, evidence/r9-owner-ui-followup.json, evidence/online-negative-2026-11-03T12-18-57-259Z.json.

## Limiti del pilota

Solo dati fittizi. WhatsApp, invii, provider AI e pagamenti collegati non attivi. Android fisico, lettura QR tramite vera fotocamera, installazione mobile e offline ancora da provare. I test del browser non sostituiscono queste prove.

Ancora previsti: agenda oggi/3/7 giorni, aggiornamento da conversazioni, link di gruppo e portale agenzie, data di nascita, inviti automatici. Commissione concordata: 10% sul tour incassato, esclusi extra.

L'anomalia esterna app.heili.cloud (alias web condiviso fra Heili e Approve) resta documentata e non è stata modificata. Il proxy Bambola usa un upstream univoco.

## Presentazione in spagnolo

25 slide con schermate reali di prova, note del relatore e distinzione tra funzionalità del pilota e prossimi sviluppi. File: C:/Users/stefa/bambola-runtime/presentacion-papa/output/La-Bambola-Guia-Visual-Completa.pptx. Tutte le slide renderizzate e ispezionate; validazione strutturale senza rilievi. Screenshot locali con dati sintetici, non prova di Android fisico. SHA-256: 981c52f8a1445badda92b10974036e822e88861877e2c3932ce471df3028a40b.
