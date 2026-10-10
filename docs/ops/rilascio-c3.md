# Procedura di rilascio C3 — chiave Wapi per organizzazione

**Per chi:** l'owner (unico autorizzato ad agire in produzione, Legge Zero). **Nessun agente esegue questi passi.**
**Cosa cambia:** prima una sola `WAPI_API_KEY` globale serviva tutte le organizzazioni elencate in `WAPI_ORG_IDS` (o **tutte** se l'elenco era vuoto): due clienti del CRM usavano la chiave Wapi di una sola organizzazione Wapi. Ora ogni organizzazione del CRM ha la **propria** chiave `hlp_live_…`, salvata cifrata (stessa `ENCRYPTION_KEY` del token Meta), gestita da owner/admin in **Impostazioni → WhatsApp → Chiave Wapi**.
**Riferimenti:** `docs/lavoro/2026-10-10-c3-wapi.md`, `specs/custom-heili/003-integracion-wapi.md` (addendum C3), `src/lib/meta/client.ts`, `src/server/whatsapp/wapi-credentials.ts`.

> In questo documento non ci sono segreti. Le chiavi Wapi si incollano **una volta** nel campo della pagina e non vengono più mostrate (solo gli ultimi 4 caratteri). Mai in chat, ticket, log o git.

## Regola di instradamento (da conoscere prima di toccare qualcosa)

Con `WAPI_BASE_URL` definita, per ogni chiamata a Meta di un'organizzazione:

| Situazione | Esito |
|---|---|
| L'organizzazione ha una chiave Wapi propria attiva | **Wapi con quella chiave** |
| Nessuna chiave propria, `WAPI_API_KEY` presente e `WAPI_ORG_IDS` contiene **esattamente una** organizzazione, ed è questa (modo legacy) | Wapi con la chiave globale |
| Nessuna chiave propria e `WAPI_ORG_IDS` elenca **più** organizzazioni, questa inclusa | **Bloccata**: nessuna chiamata, errore di invio. Mai la chiave di un'altra |
| Qualunque altro caso (anche `WAPI_ORG_IDS` **vuota** con la chiave globale) | **Diretto a Meta** con il token Meta dell'organizzazione. La chiave globale non viene usata |
| `WAPI_BASE_URL` non definita | Tutto diretto a Meta (come prima) |

Attenzione: con la configurazione vecchia `WAPI_ORG_IDS` vuota + `WAPI_API_KEY` valorizzata **tutte** le organizzazioni passavano da Wapi. Con C3 passerebbero **dirette a Meta** finché non hanno la chiave propria. Si evita con il passo 1.

## 0. Prima di iniziare (checklist)

- [ ] Il branch con C3 è stato rivisto da un agente diverso dall'autore (modifica security-critical) e unito su `main` dall'owner.
- [ ] Si conosce la configurazione attuale **in produzione** delle tre variabili (leggerle dal pannello Coolify o dal `.env` del server, **senza copiarne il valore in chat**): `WAPI_BASE_URL` definita? `WAPI_API_KEY` presente? `WAPI_ORG_IDS` vuota, con una o con più organizzazioni?
- [ ] Per **ogni** organizzazione del CRM che oggi passa da Wapi esiste (o si può creare nel pannello di Wapi) una chiave `hlp_live_…` **dedicata a quell'organizzazione/cliente**. Una chiave per cliente: non riusare la stessa per due organizzazioni, altrimenti il problema che C3 risolve resta. Tabella da compilare **fuori da git** (nomi, non chiavi):

| Organizzazione CRM (dal pannello Admin) | Chiave Wapi dedicata creata nel pannello Wapi? | Numero/i Wapi collegato/i |
|---|---|---|
| … | … | … |

## 1. Prima del rilascio: configurazione che non interrompe nessuno (SEQUENZA OBBLIGATORIA)

Obiettivo: nessun invio cambia strada nel momento in cui parte il codice nuovo.

> **STOP: non rilasciare il codice C3 prima di aver chiuso questo passo.** Se in produzione `WAPI_API_KEY` è valorizzata e `WAPI_ORG_IDS` è **vuota**, con il codice nuovo **tutte** le organizzazioni smettono di passare da Wapi e vanno dirette a Meta con il token in `meta_credentials`. Un'organizzazione le cui credenziali Meta stanno solo in Wapi riceve 401, viene marcata «da ricollegare» (`reconnect_required`) e **resta scollegata anche dopo** aver sistemato la configurazione. Il comportamento è voluto (decisione dell'owner: «lista vuota + chiave globale» non cambia) e per questo la sequenza è obbligatoria:
>
> 1. Leggere (senza copiare i valori in chat) `WAPI_BASE_URL`, `WAPI_API_KEY`, `WAPI_ORG_IDS` dalla produzione.
> 2. Se `WAPI_API_KEY` è valorizzata e `WAPI_ORG_IDS` è vuota: **prima del deploy** scrivere in `WAPI_ORG_IDS` l'id di **una sola** organizzazione (quella che oggi passa da Wapi), oppure, con più organizzazioni, seguire il secondo punto sotto.
> 3. Solo dopo, rilasciare (passo 2).
> 4. All'avvio il CRM scrive nei log, **senza segreti**, un avviso che comincia con `[boot] WAPI_API_KEY está definida pero WAPI_ORG_IDS está vacía` quando incontra proprio questa combinazione: dopo il rilascio verificarne l'assenza (`docker compose logs app --since 10m | grep "WAPI_ORG_IDS está vacía"` deve restituire nulla). Se compare, la configurazione è ancora quella pericolosa.

