# Procedura di rilascio del livello canali — R1, R2, R3 (005-livello-canali)

**Per chi:** l'owner (unico autorizzato ad agire in produzione, Legge Zero). **Nessun agente esegue questi passi.**
**Cosa cambia:** il CRM prepara il modello dati multicanale (ADR 0001 §3.2) in tre rilasci. **R1 «espandi»** (questo pacchetto, M1.2) aggiunge tabelle e colonne nuove, le riempie e le tiene allineate, ma **legge ancora le colonne vecchie**: il comportamento di WhatsApp non cambia. R2 (M1.3) passa le letture alle strutture nuove. R3 (rilascio successivo) toglie le colonne vecchie.
**Riferimenti:** ADR `docs/adr/0001-livello-canali.md` §3.3 (meccanismo, V1–V7, sequenza dei lock), `specs/005-livello-canali/plan.md` §6, registro `docs/lavoro/2026-10-10-m1-fase2-espandi.md` (prove e misure), `scripts/migrate-channels.mjs` (runner), `drizzle/0013_loving_stone_men.sql` (fase A).

> In questo documento non ci sono segreti. I comandi leggono **conteggi**, mai token o contenuti. Non incollare in chat righe di `meta_credentials`, `channel_account` o `message`.

## Come funziona l'avvio (da sapere prima di tutto)

A **ogni** avvio del container (`node migrate.mjs && node server.js`) il runner fa, in quest'ordine:

1. se il livello canali esiste già: **riconciliazione + verifiche** (prima delle migrazioni);
2. migrazioni Drizzle — **fase A**: solo catalogo, una transazione, `lock_timeout` 5 s (al primo avvio di R1: la `0013`);
3. **fase B**: indici `CONCURRENTLY`, FK e `VALIDATE`, uno per volta, fuori transazione, `lock_timeout` 5 s; un indice rimasto `INVALID` si elimina e si ricrea;
4. **fase C**: riconciliazione (account, identità, conversazioni; messaggi a lotti di 5 000 in autocommit) e verifiche **V1–V7**;
5. il server parte (oppure no, vedi «Modalità»).

La riconciliazione copia **dalle colonne vecchie alle nuove** (fino a R3 la fonte di verità è `meta_credentials`, `contact.wa_identity`, `message.wa_message_id`), inserimenti **e** aggiornamenti, e non dipende dal registro delle migrazioni: per questo un rollback a R0 non lascia dati disallineati al ritorno.

**Modalità** (costante nel codice di ogni rilascio, nessuna variabile d'ambiente):

| Rilascio | Modalità | Un'anomalia (V ≠ 0) o un errore di fase B/C |
|---|---|---|
| R1 | `avvisa` | va nel log; **il server parte** (R1 legge ancora le colonne vecchie) |
| R2, R3 | `blocca` | il runner esce con codice 1: **il container non parte** |

Il log di ogni avvio contiene una riga di riepilogo, per esempio:

```
[migrate] canali (avvisa): V1=0 V2=0 V3=0 V4=0 V5=0 V6=0 V7=0 | faseA_ms=152 faseB_ms=2563 post_sync_ms=2711 post_sync_messages_ms=21215 post_batches=201 post_check_ms=574
```

- `V1…V7` = numero di anomalie per verifica (mai valori);
- `pre_*` = passo 1, `post_*` = passo 4, `faseA_ms`/`faseB_ms` = durata delle fasi.

Se compare `verifica fallita` o `fase B: «…» non completato`, leggere il paragrafo «Come leggere V1–V7».

**Non usare `pnpm db:migrate` (drizzle-kit) su questa base:** applica solo la fase A e salta fasi B e C. In produzione le migrazioni le applica solo il container; a mano, solo con `node migrate.mjs` dentro l'immagine.

## Durata attesa e indisponibilità (misure del registro M1.2)

Misure su PostgreSQL 16 usa e getta, dati sintetici, macchina di sviluppo (indicative):

| Base (a `0012`, 3 organizzazioni, 60 000 contatti) | Primo avvio di R1 | Avvii successivi |
|---|---|---|
| 100 010 messaggi (35 MB) | 5,7 s | ~3 s |
| 1 000 010 messaggi (359 MB) | 27,3 s (fase C messaggi 21,2 s) | ~3,5 s |

Regola pratica per il **primo** avvio: circa **3 s + 24 s per milione di messaggi**. La soglia dell'ADR è 60 s (≈ 2,4 milioni di messaggi). **Se la produzione supera 2 milioni di messaggi, fermarsi e chiedere** (ADR §3.3: oltre la soglia la parte dei messaggi va spostata dopo l'avvio; non è implementato in R1).

