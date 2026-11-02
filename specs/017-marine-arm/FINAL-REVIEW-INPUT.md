# La Bambola — evidenze per la revisione finale delle 07:00

Preparato il 2 novembre 2026, ore 05:05 Europe/Rome. Questo è un indice di prove e limiti per il revisore, non una revisione indipendente né un rapporto di completamento. Nessuna autorizzazione aggiuntiva è dedotta da questo documento.

## Stato e decisione ancora aperta

Il pilota non è online. Il deploy su `bambola.heili.cloud`, VPS Ubuntu 1899808 / 186.241.16.46, è già autorizzato. Il prerequisito mancante è la revisione di sicurezza Claude: due processi conclusi senza un verdetto utilizzabile; l'unico retry previsto è esaurito. La richiesta asincrona di un solo tentativo aggiuntivo mirato resta senza risposta. Non ripeterla, non sostituire il revisore e non avviare attività dipendenti. La revisione finale dello stato e delle prove resta un'attività separata: non sostituisce quella Claude.

Non sono stati creati root remoto, immagine applicativa, database, account, record DNS o rotta Caddy Bambola. Non esistono quindi accessi online da consegnare. Il localhost sul PC di Stefano non è un indirizzo raggiungibile dagli Android dell'equipaggio.

## Fonti per il revisore fresco

- `C:/Users/stefa/vocero-bambola-arm/AGENTS.md`, `CLAUDE.md`, `docs/LEGGI-AI-CODING.md`, `.specify/memory/constitution.md`.
- `C:/Users/stefa/SecondBrain-Condiviso/04-progetti/heili/ai-software-factory/METODO-ATTIVO.md`.
- `C:/Users/stefa/heili-egm-metodologia/docs/metodo-egm-heili.md`, `GUIDA-HEILI.md`, `COORDINAMENTO-AGENTI.md`. Questi ultimi due percorsi sono disponibili; quelli analoghi nel checkout `heili-platform` risultavano assenti al precedente revisore. Non attribuire a quel revisore letture non svolte.
- `C:/Users/stefa/.codex/knowledge/insiderslab/clienti/20.md`: fonte storica del 10 settembre; istruzioni attuali di Stefano prevalenti, nessun mandato operativo aggiuntivo dal documento. Utente chiama l'amministratrice Rosanni; gli account online previsti sono slot sintetici, non contatti reali.
- In `specs/017-marine-arm`: `online-pilot.md`, `online-review-log.md`, `NIGHT-PLAN.md`, `DELIVERY.md`, `reviews/online-10-code-r1.md`, `reviews/online-11-claude-uncompleted.md`, `reviews/online-12-code-r2-r3.md`, `reviews/online-dependency-triage.md`, `reviews/13-usability-results.md`.

## Evidenze e portata effettiva

