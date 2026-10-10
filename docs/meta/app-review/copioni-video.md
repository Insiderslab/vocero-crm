# Copioni dei video dimostrativi

> Fondati sulla skill `whatsapp-meta-app-review` (`approved-flow.md`, `rejection-patterns.md`). Regole: lineari, 2-4 minuti, **solo schermate reali del prodotto** (mai Postman, n8n, log o console), voce o sottotitoli in inglese, interfaccia in inglese (cambiare la lingua del CRM con il pulsante in alto), schermo del dispositivo del destinatario inquadrato quando serve. Nessun segreto visibile: coprire token e chiavi; usare un'utenza di prova (`<REVIEW_USER_EMAIL>`), mai password in video.
> Ogni scena indica il permesso che dimostra: la nota in `note-permessi.md` deve descrivere esattamente queste scene.
> **Non si registra finché K2/K3/K4 non sono reali** (vedi `README.md`). Le scene che dipendono da funzioni non ancora costruite sono segnate **[DIPENDE DA Kx]**.

## Preparazione comune

- Organizzazione di prova **dedicata alla revisione**, senza dati di clienti reali. Contatti di prova con consenso (i tuoi).
- Browser pulito, finestra a risoluzione piena, registrazione dello schermo con audio. Un secondo dispositivo (telefono) inquadrato per i messaggi in arrivo.
- Prima di registrare: provare il flusso intero due volte. Il build di revisione deve essere «noiosamente affidabile»: variabili d'ambiente complete, OAuth coerente col dominio, numero operativo, modello già approvato.
- Aprire con una schermata che mostra l'URL pubblico di privacy `https://<CRM_DOMAIN>/privacy`.

---

## Video 1 — WhatsApp  [DIPENDE DA K2]

Permessi: `whatsapp_business_management`, `whatsapp_business_messaging`. Durata: 3-4 minuti.

| # | Scena (cosa si vede) | Voce (inglese) | Permesso |
|---|---|---|---|
| 1 | Pagina pubblica `/privacy` e login del CRM | "This is Heili CRM, a messaging CRM for businesses. Each business connects its own WhatsApp number and its team answers customers from a shared inbox." | — |
| 2 | Accesso come utente di prova, pagina **Channels** → «Connect WhatsApp» | "I log in as a business user and open the Channels page. I click Connect WhatsApp." | — |
| 3 | Popup di **Embedded Signup v4**: login Meta, scelta/creazione del WABA, scelta del numero, **schermata dei permessi richiesti** con consenso | "The official Meta Embedded Signup opens. I log in with my own Meta account, choose my business account and phone number, and grant the requested permissions." | management |
| 4 | Ritorno al CRM: scheda WhatsApp «Connected» con **numero visualizzato, WABA ID e Phone Number ID** | "Back in the app, the connection is saved. Heili reads the connected business account and shows the phone number and its IDs." | management |
| 5 | Pagina **Templates**: elenco dei modelli letti dall'account; crea un nuovo modello (es. promemoria appuntamento, categoria UTILITY) → stato **Pending** | "Heili lists the message templates of this account. I create a new appointment reminder template and submit it to Meta. It shows as pending." | management |
| 6 | Un modello già **Approved** compare come approvato (dopo sincronizzazione) | "This template was already approved, and its status is read from the account." | management |
| 7 | Dal telefono di prova: invio di un messaggio al numero collegato → compare nella **Inbox** del CRM | "A customer writes to the business number from a phone. The message arrives in the shared inbox in real time." | messaging |
| 8 | Risposta libera dall'Inbox entro 24 ore → telefono: messaggio ricevuto | "Inside the 24-hour window the team replies with a free-form message. Here it is on the customer's phone." | messaging |
| 9 | Conversazione fuori finestra (contatto di prova più vecchio di 24 ore): il campo libero è bloccato, resta il selettore dei **modelli approvati**; invio del modello → telefono: messaggio ricevuto | "When the 24-hour window is closed, the app only allows approved templates. I send the approved template to the opted-in test contact. Here it is on the phone." | messaging |
| 10 | Stato di consegna/lettura aggiornato nell'Inbox | "Delivery and read status come back to the inbox." | messaging |
| 11 | Pagina **Channels** → «Disconnect» e `/cancellazione-dati` | "The business can disconnect at any time, and the data deletion instructions are public at this address." | — |

Prova da portare: numero e ID letti dall'account vero, modello vero, messaggio vero sul dispositivo vero.

---

## Video 2 — Instagram  [DIPENDE DA K3]

Permessi: `instagram_business_basic`, `instagram_business_manage_messages`. Durata: 2-3 minuti.

