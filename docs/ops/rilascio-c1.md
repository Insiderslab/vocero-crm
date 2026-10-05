# Procedura di rilascio C1 — chiavi bot per organizzazione (con C2 se incluso)

**Per chi:** l'owner (unico autorizzato ad agire in produzione, Legge Zero). **Nessun agente esegue questi passi.**
**Contesto:** istanza CRM con 2 organizzazioni, InsidersLab e La Bambola. Con C1, la vecchia chiave d'istanza `BOT_API_KEY` vale solo se esiste **una** organizzazione: con due risponde `401 instance_key_multi_org`. Ogni bot esterno deve quindi ricevere una chiave `vbk_…` della propria organizzazione **prima** che il nuovo codice vada in produzione, altrimenti il bot si ferma.
**Riferimenti:** `docs/lavoro/2026-10-04-c1-chiavi-bot.md`, `src/server/bot/auth.ts`, `src/server/api-keys.ts`.

> In questo documento non ci sono segreti. Dove serve una chiave è indicato `<CHIAVE_…>`: la chiave vera si copia una sola volta dalla risposta dell'API e si incolla direttamente nella configurazione del bot, mai in chat, ticket, log o git.

## 0. Prima di iniziare (checklist)

- [ ] Il branch con C1 (ed eventualmente C2) è stato rivisto da un agente diverso dall'autore e unito su `main` dall'owner.
- [ ] Si conosce quale bot serve quale organizzazione. Compilare questa tabella **fuori da git** (nomi, non chiavi):

