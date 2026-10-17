# Ronda delle 8:00 al team — guida per il proprietario

Ogni mattina ogni persona del team riceve su WhatsApp, dal numero dell'organizzazione interna («InsidersLab · Interno»), le sue 3 priorità del giorno.

Chi fa cosa:

- **n8n** (oppure un'attività pianificata di Claude) legge Monday, sceglie le priorità e chiama il CRM.
- **Il CRM** invia un modello WhatsApp approvato **solo** ai numeri della lista del team.
- Il CRM **non** parla con Monday: la Costituzione (principio II) vieta nuovi servizi esterni dentro il CRM.

Specifica: `specs/custom-heili/012-ronda-team.md`.

> In questo documento non ci sono segreti. Dove serve la chiave è scritto `<CHIAVE_VBK>`. La chiave vera si copia una sola volta dal CRM e si incolla direttamente nella credenziale di n8n: mai in chat, ticket, log, git o nel JSON del workflow.

## 0. Prerequisiti (una volta sola)

1. L'organizzazione interna ha il numero WhatsApp collegato (**Impostazioni → WhatsApp**).
2. Nella pagina **Agente** → sezione **Accesso riservato**:
   - è spuntato **«Rispondi solo ai numeri della lista»**;
   - la lista contiene i numeri del team, uno per riga, con `+` e prefisso (es. `+39 347 123 4567`).

   **Questa lista è l'elenco dei destinatari della ronda, e l'unico.** Senza la spunta, o con la lista vuota, la ronda risponde `409 no_team_list` e non invia nulla. Un cliente, anche se scrive allo stesso numero, non la riceve mai. Massimo 50 numeri.

## 1. Il modello Utility `ronda_mattutina`

Di mattina la finestra di 24 ore con i colleghi di solito è chiusa. Serve quindi un **modello approvato da Meta**.

**Va creato dal CRM**, non dal pannello di Meta: la sincronizzazione aggiorna lo stato dei modelli che il CRM conosce, ma non importa quelli creati altrove.

1. **Impostazioni → Modelli** → nuovo modello, due volte (una per lingua). Il nome è lo stesso, la lingua cambia:

   | Campo | Italiano | Spagnolo |
   |---|---|---|
   | Nome | `ronda_mattutina` | `ronda_mattutina` |
   | Lingua | `it` | `es` |
   | Categoria | Utility | Utility |
   | Corpo | `Buongiorno {{1}}! Le priorità di oggi: {{2}}. Dettagli su Monday.` | `¡Buenos días {{1}}! Prioridades de hoy: {{2}}. Detalles en Monday.` |

   - `{{1}}` è il nome della persona e `{{2}}` le priorità, su **una riga**.
   - Il corpo non comincia e non finisce con una variabile: è una regola di Meta.
2. Meta approva in minuti o in qualche giorno. Per vedere lo stato aggiornato: **Impostazioni → Modelli → Sincronizza**. La ronda parte solo con lo stato **approvato**: prima risponde `422 template_not_approved`.
3. **Riclassificazione:** Meta può decidere che il modello è *Marketing* e non *Utility*. Il CRM mostra la categoria che decide Meta dopo la sincronizzazione. Con *Marketing*:
   - ogni messaggio costa di più;
   - valgono i limiti di frequenza dei messaggi di marketing (un collega potrebbe non riceverlo in qualche giorno);
   - il collega può disattivare i messaggi di marketing dell'azienda.

   Per restare *Utility* il testo deve restare informativo, legato al lavoro, senza promozioni né inviti all'acquisto. Se Meta lo riclassifica lo stesso, si può fare ricorso dal WhatsApp Manager, oppure accettare il costo.

Nota sul costo: un modello Utility inviato mentre la finestra di 24 ore con quella persona è aperta non si paga (listino Meta a messaggio, dal 1° luglio 2025). Il CRM invia comunque il modello a tutti, anche con la finestra aperta, così ognuno riceve lo stesso messaggio.

## 2. La chiave `vbk_` per n8n

1. Accedere come **owner o admin**. Con il selettore in alto scegliere l'organizzazione **interna**: la chiave nasce nell'organizzazione attiva, ed è quella che decide da quale numero e a quale lista parte la ronda.
2. **Impostazioni → Chiavi API** → sezione **Chiavi del bot (vbk_)** → nome, per esempio `n8n-ronda-2026-10` → **Crea chiave**.
3. La chiave compare **una sola volta**:
   - **Copia chiave**;
   - incollarla subito nella credenziale di n8n (passo 3);
   - **Nascondi**.
4. Se la chiave esce dove non deve: revocarla nella stessa pagina, crearne una nuova e aggiornare la credenziale di n8n.

## 3. Workflow n8n (schema)

```
[Schedule Trigger]  ogni giorno 07:55, fuso Europe/Rome
        │
[Monday]            elementi con scadenza oggi o scaduti, per persona assegnata
        │
[Code / LLM]        per ogni persona: 3 priorità su UNA riga
        │           "1) … · 2) … · 3) …"
        │
[HTTP Request]      POST https://<crm>/api/bot/team-broadcast
```

**Schedule Trigger.** Modalità «Cron» `55 7 * * *`. Nelle impostazioni del workflow il fuso orario deve essere `Europe/Rome`, così l'ora resta giusta anche con l'ora legale.

**Monday.** Nodo Monday.com con la sua credenziale (resta in n8n, non nel CRM). Board dei progetti, elementi con:

- data di scadenza ≤ oggi;
- stato diverso da «Fatto».

Raggruppare per persona assegnata, usando la colonna «Persone» o l'email. Serve una piccola tabella *persona → numero WhatsApp* con gli stessi numeri della lista del team, scritti con `+` e prefisso. Può essere un nodo «Set», oppure una board Monday «Team» con la colonna telefono.

**LLM.** Un nodo «Basic LLM Chain» o «OpenAI» (o il modello che usate) per persona. Prompt di esempio:

> Hai l'elenco delle attività di {{nome}} in scadenza oggi o in ritardo. Scegli le 3 più importanti (prima le scadute, poi quelle di clienti, poi il resto). Rispondi con UNA SOLA riga, senza a capo, in questo formato esatto: `1) … · 2) … · 3) …`. Massimo 300 caratteri. Se le attività sono meno di 3, elenca solo quelle.

Il CRM comunque normalizza i parametri: un «a capo» o un tab diventano uno spazio, spazi multipli diventano uno. Massimo 1024 caratteri per parametro.

**Code (unire).** Costruire **un solo** body per tutta la ronda:

```json
{
  "templateName": "ronda_mattutina",
  "language": "it",
  "params": ["team", "nessuna priorità assegnata oggi: controlla Monday"],
  "perRecipient": {
    "+39 347 123 0001": ["Marco", "1) Offerta Rossi · 2) Call Bianchi · 3) Report settimanale"],
    "+39 347 123 0002": ["Giulia", "1) Bozza sito Verdi · 2) Revisione copy · 3) Demo alle 15"]
  }
}
```

- `perRecipient` personalizza: numero della lista → i suoi parametri (`{{1}}` nome, `{{2}}` priorità).
- Chi è nella lista ma non ha una voce riceve `params`. Conviene quindi un testo di ripiego sensato.
- Una voce con un numero **fuori** dalla lista viene ignorata (la risposta la riporta mascherata in `unknownRecipients`): il CRM non scrive mai a chi non è nella lista.
- **Lingua.** Ogni chiamata usa una sola lingua e va a **tutta** la lista, perché la lista è una sola per organizzazione. Il modello `es` serve a un'organizzazione con il team che parla spagnolo, con la sua lista e la sua chiave. Con un team misto (italiano e spagnolo nella stessa lista) oggi bisogna scegliere una lingua per tutti. Se serve, si può aggiungere un filtro `recipients` facoltativo, sempre ristretto ai numeri della lista: è una decisione aperta, vedi il registro del lavoro.

**HTTP Request.**

- Method `POST`, URL `https://<dominio-del-crm>/api/bot/team-broadcast`.
- **Authentication:** «Generic Credential Type» → **Header Auth**, con una credenziale n8n che ha:
  - Name `X-API-Key`;
  - Value `<CHIAVE_VBK>`.

  **Mai** la chiave nel campo «Headers» del nodo o nel JSON del workflow: un workflow esportato o condiviso la porterebbe con sé. Le credenziali di n8n restano cifrate e fuori dall'export.
- Header aggiuntivo `Idempotency-Key` = `ronda-{{ $now.setZone('Europe/Rome').toFormat('yyyy-MM-dd') }}`. È la difesa contro i doppioni: se n8n ritenta (timeout, riavvio, esecuzione manuale) la stessa chiave entro 36 h restituisce il risultato della prima volta e **non invia nulla**.
- Body: JSON, l'oggetto del nodo precedente.
- Timeout: almeno 60 s. Il CRM invia un messaggio ogni ~150 ms e risponde quando ha finito.
- Retry on fail: sì. È sicuro grazie all'`Idempotency-Key`.

**Avviso (facoltativo).** Un nodo IF dopo la HTTP Request: se `failed > 0` oppure lo status non è 200, mandare un messaggio a chi gestisce n8n.

### Prima prova

- Stessa chiamata con `"dryRun": true` e una chiave di prova (es. `prova-1`). Fa tutti i controlli (lista, modello, parametri) e risponde con l'elenco dei destinatari mascherati (`…001`), senza inviare nulla e senza consumare il limite.
- Poi una chiamata vera. Nella pagina **Agente → Accesso riservato** compare «Ronda: ultima inviata il … a N persone (esito)», e in **Posta** ogni collega ha il messaggio nella sua conversazione.

## 4. Alternativa: attività pianificata di Claude

Con un'attività pianificata di Claude che ha accesso al connettore Monday (e nessun n8n):

- Pianificazione: ogni giorno alle 07:55 Europe/Rome.
- Istruzione, in sostanza: «Leggi su Monday gli elementi in scadenza oggi o scaduti per ogni persona del team; scegli 3 priorità per persona su una riga `1) … · 2) … · 3) …`; chiama `POST https://<crm>/api/bot/team-broadcast` con `X-API-Key` dal segreto dell'ambiente e `Idempotency-Key: ronda-<data di oggi>`; riporta `sent`/`failed`.»
- La chiave `vbk_` va nei **segreti dell'ambiente** dell'attività, non nel testo dell'istruzione.
- Stesso body e stesse regole di n8n. Se l'attività riparte due volte nello stesso giorno, l'`Idempotency-Key` con la data evita il doppio invio.

## 5. Risposte del CRM

| Stato | `code` | Significato / cosa fare |
|---|---|---|
| 200 | — | Fatto. `sent`, `failed`, `skipped` e `results` per persona (numeri mascherati). `replayed: true` = era una ripetizione: nulla di nuovo inviato. |
| 400 | `idempotency_key_required` | Manca l'header `Idempotency-Key` (1–128 caratteri `A-Z a-z 0-9 . _ : -`). |
| 401 | `unauthorized` | Chiave assente, sbagliata, revocata o non `vbk_`. |
| 409 | `no_team_list` | Accesso riservato spento o lista vuota (passo 0). |
| 409 | `team_too_large` | Più di 50 numeri in lista. |
| 409 | `not_connected` / `reconnect_required` | Numero non collegato o token scaduto: **Impostazioni → WhatsApp**. |
| 409 | `broadcast_in_progress` | Una ronda con la stessa chiave è in corso, oppure si è interrotta a metà (riavvio). Non si reinvia per non duplicare: se serve, usare una chiave nuova. |
| 422 | `template_not_found` | Nessun modello con quel nome e quella lingua nel CRM (crearlo dal CRM, passo 1). |
| 422 | `template_not_approved` | Modello non ancora approvato da Meta: **Sincronizza** e riprovare. |
| 422 | `template_params_mismatch` | Numero di parametri diverso dalle variabili del modello (per `ronda_mattutina`: 2), in `params` o in una voce di `perRecipient`. |
| 422 | `invalid_body` | Body non valido: campo sconosciuto, parametro vuoto o oltre 1024 caratteri, numero di `perRecipient` senza `+`. |
| 429 | `rate_limited` | Più di 3 ronde nell'ultima ora per l'organizzazione. L'header `Retry-After` dice quanti secondi attendere. |

Per persona:

- `failed` con `error`:
  - `meta_error`: Meta ha rifiutato quel numero, per esempio perché non ha WhatsApp;
  - `meta_unavailable`: Meta momentaneamente giù.
- `skipped` con `reason`:
  - `dry_run`;
  - `aborted`: dopo un errore che vale per tutti (token scaduto) il CRM smette di chiamare Meta.

## 6. Cosa resta nel CRM

- Ogni messaggio della ronda è in **Posta**, nella conversazione del collega (tipo modello, testo completo).
- Una riga per ronda nella tabella `team_broadcast`: chiave, modello, conteggi ed esito, con i numeri mascherati. **I parametri non vengono salvati lì**: il testo sta già nei messaggi.
- Nei log del server compare solo il riepilogo (`[team-broadcast] … N inviati, M falliti`) e, per gli errori, le ultime 3 cifre del numero. Mai le priorità né i numeri completi.
