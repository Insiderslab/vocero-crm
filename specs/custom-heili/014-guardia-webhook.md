# 014 — Guardia del webhook WhatsApp

> **Pacchetto 014** · branch `feat/014-guardia-webhook` (base `origin/main` @ `db6f426`) · 2026-10-16.
> **Carril: corto** — nessuna migrazione, nessun cambio al modello dati.
> ⚠ Scritto durante l'implementazione, a partire dalla richiesta dell'owner (16/10):
> documenta le decisioni prese (Principio VI).

## Problema

Il 16/10 i messaggi del +1 555 non arrivavano al CRM e nessuno se n'era accorto. Un
flusso n8n con il nodo «WhatsApp Trigger» si era iscritto come **callback dell'app Meta**
al posto del CRM: Meta mandava gli eventi a `insiderslab.app.n8n.cloud`. Per vederlo è
servito uno script di diagnosi sul VPS; per sistemarlo, un altro script
(`ripristina-webhook.sh`) lanciato dal terminale.

## Comportamento osservabile

### A. Controllo (owner/admin, `GET /api/settings/whatsapp/route-check`)
1. Con un numero collegato, il CRM chiede a Meta `GET {phone-number-id}?fields=webhook_configuration`
   con il token dell'organizzazione. Vince l'indirizzo più specifico: override sul
   numero → override sul WABA → callback dell'app.
2. Stati: **ok** (è il CRM); **elsewhere** (il callback dell'APP è un altro sistema, o il
   CRM con un token vecchio: `sameHost`); **override** (override su WABA/numero verso
   altro); **missing** (nessun indirizzo); **unknown** (Meta non risponde, gateway Wapi,
   campo assente: mai un allarme).
3. Risposta senza segreti: dell'indirizzo estraneo **solo l'host** (il percorso può
   contenere il token di un altro sistema), del nostro niente.
4. Cache in memoria di 10 minuti per organizzazione; `?refresh=1` («Controlla adesso»)
   ricontrolla, ma non più di una volta ogni 30 secondi.
5. **Silenzio insolito**: media ≥ 3 messaggi in entrata al giorno nei 14 giorni **prima
   dell'ultimo messaggio** (conversazioni vere, non Laboratorio) e nessun messaggio da
   ≥ 24 ore. Le statistiche si calcolano solo con `?stats=1` (pagina WhatsApp). Un numero nuovo
   o poco usato non fa mai scattare l'avviso.

### B. Interfaccia
1. **Impostazioni → WhatsApp**, sopra la striscia di stato:
   - allarme (elsewhere/override/missing): riquadro rosso con l'host e il rimedio;
   - ok: una riga «Meta manda i messaggi al CRM (controllato X fa)»;
   - silenzio insolito: riquadro giallo con «Controlla adesso».
2. **In tutta l'app** (owner/admin, tranne la pagina WhatsApp): barra rossa «WhatsApp: i
   messaggi non arrivano al CRM» con il link alla pagina. Si ricontrolla ogni 15 minuti.
3. Ai member non si mostra niente (non possono intervenire).

### C. Ripristino (solo super-admin, `POST /api/admin/platform/meta/webhook`)
1. Pulsante «Ripristina il collegamento al CRM» nel riquadro rosso, solo se chi guarda è
   super-admin e lo stato è elsewhere/missing (un override non si toglie così: il testo
   dice di toglierlo su Meta). Conferma esplicita: il cambio vale per **tutte** le aziende
   collegate all'app.
2. `POST {app-id}/subscriptions` con il token dell'app (`app_id|app_secret`, nell'header
   Authorization, mai nella URL), `callback_url` = `<APP_BASE_URL>/api/webhooks/wa/<token>`,
   `verify_token`, i 6 campi di 006/013. Equivale a `ripristina-webhook.sh`.
3. Esito: 200 `{ ok: true }` e cache svuotata; 409 senza App Secret/App ID o con il gateway
   Wapi; 502 se Meta rifiuta, con il messaggio di Meta ripulito da segreti.
4. Prima del pulsante, una nota: spegnere nell'altro sistema il flusso collegato a
   WhatsApp, altrimenti si riprende i messaggi.

### D. Giro orario (instrumentation)
Ogni ora (`WEBHOOK_ROUTE_CHECK_MS`, default 3600000; primo giro 60 s dopo l'avvio) si
ricontrollano tutte le organizzazioni con un numero `connected`. Nei log
`[webhook-guard]` solo quando un numero smette di arrivare al CRM (con host e livello) o
torna. Niente email, Slack o push (Constitución II). Spento con il gateway Wapi.

## Fuori ambito
- Togliere un override su WABA/numero dal CRM (lo imposta chi gestisce l'override).
- Togliere Clientify Inbox o altre app iscritte al WABA (non deviano il callback dell'app).

## Prove
- `tests/unit/webhook-route-guard.test.ts` (31): classificazione, silenzio, controllo con
  Meta (doppio di fetch), cache, ripristino, niente segreti, vista.
- `tests/golden/webhook-route-guard.golden.test.ts` (11, PostgreSQL vero): ruoli delle due
  rotte, chiamate a Graph registrate, statistiche per organizzazione, Laboratorio escluso.
- Inventario dei ruoli: `settings/whatsapp/route-check` (admin),
  `admin/platform/meta/webhook` (superadmin).