Con lo stop-first l'avvio è tempo di indisponibilità (webhook e bandeja fermi). Meta ritenta i webhook non consegnati; i messaggi non si perdono, arrivano dopo.

## 0. Prima di iniziare (checklist R1)

- [ ] Il branch di M1.2 è stato rivisto da un agente diverso dall'autore e unito su `main` dall'owner; CI verde (compreso `test:golden` con PostgreSQL).
- [ ] Volume di produzione letto (solo conteggi), per stimare la durata:
  ```sh
  docker compose exec postgres psql -U postgres -d vocero -c "select (select count(*) from message) as messaggi, (select count(*) from contact) as contatti, (select count(*) from conversation) as conversazioni, (select count(*) from meta_credentials) as numeri;"
  ```
  Oltre 2 000 000 di messaggi: **stop**, chiedere prima.
- [ ] Nessun `pg_dump`, `VACUUM FULL` o sessione `psql` aperta in transazione durante il rilascio. Una transazione lunga che tocca `message` fa aspettare la fase A fino a 5 s per tentativo, e in quell'attesa **anche le altre letture e scritture su `message` restano in coda** (misurato: 19 sonde su 57 bloccate dietro una transazione di 12 s). Controllo, subito prima del rilascio:
  ```sh
  docker compose exec postgres psql -U postgres -d vocero -c "select pid, state, now() - xact_start as durata, left(query, 60) as query from pg_stat_activity where datname = 'vocero' and xact_start is not null order by xact_start;"
  ```
  Atteso: nessuna riga con durata superiore a qualche secondo, a parte questa stessa query.
- [ ] Finestra di manutenzione concordata (durata stimata sopra + margine).

## 1. Backup (obbligatorio)

Come per C1 (`docs/ops/rilascio-c1.md` §1): `pg_dump -Fc`, verifica con `pg_restore --list`, copia fuori dal server, e l'ultima migrazione applicata:

```sh
docker compose exec postgres psql -U postgres -d vocero -c "select id, created_at from drizzle.__drizzle_migrations order by created_at desc limit 3;"
```

Atteso prima di R1: l'ultima è la `0012` (13 righe in tutto). Il backup va **finito** prima del rilascio (vedi checklist: un dump in corso blocca la fase A).

## 2. Rilascio R1 (stop-first)

**Stop-first** = prima si ferma il container vecchio, poi parte il nuovo. Per R1 si usa sempre, anche nel primo passaggio R0 → R1: la fase A non trova traffico da bloccare e R0 non scrive mentre R1 riconcilia (ADR D18).

- **docker compose (Ruta B):** `docker compose up -d --build app` ricrea il container: compose ferma il vecchio e poi avvia il nuovo, cioè è già stop-first.
- **Coolify (Ruta A): comportamento NON verificato** (gli agenti non hanno accesso al pannello). Coolify può fare un aggiornamento *rolling* (il nuovo container parte mentre il vecchio serve ancora, poi il vecchio si spegne) quando l'applicazione ha un healthcheck, e il `Dockerfile` ne ha uno. Per essere sicuri: **fermare l'applicazione dal pannello (Stop) e solo dopo lanciare il Deploy.** Annotare nel registro di rilascio cosa si è visto (due container contemporanei o no), così la prossima volta il comportamento è noto.

Il `HEALTHCHECK` del `Dockerfile` ha `start-period` di 40 s e 5 tentativi ogni 15 s: un avvio fino a ~115 s non viene dichiarato malato. Con la stima sopra si resta molto sotto.

## 3. Controlli dopo il rilascio R1