- **Una sola organizzazione passa da Wapi** (o `WAPI_ORG_IDS` ha già una sola organizzazione): mettere `WAPI_ORG_IDS=<id di quella organizzazione>` (se vuota) e lasciare `WAPI_API_KEY`: è il modo legacy, identico a oggi.
- **Più organizzazioni passano da Wapi con la chiave globale** (o `WAPI_ORG_IDS` vuota con più organizzazioni): con C3 non c'è modo legacy sicuro per più organizzazioni. Scegliere una finestra di manutenzione breve e fare i passi 2-3 **subito** dopo il rilascio: nel frattempo le organizzazioni elencate in `WAPI_ORG_IDS` risponderanno "bloccate" (errore di invio, nessuna chiamata) e quelle non elencate andranno dirette a Meta con il proprio token.
- Verificare quali organizzazioni hanno ancora un token Meta valido in `meta_credentials`: quelle che cadono su "diretto a Meta" lo useranno.

## 2. Rilascio del codice e migrazione 0011

Le migrazioni si applicano da sole all'avvio del container (`Dockerfile`: `node migrate.mjs && node server.js`). **Prima**, backup come in `docs/ops/rilascio-c1.md` §1 (dump verificato, ultima migrazione annotata).

1. Rilasciare la nuova immagine con il metodo abituale.
2. Log di avvio: `docker compose logs app --since 10m | grep -E "\[migrate\]"` → atteso `[migrate] migraciones aplicadas`.
3. Verificare la tabella (solo struttura, nessun dato sensibile):
   ```sh
   docker compose exec postgres psql -U postgres -d vocero -c "\d wapi_credentials"
   ```
   Attese le colonne `id, organization_id, key_cipher, key_iv, key_tag, key_last4, created_by, created_at, updated_at, revoked_at` e l'indice unico `wapi_credentials_org_uq`.

## 3. Una chiave Wapi per organizzazione

Per ciascuna organizzazione, una alla volta:

1. Accedere al CRM come owner/admin e selezionare l'organizzazione con il selettore in alto. **Controllare il nome mostrato**: la chiave si salva nell'organizzazione attiva.
2. **Impostazioni → WhatsApp**, scheda **Chiave Wapi di questa organizzazione** (visibile solo a owner/admin).
3. Incollare la chiave `hlp_live_…` dedicata a quell'organizzazione e premere **Salva chiave**. Compare «Chiave salvata (…ultimi4)»: la chiave intera non viene più mostrata. La scheda mostra anche come viaggiano gli invii: «passano da Wapi con la sua chiave».
4. Annotare nella tabella del passo 0 solo gli ultimi 4 caratteri.

Errori possibili: «La chiave deve iniziare con hlp_live_» (si è incollato un token Meta o una chiave di un altro tipo); nessuna scheda (l'utente non è owner/admin dell'organizzazione).