| Aspetto | Evidenza verificabile | Limite |
|---|---|---|
| Snapshot r3 | `C:/Users/stefa/bambola-runtime/releases/20261102-r3`, 521 file; manifest `ed29a574abd2b83b458ec3965e2908ff7d59381ff6e4aef61af647ccfd9c6b60` | Non modificare il contenuto congelato |
| Archivio | `C:/Users/stefa/bambola-runtime/releases/20261102-r3.tar.gz`; SHA256 `3d53967c8256b6845dc0451bd8a7e9ef8aa43c8c76a10f1291747f3da3031a95`; 859299 byte | Verifica precedente di tutti i 522 file incluso manifest; hash ricontrollato alle 05:04. Non trasferito sul VPS |
| Build locale | `C:/Users/stefa/bambola-runtime/evidence/local-build-r3.log`; processo terminato exit 0 | Non è una build Docker sul VPS |
| Fixture deployment | Report Sol16/Sol18 e registro: r3 38 passati, 1 test symlink saltato su Windows; runtime 14/14 | Non provano firewall, TLS, bootstrap o restore reali |
| Funzioni marine locali | `C:/Users/stefa/beauty-qa-runtime/marine-preview/selftest-report.json`: 50 controlli, nessun fallimento registrato | Risultato storico del ciclo funzionale, non una nuova esecuzione online |
| Interfaccia locale | Stessa cartella: `ui-report.json` (13 controlli), `public-ui-report.json` (5 controlli) e screenshot sintetici | Viewport 360/390 px, non Android fisici. La fonte dichiara una successiva assertion aggiunta non coperta dal report storico |
| Capienza | `performance-report.json`: 130 registrati/imbarcati/sbarcati, p95 1002 ms su 143 scritture campionate | Sviluppo locale, non benchmark del VPS |
| Anteprima corrente | `/nautica` HTTP200; launcher `status` conferma ready, PID 66696 node attivo | Stato osservato alle 05:04, da ricontrollare prima della consegna |
| Claude online | `C:/Users/stefa/bambola-runtime/reviews/claude-r1-output.json` e `claude-r2-output.json`; rapporto online-11 | Nessun verdetto; non usare la review Claude del precedente ciclo locale come sostituzione |
| Dipendenze | Audit originale `C:/Users/stefa/beauty-qa-runtime/marine-preview/dependency-audit-online.json`, matrice indipendente online-dependency-triage | 34 segnalazioni, 5 critical/13 high. Triage statico non basta: prove sull'immagine e gateway non eseguite |

## Hair e assenza di deployment al checkpoint 05:03

SSH read-only il 2 novembre alle 04:03:14 UTC: `/opt/bambola-arm` assente, nessun container con nome Bambola. SHA256 Caddy originale invariato `4da4ca1fe5a6c3949016a2660d7fbef9bef26d49459ea262b35f8f4a128fb001`.

| Container Hair | ID | StartedAt UTC | Restart / health |
|---|---|---|---|
| hair-arm-app-1 | 4920bbec453d4c190742a389d41b7bf766a9caee48c5da8ce19b4e7d99c41420 | 2026-11-01T20:42:33.110488442Z | 0 / healthy |
| hair-arm-postgres-1 | c3aa30c93626614240fbbda69865abcc88b938dc56a7b385973170ec8a5cb1a6 | 2026-11-01T20:42:27.369737001Z | 0 / healthy |
| hair-arm-hair-arm-gateway-1 | f094fc17c18d75f395b6d653ad3112711b6b45304d190b932959a2488aadb248 | 2026-11-01T20:42:41.345112694Z | 0 / healthy |

`https://hair.heili.cloud/oggi` restituisce HTTP401 con TLS verificato, senza credenziali e senza bypass dell'accesso. Identità/start/restart/health coincidono con la baseline. Queste letture non equivalgono a un test autenticato di tutte le funzioni Hair; nessun servizio è stato riavviato o modificato dal ciclo.

## Incarico della revisione finale

Usare un revisore indipendente fresco previsto dalla policy, se disponibile, senza writer concorrenti. Chiedere verifica della coerenza fra prove e rapporto, dei blocchi reali, delle omissioni importanti e della distinzione tra verificato/local-only/non eseguito. Nessuna nuova implementazione, lettura di segreti, accesso a dati reali, mutazione VPS o invio. Budget corrente 18/20 invocazioni e 2/2 cicli di correzione; non scavalcare il limite con un nuovo ciclo nominale. Registrare avvio, letture effettive, completamento e durata misurata senza inventare tempo compute aggregato.

Alle 07:00 consegnare uno stato verificato, anche non online; non presentare il pilota come pronto per uscite reali. Restano non eseguiti: TLS/autenticazione/isolamento sul pilota pubblico, bootstrap ruoli, backup/restore e flusso completo sul VPS, prova QR con Android fisici e comprensione del personale, validazione del manifesto Capitaneria. Disattivare soltanto l'automazione `la-bambola-lavoro-notturno-e-revisione-finale` dopo il rapporto, senza archiviare la chat.