1. Log di avvio:
   ```sh
   docker compose logs app --since 15m | grep -E "\[migrate\]"
   ```
   Atteso, in ordine: `canali: fase A`, `migraciones aplicadas`, `canali: fase B`, `canali: fase C`, poi la riga `canali (avvisa): V1=0 V2=0 V3=0 V4=0 V5=0 V6=0 V7=0 | …`. Annotare le durate nel registro di rilascio (servono per R2).
   - Se compare `BD no lista (intento N/15: 55P03 …)`: la fase A ha trovato un lock (transazione lunga) e ritenta da sola ogni 2 s. Se arriva a `falló tras varios intentos`, il container non parte: cercare la transazione lunga con la query della checklist e riprovare il deploy (non c'è nulla da annullare: la fase A annullata non lascia niente).
   - Se una V è diversa da 0 o compare `fase B: «…» non completato`: R1 funziona comunque (legge le colonne vecchie), ma **non procedere a R2**. Vedi «Come leggere V1–V7».
2. Verifiche a mano (sola lettura, conteggi):
   ```sh
   docker compose exec postgres psql -U postgres -d vocero -c "select * from channels_legacy_check();"
   ```
   Atteso: V1…V6 tutte a `0`. (V7 la calcola solo il runner all'avvio.)
3. Oggetti della fase B (sola lettura):
   ```sh
   docker compose exec postgres psql -U postgres -d vocero -c "select c.relname, i.indisvalid from pg_class c join pg_index i on i.indexrelid = c.oid where c.relname in ('contact_org_id_uq', 'message_org_channel_ext_uq');" -c "select conname, convalidated from pg_constraint where conname in ('contact_identity_contact_fk', 'message_channel_ck', 'conversation_channel_account_fk');"
   ```
   Atteso: due indici con `indisvalid = t`, tre vincoli con `convalidated = t`.
4. Prova funzionale dell'owner: un messaggio WhatsApp in entrata e una risposta dal CRM su un numero di prova; la bandeja si aggiorna come prima.

## 4. Rollback di R1 (R1 → R0)

Sicuro e **senza ripristino del backup**: R0 non conosce le colonne nuove e non le legge.

1. **Stop-first** (obbligatorio, D18): fermare il container R1, poi avviare l'immagine precedente (Coolify: Stop, poi *Redeploy* della versione precedente; compose: `git checkout <commit-precedente> && docker compose up -d --build app`).
2. Il migratore di R0 trova nel registro una migrazione più recente della sua ultima (`0013`): **non applica nulla e parte** (provato con l'immagine vera di R0, registro M1.2). Nel log: solo `[migrate] migraciones aplicadas`.
3. **Non cancellare nulla** (tabelle, colonne, funzioni): servono al ritorno.
4. Ritorno a R1 (o, più avanti, a R2): di nuovo **stop-first**. Al primo avvio la riconciliazione riallinea tutto ciò che R0 ha scritto o aggiornato (numeri, token, stato, contatti, conversazioni, messaggi) **prima** di servire traffico; la riga di riepilogo deve tornare a `V1=0 … V7=0`.

## 5. R2 — letture nuove (M1.3, da scrivere quando esiste)

- **Nessuna migrazione Drizzle.** L'immagine di R2 ha la modalità `blocca`: se una verifica è diversa da 0 o la riconciliazione fallisce, il runner esce con codice 1 e il container **non parte** (il log nomina la verifica, per esempio `verifica fallita prima delle migrazioni: V1=1`).
- Prerequisiti: R1 in produzione da almeno 7 giorni (D10) con il riepilogo `V…=0` a ogni avvio; durate dell'avvio annotate.
- Passaggio R1 → R2: può essere rolling (R1 scrive anche le strutture nuove).
- Rollback R2 → R1: sicuro, anche rolling.
- **R2 → R0: da non fare.** Se succede lo stesso: stop-first, e al ritorno a R2 la riconciliazione riallinea prima di servire traffico.
- Se R2 non parte per un'anomalia: tornare a R1 (che parte e scrive le anomalie nel log), poi leggere «Come leggere V1–V7».

## 6. R3 — contrazione (rilascio successivo, non in M1)

- **Irreversibile: il ritorno indietro è solo da backup.** Prerequisiti (T056): R2 in produzione da almeno 7 giorni, backup ripristinato con successo su una copia (M0.4), test end-to-end WhatsApp dell'owner riuscito.
- Il runner riconcilia e verifica in modalità `blocca` **prima** della migrazione che toglie le colonne vecchie (passo 1): con un'anomalia la migrazione non parte.

## Come leggere V1–V7

La fonte eseguibile è la funzione `channels_legacy_check()` (creata dalla `0013`); qui si spiega solo cosa significa ogni numero. Le definizioni complete sono nell'ADR §3.3.

| Verifica | Cosa controlla | Causa tipica se ≠ 0 | Cosa fare |
|---|---|---|---|
| **V1** | ogni riga di `meta_credentials` ha il suo `channel_account`, e nessun account punta a una riga sparita | una riga di `meta_credentials` cancellata a mano (account orfano), oppure un inserimento della riconciliazione fallito | non toccare nulla; fermarsi e chiedere. In R1 il CRM funziona; in R2 non parte |
| **V2** | account uguali **campo per campo** (numero, WABA, nomi, token cifrato, stato, e i campi della coexistence in `config`) | un aggiornamento che la riconciliazione non è riuscita ad applicare (per esempio un numero già usato da un account orfano) | riavviare una volta (la riconciliazione riprova); se resta, fermarsi e chiedere |
| **V3** | ogni contatto ha **una** identità WhatsApp uguale a `wa_identity`, e nessuna identità diverge | `wa_identity` cambiata a mano, o due contatti con la stessa identità | fermarsi e chiedere |
| **V4** | nessuna conversazione reale senza account in un'organizzazione che ne ha uno | riconciliazione non completata | riavviare una volta |
| **V5** | `external_message_id` = `wa_message_id` dove c'è | lotto dei messaggi interrotto | riavviare una volta |
| **V6** | nessuna conversazione con l'account di un'**altra** organizzazione | **non dovrebbe mai succedere** (lo impedisce la FK composta) | fermarsi subito e segnalarlo: è un problema di isolamento (Legge Zero) |
| **V7** | `wapi_credentials` uguale prima e dopo l'avvio | qualcuno ha cambiato una chiave Wapi proprio durante l'avvio | controllare chi; la migrazione non tocca quella tabella |

Per i numeri, sempre e solo `select * from channels_legacy_check();`. Non estrarre righe con dati per capire il problema: chiedere all'agente con i soli conteggi.

## Non verificato

- **Nessuno di questi passi è stato eseguito in produzione** né su una copia della produzione: le misure vengono da dati sintetici su una macchina di sviluppo (registro M1.2, T020).
- Il comportamento di Coolify (rolling o stop-first) non è stato osservato.
- La durata su dati con la forma reale di produzione (più contatti per conversazione, allegati, indici gonfi) può essere diversa: le durate del primo avvio vanno annotate.
- Il caso «più di 2 milioni di messaggi» (fase C dopo l'avvio) non è implementato.
- I nomi del servizio (`postgres`), dell'utente e del database vengono da `docker-compose.yml`; in Coolify possono essere diversi.

## Aggiornamento dopo la revisione avversaria (10/10/2026)
- **V1 > 0 dopo un ripristino delle credenziali:** se una riga di `meta_credentials` viene cancellata e ricreata, al riavvio la riconciliazione riaggancia l'account della stessa organizzazione e V1 torna a 0. Se V1 resta > 0, c'è un conflitto vero (per esempio lo stesso `phone_number_id` in un'altra organizzazione): fermarsi e chiedere.
- **Righe `[canali] doppia scrittura … fallita` nel log dell'app:** non si perde niente, perché la scrittura vecchia è andata a buon fine. Al prossimo riavvio la riconciliazione allinea. Se la riga si ripete a ogni messaggio, fermarsi e chiedere.
- **`init: true`** nel compose: al rilascio il container vecchio si ferma in modo pulito, senza SIGKILL dopo 10 secondi.