## 4. Verifica

- Per ogni organizzazione, scheda Chiave Wapi: stato «Chiave salvata», instradamento «con la sua chiave» (se manca la riga, `WAPI_BASE_URL` non è definita nell'istanza: la scheda lo avvisa).
- Invio reale di prova per organizzazione (messaggio di testo, poi un allegato): arriva dal **numero giusto**; in Wapi la chiamata risulta fatta con la chiave di **quella** organizzazione (nel pannello Wapi, ultimo uso della chiave).
- Scaricare un allegato in entrata (anteprima nell'inbox). **Controllo specifico C3:** il CRM invia la chiave Wapi solo a URL dello stesso dominio di `WAPI_BASE_URL`. Se Wapi restituisse l'URL di download su un dominio diverso, l'allegato non si scarica (nessuna chiave inviata): in tal caso l'owner deve verificare il dominio restituito da Wapi e allinearlo a `WAPI_BASE_URL`.
- Incrociato tra organizzazioni: da A, un invio **non** deve comparire come attività della chiave di B in Wapi.

## 5. Pulizia delle variabili globali

Quando **tutte** le organizzazioni che usano Wapi hanno la propria chiave e la verifica è passata da almeno un giorno:
1. Togliere `WAPI_API_KEY` e `WAPI_ORG_IDS` dalle variabili d'ambiente del CRM (Coolify o `.env` del server). Lasciare `WAPI_BASE_URL`.
2. Riavviare `app` e ripetere la verifica del passo 4: gli invii devono continuare a passare da Wapi (le chiavi proprie bastano).
3. Togliere la vecchia chiave globale anche da ogni gestore di segreti.

## 6. Revoca o sostituzione di una chiave

Scheda **Chiave Wapi** dell'organizzazione giusta: **Revoca chiave** (con conferma) oppure incollare una chiave nuova e **Salva chiave** (sostituisce e riattiva). Dopo la revoca l'organizzazione **non** usa la chiave di un'altra: va diretta a Meta con il proprio token, oppure, se `WAPI_ORG_IDS` elenca più organizzazioni, risulta bloccata finché non ha una chiave nuova. Se la chiave viene revocata nel pannello di Wapi (e non qui), le chiamate ricevono 401 da Wapi: sostituirla qui.

## Rollback

1. **Codice:** ridistribuire l'immagine precedente. La tabella `wapi_credentials` è **aggiuntiva**: il codice vecchio la ignora, non serve toccare il database. **Attenzione:** il codice vecchio torna a usare `WAPI_API_KEY` per tutte le organizzazioni di `WAPI_ORG_IDS` (o tutte, se vuota). Con più organizzazioni **non** rimettere la chiave globale: la Legge Zero vieta di indebolire l'isolamento. Preferire lasciare gli invii diretti a Meta (togliere `WAPI_BASE_URL`) finché il codice nuovo non torna in linea.
2. **Database (solo se la migrazione ha lasciato uno stato incoerente):** ripristinare il dump come in `rilascio-c1.md`, Rollback punto 3. Perde i dati scritti dopo il backup.
3. Le chiavi salvate restano cifrate nella tabella; con il codice nuovo tornano valide se non revocate.

## Non verificato

- Nessuno di questi passi è stato eseguito in produzione: la procedura è scritta dal codice.
- La migrazione `0011` è stata applicata (da zero e due volte di seguito) solo su un PostgreSQL 16 locale usa e getta, non su una copia dei dati di produzione.
- La chiave **non** viene provata contro Wapi al salvataggio: una chiave sbagliata (ma con prefisso corretto) si scopre al primo invio (401 da Wapi).
- Il comportamento con un 401 di Wapi sulla chiave propria non è cambiato: oggi un 401 marca la connessione come "da ricollegare" come per un token Meta scaduto.
- Il formato esatto delle chiavi Wapi (lunghezza, caratteri) non è documentato nel repository: il CRM controlla solo il prefisso `hlp_live_` e almeno 16 caratteri senza spazi.
- Il dominio con cui Wapi riscrive l'URL di download dei media non è stato verificato contro un Wapi reale (vedi passo 4).
- La scheda non è stata provata in un browser contro un database reale (solo test di rendering e delle API).