| Organizzazione | Bot / servizio che chiama `/api/bot/*` | Dove si configura la chiave | Consumatori di `/api/export/*` (solo se C2) |
|---|---|---|---|
| InsidersLab | … | … (variabile d'ambiente del bot, n8n, …) | … |
| La Bambola | … | … | … |

- [ ] Conteggio organizzazioni in produzione verificato (atteso: 2). Comando in sola lettura, sul server:
  ```sh
  docker compose exec postgres psql -U postgres -d vocero -c "select id, slug, name, created_at from organization order by created_at;"
  ```
- [ ] Finestra di manutenzione concordata: tra il passo 2 e il passo 4 i bot che usano `BOT_API_KEY` ricevono 401.

## 1. Backup (obbligatorio, prima di tutto)

Sul server, dalla cartella del `docker-compose.yml` (servizio `postgres`, utente `postgres`, database `vocero`):

```sh
TS=$(date -u +%Y%m%dT%H%M%SZ)
docker compose exec -T postgres pg_dump -U postgres -d vocero -Fc > "vocero-pre-c1-$TS.dump"
ls -l "vocero-pre-c1-$TS.dump"                  # dimensione > 0
pg_restore --list "vocero-pre-c1-$TS.dump" | head   # il dump si legge
```

- Annotare l'ultima migrazione applicata (serve per il rollback):
  ```sh
  docker compose exec postgres psql -U postgres -d vocero -c "select id, hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 3;"
  ```
- Copiare il dump fuori dal server secondo la procedura di backup in vigore. **Non procedere senza dump verificato.**

## 2. Rilascio del codice e migrazione 0009

Le migrazioni si applicano da sole all'avvio del container (`Dockerfile`: `node migrate.mjs && node server.js`).

1. Rilasciare la nuova immagine con il metodo abituale (Coolify o `docker compose up -d --build app`).
2. Controllare il log di avvio:
   ```sh
   docker compose logs app --since 10m | grep -E "\[migrate\]"
   ```
   Atteso: `[migrate] migraciones aplicadas`. Se compare `falló`, andare al **Rollback**.
3. Verificare la tabella:
   ```sh
   docker compose exec postgres psql -U postgres -d vocero -c "\d bot_api_key"
   ```
   Attese le colonne `organization_id`, `label`, `key_prefix`, `key_hash`, `created_by`, `last_used_at`, `revoked_at`, l'indice unico `bot_api_key_hash_uq`; se il rilascio include C2 anche la colonna `scope` (default `'bot'`, migrazione `0010`).

## 3. Una chiave `vbk_` per organizzazione

Oggi **non c'è una pagina nel pannello** per le chiavi: si usa l'API di impostazioni, che richiede la sessione di un utente **owner o admin** e crea la chiave **nell'organizzazione attiva** della sessione.

Per ciascuna organizzazione (prima InsidersLab, poi La Bambola):

1. Accedere al CRM come owner/admin.
2. Selezionare l'organizzazione con il selettore in alto (`org-switcher`) e ricaricare la pagina. Controllare che il nome mostrato sia quello giusto: **la chiave nasce nell'organizzazione attiva**.
3. Dalla console del browser, sulla stessa scheda (il cookie di sessione viene inviato da solo):
   ```js
   const r = await fetch("/api/settings/bot-keys", {
     method: "POST",
     headers: { "content-type": "application/json" },
     body: JSON.stringify({ label: "bot-<organizzazione>-2026-10" }),
   });
   console.log(r.status, await r.json());
   ```
   Atteso `201` con `{ id, label, keyPrefix, key }`. Il campo `key` (`vbk_…`) si vede **una sola volta**: copiarlo subito nel posto in cui lo userà il bot (passo 4). Annotare **solo** `id` e `keyPrefix` (12 caratteri) nella tabella del passo 0.
4. Controllo dell'elenco (non mostra mai la chiave intera):
   ```js
   (await (await fetch("/api/settings/bot-keys")).json()).keys
   ```
   Atteso: una chiave attiva per l'organizzazione attiva; la chiave dell'altra organizzazione **non** compare.

Errori possibili: `403 forbidden` (l'utente non è owner/admin di quell'organizzazione), `401` (sessione scaduta).

## 4. Configurazione del bot per organizzazione

Per ogni bot:
1. Sostituire nella sua configurazione l'header `X-API-Key: <BOT_API_KEY>` con `X-API-Key: <CHIAVE_VBK_DELLA_SUA_ORGANIZZAZIONE>`.
2. Riavviare il bot.
3. Non riusare la stessa chiave per due organizzazioni: una chiave identifica **una** organizzazione.

## 5. Verifica

Per ciascuna organizzazione, dal server o dalla macchina del bot (la chiave va passata da variabile d'ambiente, non scritta nella riga di comando salvata nella history):

```sh
read -rs VBK   # incollare la chiave, invio
curl -s -o /dev/null -w "%{http_code}\n" -H "X-API-Key: $VBK" "https://<dominio-crm>/api/bot/context?waIdentity=<numero-di-test-dell-organizzazione>"
unset VBK
```

- Atteso `200` con i dati del contatto di **quella** organizzazione. Un numero che esiste solo nell'**altra** organizzazione non deve mai restituire i suoi dati (atteso: risposta senza contatto o `404`; controllare il comportamento esatto nella route).
- Con la vecchia `BOT_API_KEY` la stessa chiamata deve dare `401` con codice `instance_key_multi_org`.
- `GET /api/settings/bot-keys` (passo 3.4): `lastUsedAt` valorizzato dopo la prima chiamata del bot.
- Prova funzionale: un messaggio di prova per organizzazione arriva e il bot risponde nella conversazione giusta.

## 6. Rimozione di `BOT_API_KEY`

Solo quando entrambi i bot funzionano con la propria chiave `vbk_` da almeno un giorno:
1. Togliere `BOT_API_KEY` dalle variabili d'ambiente del CRM (Coolify o `.env` del server) e riavviare `app`.
2. Ripetere la verifica del passo 5: le chiavi `vbk_` devono continuare a dare `200`; qualunque altro valore deve dare `401`.
3. Togliere la vecchia chiave anche dalle configurazioni dei bot e da qualunque gestore di segreti.

## 7. Se il rilascio include C2 (chiavi di export `vex_`)

Con C2 anche `EXPORT_API_KEY` vale solo con **una** organizzazione e `?org=` non sceglie più l'organizzazione. L'endpoint delle chiavi `vex_` esiste solo **dopo** il passo 2, e con 2 organizzazioni la vecchia `EXPORT_API_KEY` risponde `401 instance_key_multi_org` appena il codice è in linea: l'export resta quindi fermo dal passo 2 finché i consumatori non hanno la chiave nuova. Mettere in pausa i consumatori di `/api/export/*` (n8n, notebook, script) prima del passo 2, poi subito dopo il passo 2:
1. Per ogni organizzazione creare una chiave di export come al passo 3, ma con `POST /api/settings/export-keys` (prefisso `vex_`).
2. Aggiornare ogni consumatore di `/api/export/*` (n8n, notebook, script) con la chiave della sua organizzazione. `?org=` si può togliere; se resta deve essere l'id o lo slug della stessa organizzazione, altrimenti `403 org_mismatch`.
3. Verifica: `GET /api/export/leads` con la chiave di InsidersLab restituisce `"org": "InsidersLab"`; con `?org=<slug-la-bambola>` restituisce `403`. Una chiave `vbk_` su `/api/export/*` dà `401`, e una `vex_` su `/api/bot/*` dà `401`.
4. Rimuovere `EXPORT_API_KEY` con lo stesso criterio del passo 6.

## 8. Revoca di una chiave (in qualsiasi momento)

Dalla console del browser, con l'organizzazione giusta attiva:
```js
await fetch("/api/settings/bot-keys/<id>", { method: "DELETE" })   // 204
```
(per le chiavi di export: `/api/settings/export-keys/<id>`). Una chiave di un'altra organizzazione o di un altro ambito risponde `404`. Effetto immediato: la chiamata successiva con quella chiave riceve `401`.

## Rollback

Ordine: prima il codice, poi (solo se necessario) i dati.

1. **Codice:** ridistribuire l'immagine precedente. La tabella `bot_api_key` e la colonna `scope` sono **aggiuntive**: il codice vecchio le ignora, quindi non serve toccare il database.
2. **Configurazione:** con 2 organizzazioni **non** rimettere `BOT_API_KEY` né `EXPORT_API_KEY`: il codice vecchio tornerebbe a scegliere un'organizzazione arbitraria (`?org=` leggibile da chiunque abbia la chiave, difetto P3), e la Legge Zero vieta di indebolire l'isolamento. Tenere fermi bot ed export finché il codice nuovo non torna in linea. Solo con **una** organizzazione la vecchia chiave si può rimettere come ripiego temporaneo, annotato con data e motivo.
3. **Database (solo se la migrazione ha lasciato uno stato incoerente):** ripristinare il dump del passo 1 a container `app` fermo:
   ```sh
   docker compose stop app
   docker compose exec -T postgres pg_restore -U postgres -d vocero --clean --if-exists < "vocero-pre-c1-<TS>.dump"
   docker compose start app
   ```
   Attenzione: il ripristino perde i dati scritti dopo il backup (messaggi, lead). Preferire il punto 1 quando basta.
4. Le chiavi `vbk_`/`vex_` create restano nel database ma il codice vecchio non le usa; dopo un nuovo rilascio tornano valide se non revocate.

## Non verificato

- Nessuno di questi passi è stato eseguito: la procedura è scritta leggendo il codice, non provata su un ambiente reale.
- La migrazione `0009` (e `0010`) non è stata applicata a un PostgreSQL reale.
- I nomi del servizio (`postgres`), dell'utente e del database vengono da `docker-compose.yml`; in Coolify possono essere diversi.
- La risposta di `/api/bot/context` per un numero inesistente nell'organizzazione non è stata provata: controllarla in `src/app/api/bot/context/route.ts` prima della verifica.