| # | Scena | Voce (inglese) | Permesso |
|---|---|---|---|
| 1 | Pagina pubblica `/privacy`, login del CRM, pagina **Channels** | "This is Heili CRM. A business connects its Instagram professional account to answer Direct messages from its shared inbox." | — |
| 2 | «Connect Instagram» → **Business Login for Instagram**: login Instagram con l'account di prova, **schermata dei permessi** con consenso | "I click Connect Instagram. The official Instagram login opens, I log in with the business account and approve the requested permissions." | basic, manage_messages |
| 3 | Ritorno al CRM: scheda Instagram «Connected» con **username, nome profilo e ID** | "The connection is saved. Heili shows the username and name of the connected account." | basic |
| 4 | Da un secondo account Instagram (telefono): invio di un DM all'account collegato | "From another Instagram account, a customer sends a Direct message to the business." | manage_messages |
| 5 | Il messaggio compare nell'**Inbox** con nome e foto del mittente | "The message arrives in the inbox, with the sender's name and picture." | basic, manage_messages |
| 6 | Risposta dall'Inbox → telefono: messaggio ricevuto in Instagram | "The team replies from the inbox. Here it is in Instagram on the customer's phone." | manage_messages |
| 7 | Contatto con ultimo messaggio oltre la finestra: invio bloccato con l'avviso | "Outside the 24-hour window the app does not allow sending, so we never message people outside the allowed window." | manage_messages |
| 8 | «Disconnect» e `/cancellazione-dati` | "The business can disconnect at any time. Data deletion instructions are public at this address." | — |

---

## Video 3 — Messenger  [DIPENDE DA K4]

Permessi: `pages_show_list`, `pages_manage_metadata`, `pages_messaging` (+ `pages_read_engagement` solo se confermato). Durata: 2-3 minuti.

| # | Scena | Voce (inglese) | Permesso |
|---|---|---|---|
| 1 | Pagina pubblica `/privacy`, login del CRM, pagina **Channels** | "This is Heili CRM. A business connects its Facebook Page to answer Messenger conversations from its shared inbox." | — |
| 2 | «Connect Facebook» → **Facebook Login for Business**, schermata dei permessi, consenso | "I click Connect Facebook, log in with my Facebook account and approve the requested permissions." | pages_show_list |
| 3 | Elenco delle **Pagine** gestite dall'utente; scelta di una Pagina | "Heili shows the Pages I manage. I choose the Page to connect." | pages_show_list |
| 4 | Scheda Messenger «Connected» con nome e ID della Pagina; la Pagina risulta iscritta ai webhook | "The Page is connected and subscribed to our webhook so its Messenger messages reach the inbox." | pages_manage_metadata |
| 5 | Da un profilo Facebook di prova: messaggio alla Pagina → compare nell'**Inbox** | "A customer sends a message to the Page on Messenger. It arrives in the shared inbox." | pages_messaging (+ read_engagement) |
| 6 | Risposta dall'Inbox → Messenger: messaggio ricevuto | "The team replies from the inbox. Here it is in Messenger." | pages_messaging |
| 7 | Contatto fuori finestra: invio bloccato con l'avviso | "Outside the 24-hour window, the app does not allow sending." | pages_messaging |
| 8 | «Disconnect» (rimuove l'iscrizione della Pagina) e `/cancellazione-dati` | "Disconnecting removes the Page subscription. Data deletion instructions are public at this address." | pages_manage_metadata |

---

## Tabella di controllo: scena → permesso → nota

Ogni permesso richiesto deve comparire in **almeno una scena con effetto visibile**. Se un permesso non compare in nessuna scena, non si chiede.

| Permesso | Scena che lo dimostra |
|---|---|
| `whatsapp_business_management` | V1 scene 3, 4, 5, 6 |
| `whatsapp_business_messaging` | V1 scene 7, 8, 9, 10 |
| `instagram_business_basic` | V2 scene 2, 3, 5 |
| `instagram_business_manage_messages` | V2 scene 2, 4, 5, 6, 7 |
| `pages_show_list` | V3 scene 2, 3 |
| `pages_manage_metadata` | V3 scena 4, 8 |
| `pages_messaging` | V3 scene 5, 6, 7 |

## Errori frequenti da evitare (dalla skill)

- Il video mostra solo il collegamento o solo una dashboard: **deve esserci anche l'invio e il dispositivo del destinatario**.
- Schermate con dati finti: usare l'account reale di prova.
- Passaggi di debug o console: toglierli.
- Note e video che non coincidono: rileggere insieme prima dell'invio.
