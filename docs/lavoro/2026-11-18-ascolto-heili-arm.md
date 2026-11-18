# Modalità ascolto unica per Heili ARM — confronto e patch

18 novembre 2026. Autore: Claude. Destinatari: Codex e Stefano.

## Risultato

La modalità ascolto di Hair ARM (release `r6`) e quella di questo ramo sono **quasi lo stesso codice**. Non servono
due varianti né una riscrittura: Heili ARM parte da quella di Hair e riceve tre piccole aggiunte, 38 righe in
4 file. La patch è in `docs/lavoro/patch/2026-11-18-ascolto-heili-arm.patch`.

Fonte del confronto: `Insiderslab/heili-preservation-20261111`, ramo `codex/snapshot-hair-20261111`, commit
`bb72de1`, contro `claude/ascolto-orbit` (`f1f3624`). Confronto fatto ignorando i fine riga: lo snapshot ha file
con CRLF, e un confronto ingenuo li segna tutti come diversi.

## Cosa ha Hair in più: il blocco di osservazione

`src/server/listening/observation-lock.ts` legge `service_observation_config`. Se per l'organizzazione esiste
un periodo di osservazione configurato:

- l'ascolto risulta **acceso** anche senza la riga in `listening_mode`, con data di accensione
  `activatedAt` del periodo;
- **non si può spegnere** dalle impostazioni: `PUT /api/settings/listening {enabled:false}` risponde
  `409 observation_locked`, e l'interruttore è disabilitato nell'interfaccia;
- `/api/bot/messages` restituisce 409 anche per il codice `observation_listening`.

È una protezione in più, coerente con la regola «in ascolto non parte nulla da solo». **Va tenuta** in Heili ARM.
Dipende dal modulo `service-intelligence`, che in questo repository non esiste: per questo non è stata portata
qui.

## Cosa manca a Hair, e la patch aggiunge

| # | File | Cosa | Perché |
|---|---|---|---|
| 1 | `src/server/ai/pipeline.ts` | Nel percorso del secondo tentativo dell'agente: in ascolto si toglie solo la marca e si esce | Senza, il secondo tentativo reclama la conversazione e toglie il passaggio a una persona |
| 2 | `src/server/ai/manual-retry.ts`, `…/agent-retry/route.ts` | «Riprova» in ascolto risponde `listening_mode` (409) | Senza, «Riprova» riaccende l'IA della conversazione per un turno che non parte |
| 3 | `src/app/api/export/core/messages/route.ts` | Escono solo i messaggi con data WhatsApp dall'accensione in poi; ascolto spento → lista vuota | Senza, verso il Brain esce tutto lo storico importato dal telefono in coesistenza, anche privato |

Sul punto 3 il blocco di osservazione lavora insieme alla regola: con un periodo configurato la data di
riferimento è `activatedAt`, quindi escono solo i messaggi dall'inizio dell'osservazione.

Tutti gli altri file dell'ascolto sono identici: `feed.ts`, `trigger.ts`, `send.ts`, `engine.ts`, le rotte
`contacts`, `conversations`, `state`, `bot/typing`.

## Prove

Su una copia dello snapshot di Hair con la patch applicata:

- `tsc --noEmit`: pulito.
- Test unitari (quelli conservati nello snapshot, più `listening-retry.test.ts` e la versione aggiornata di
  `export-core-feed.test.ts` di questo ramo): **1938 su 1945**.
- I 7 rossi c'erano prima della patch e sono effetti dell'archivio: 6 di `reset-password` (lo script non è nel
  pacchetto della release) e 1 di `isSuperadminEmail` (email sostituite nell'archivio).
- Adattamento necessario per Heili ARM in `export-core-feed.test.ts`: l'aiuto `dataQueries` deve escludere anche
  `service_observation_config`, perché lì lo stato dell'ascolto fa una lettura in più.

## Non verificato

- Lint, build e self-test E2E su Hair: nello snapshot mancano l'arnese E2E e la configurazione.
- Bambola ARM (`r9`): non confrontata. Il suo snapshot non è fra quelli che ho in locale.
- Nessuna prova con un periodo di osservazione vero: i test unitari non lo configurano.
- Il numero di migrazione: qui la tabella `listening_mode` è la 0020; negli ARM lo 0020 è l'agenda. In Heili ARM
  la tabella esiste già con un altro numero: **la migrazione di questo ramo non va portata**.

## Cosa resta da fare, e chi

1. **Codex:** creare la base Heili ARM dal codice di Hair su un ramo GitHub. Finché non esiste non c'è un posto
   dove applicare la patch: lo snapshot è un archivio, non un ramo di lavoro.
2. **Claude:** applicare la patch lì, portare i 13 file di test dell'ascolto e l'E2E, verificare Bambola.
3. **Da decidere:** contatti e conversazioni importati dallo storico escono ancora dal feed (limite già annotato
   nella specifica 016).
