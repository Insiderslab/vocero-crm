# Collegare WhatsApp a Heili CRM — guida semplice

Questa guida è per chi usa il CRM, non per chi lo programma. Non servono comandi
sul server.

## L'idea in una riga: una presa, tante spine

Pensa all'impianto elettrico di casa.

- **La presa si monta una volta sola.** È il collegamento tra il CRM e Meta (l'azienda
  di WhatsApp). Lo fa l'amministratore della piattaforma, una volta per tutto il CRM.
- **La spina si attacca per ogni numero.** Ogni azienda nel CRM collega il proprio
  numero WhatsApp con un pulsante, in un paio di minuti. Si può staccare e
  riattaccare.

Finché la presa non c'è, nelle aziende il pulsante «Collega con Meta» non compare e la
pagina dice: «Il tuo amministratore deve completare la configurazione Meta».

---

## Parte 1 — La presa (una volta sola, amministratore della piattaforma)

Ti servono: l'accesso a [developers.facebook.com](https://developers.facebook.com/apps/)
con l'app Meta dell'azienda, e un account del CRM da **super-admin** (chi gestisce le
aziende in **Admin**).

### Su Meta (si fa una volta)

1. **L'app.** Un'app Meta di tipo *Business* con il prodotto **WhatsApp**. Nella pagina
   *Impostazioni → Base* trovi l'**ID app** (App ID): un numero lungo.
2. **La configurazione del pulsante.** Nell'app apri *Facebook Login for Business →
   Configurazioni* e crea una configurazione di tipo **WhatsApp Embedded Signup**,
   versione **v4**, per il collegamento dell'**app WhatsApp Business**
   (*featureType* `whatsapp_business_app_onboarding`). Meta le dà un **Configuration
   ID**: un altro numero.
3. **Il dominio.** Sempre in *Facebook Login for Business → Impostazioni*, aggiungi il
   dominio del CRM (per noi **crm.heili.cloud**) tra i **«Domini consentiti per l'SDK
   JavaScript»**. Senza questo, la finestra di Meta non si apre.
4. **I messaggi in arrivo (webhook).** In *WhatsApp → Configurazione* iscrivi questi
   **6 campi**: `messages`, `message_template_status_update`, `smb_message_echoes`,
   `history`, `smb_app_state_sync`, `account_update`. L'indirizzo (URL) del webhook e
   il «verify token» li trovi nel CRM: *Impostazioni → WhatsApp → Avanzate*.
5. **Il segreto dell'app (App Secret).** È in *Impostazioni → Base*. **Non si scrive
   nel CRM**: è una password. Va dato a chi gestisce il server, che lo mette nella
   configurazione (`META_APP_SECRET`) e riavvia. Lo si fa una volta.

### Nel CRM

1. Entra con l'account super-admin e apri **Admin**.
2. In alto, sezione **Piattaforma → Meta (Embedded Signup)**.
3. Incolla **App ID** e **Configuration ID** (solo cifre) e premi **Salva**.
4. Controlla la scheda:
   - accanto a ogni numero c'è scritto da dove arriva: **«salvato qui»** oppure
     **«dall'ambiente»** (se chi gestisce il server l'ha messo nella configurazione,
     vince quello e la scheda lo dice);
   - **App Secret**: deve dire «Presente nella configurazione del server». Dopo il
     primo messaggio vero dice anche «Firme del webhook verificate: l'ultima …». Se
     compaiono eventi **rifiutati** e nessuno verificato, il segreto sul server non è
     quello dell'app giusta;
   - in alto il bollino **Pronto**: da adesso il pulsante compare in tutte le aziende.
5. **Facoltativo:** una volta salvati i due numeri qui, chi gestisce il server può
   togliere `META_APP_ID` e `META_ES_CONFIG_ID` dal file `.env` del VPS (e riavviare).
   Non è obbligatorio: finché ci sono, valgono quelli del server e la scheda lo dice
   («dall'ambiente»). L'App Secret invece resta sempre sul server.

   **Prudenza per il ritorno indietro:** conviene lasciare `META_APP_ID` e
   `META_ES_CONFIG_ID` nel `.env` **almeno una settimana** dopo il rilascio di
   questa versione, finché non è stabile. La versione precedente del CRM li legge
   **solo** dal `.env`: se li hai già tolti e si torna alla versione di prima,
   rimettili nel `.env` e riavvia, altrimenti il pulsante «Collega con Meta»
   sparisce (i numeri già collegati continuano a funzionare).

La scheda ripete l'elenco dei passi su Meta con i link, così non serve tenere questa
guida aperta.

---

## Parte 2 — La spina (per ogni numero, titolare o amministratore dell'azienda)

Ti servono: il telefono con l'**app WhatsApp Business** del numero e l'accesso a
Facebook dell'attività. Due minuti.

Apri **Impostazioni → WhatsApp**. In alto vedi una striscia con lo stato (numero,
modalità, firma, ultimo messaggio). Sotto, tre passi.

1. **Collega il numero.** Premi **Collega con Meta**, entra con Facebook e scegli il
   numero. L'app WhatsApp Business **resta sul telefono e continua a funzionare**: i
   messaggi arrivano sia lì sia nel CRM, e puoi rispondere da dove vuoi.
2. **Conferma sul telefono.** Meta ti chiede di confermare dall'app WhatsApp Business
   sul telefono. Tocca anche **«Condividi la cronologia»**: fino a 6 mesi di chat
   entrano nel CRM come storico (non attivano l'assistente IA).
3. **Prova.** Scrivi al tuo numero da **un altro telefono**. Nella pagina compare
   «**Ultimo messaggio ricevuto:** pochi secondi fa» — da solo, senza ricaricare. Il
   messaggio è anche nella **Posta**.

Fatto: i tre passi diventano verdi e in alto c'è «WhatsApp è collegato».

### Da ricordare

- **Apri l'app WhatsApp Business sul telefono almeno ogni 13 giorni.** Se resta chiusa
  per circa due settimane, Meta stacca il numero dal CRM.
- Gruppi, messaggi effimeri e liste broadcast non passano al CRM.

### Se qualcosa si stacca

La pagina lo dice con un riquadro rosso e un pulsante:

- **«Il token di WhatsApp è scaduto o è stato revocato»** — gli invii sono in pausa.
  Se il numero è collegato con l'app (coexistence), premi **Ricollega con Meta** e rifai
  i passi. Se invece era stato collegato a mano (WABA e token, per esempio il numero di
  prova di Meta), la pagina mostra **Incolla un token nuovo**: apre «Avanzate» sul
  campo del token. Così il numero non cambia modalità per sbaglio.
- **«Meta ha scollegato il numero dal CRM»** — di solito l'app non è stata aperta per
  ~14 giorni, è cambiato il telefono o è stato tolto l'accesso. Apri l'app sul
  telefono, poi **Ricollega con Meta**.
- **«Il tuo amministratore deve completare la configurazione Meta»** — manca la presa
  (Parte 1). Scrivi all'amministratore della piattaforma.

### La sezione «Avanzate»

In fondo alla pagina c'è **Avanzate**, chiusa. Serve a chi configura le app Meta:
collegamento a mano con WABA e token, indirizzo del webhook e verify token, chiave
Wapi. **Nel caso normale non serve aprirla.**
