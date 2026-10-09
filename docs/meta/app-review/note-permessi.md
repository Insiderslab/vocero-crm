# Note di utilizzo per permesso (testo per il modulo di revisione)

> I blocchi in inglese si incollano nel campo «How will your app use this permission?» del pannello Meta. **Nomi esatti dei permessi: da verificare nel pannello** (Meta li rinomina e li sposta tra prodotti; l'elenco sotto è quello che il piano prevede, non una verità confermata).
> Prima di incollare, sostituire i segnaposto `<...>`. Ogni nota presuppone che il video corrispondente (`copioni-video.md`) mostri esattamente ciò che la nota dichiara.

Descrizione comune del prodotto (da usare anche nel campo «App description»):

```text
Heili CRM is a messaging CRM for businesses. A business connects its own WhatsApp Business account, Instagram professional account and Facebook Page, and then its team reads and answers customer conversations from a single shared inbox, organizes contacts and sales opportunities, and can optionally turn on an AI assistant that drafts replies. Each business sees only its own data. Data received from Meta is used only to provide these functions to the business that connected the account.
```

## 1. WhatsApp

### `whatsapp_business_management`  **[DIPENDE DA K2]**

```text
Heili CRM uses whatsapp_business_management to read and manage the WhatsApp Business assets that the business shares with us through the official Meta Embedded Signup flow.

After the business completes Embedded Signup with its own account, the app reads the connected WhatsApp Business Account (WABA) ID, the phone number ID and display number, and the message templates of that account, and subscribes the WABA to our webhook so incoming messages and template status changes reach the business's inbox. The business can also create message templates from the app and see their approval status (pending, approved, rejected with the reason).

The permission is used only on the account the business itself connected, and only to configure its workspace, list its templates and track their status. We do not access assets of businesses that have not connected through Embedded Signup.
```

### `whatsapp_business_messaging`  **[DIPENDE DA K2]**

```text
Heili CRM uses whatsapp_business_messaging so a business can receive and answer WhatsApp conversations with its own customers from the connected business phone number.

Inbound customer messages arrive through the webhook and appear in the business's shared inbox. Team members reply from the inbox: free-form replies inside the 24-hour customer service window, and approved message templates when the window is closed or to start a conversation with a customer who opted in. The app enforces the 24-hour window: outside it, only approved templates can be sent. It also sends delivery and read status updates back to the inbox.

Messages are sent only from the phone number the business connected, only after the business connected it, and only for the business's own customer conversations.
```

## 2. Instagram (Business Login for Instagram)

### `instagram_business_basic`  **[DIPENDE DA K3]**

```text
Heili CRM uses instagram_business_basic to identify the Instagram professional account that the business connects with Business Login for Instagram.

After the business logs in with Instagram and authorizes the app, we read the account's ID, username and profile name, and show them in the Channels page so the business can confirm which account is connected and see its connection status. The permission is also required to receive and display the name and profile picture of the people who message the account, inside the inbox conversation.

We read only the profile of the account that the business connected and of the people who wrote to it.
```

### `instagram_business_manage_messages`  **[DIPENDE DA K3]**

```text
Heili CRM uses instagram_business_manage_messages so a business can read and reply to Instagram Direct messages sent to its own professional account, from its shared inbox.

Incoming direct messages (including text, images and story replies) are delivered by webhook and shown in the inbox. A team member writes a reply in the inbox and the app sends it with the Instagram messaging API, only inside the 24-hour standard messaging window after the customer's last message. The app does not send messages outside the window and does not message people who have not written first.

Messages are read and sent only for the account the business connected, and only to support its own customer conversations.
```

## 3. Messenger (Pagine Facebook)

Permessi previsti per la messaggistica delle Pagine. **Nomi esatti da confermare in K0 e nel pannello.** Di solito: `pages_messaging`, `pages_show_list`, `pages_manage_metadata` (iscrizione della Pagina ai webhook), e `pages_read_engagement` solo se serve leggere nome e foto del mittente. Si chiede **solo ciò che il prodotto usa**; se K0 dimostra che uno non serve, si toglie.

### `pages_show_list`  **[DIPENDE DA K4]**

```text
Heili CRM uses pages_show_list to show the business the Facebook Pages it manages, right after Facebook Login for Business, so it can choose which Page to connect to its inbox. We display the Page names only for this selection and store only the Page the business chooses.
```

### `pages_manage_metadata`  **[DIPENDE DA K4]**

```text
Heili CRM uses pages_manage_metadata to subscribe the Page the business selected to our webhook, so that new Messenger messages sent to that Page are delivered to the business's inbox. We do not change any other Page setting, and we remove the subscription when the business disconnects the Page.
```

### `pages_messaging`  **[DIPENDE DA K4]**

```text
Heili CRM uses pages_messaging so a business can read and answer Messenger conversations that customers start with its Facebook Page, from its shared inbox. Incoming messages arrive by webhook; a team member replies from the inbox and the app sends the reply with the Send API, within the 24-hour standard messaging window after the customer's last message. The app does not send messages outside the window and does not message people who have not written first.
```

### `pages_read_engagement`  (solo se serve)  **[DA DECIDERE IN K0]**

```text
Heili CRM uses pages_read_engagement only to read the name and profile picture of the people who message the connected Page, so the team can recognize the customer in the inbox conversation. If K0 shows this is not needed, do not request it.
```

## Verifiche prima dell'invio

- Ogni nota corrisponde a una scena del video, nello stesso ordine (`copioni-video.md`, tabella «scena → permesso»).
- Il permesso è davvero usato dal codice: se non lo è, non lo si chiede.
- I testi non promettono funzioni inesistenti: se un permesso dipende da K2/K3/K4 non ancora costruito, la nota non si invia.
- Link a privacy e termini presenti e raggiungibili senza login (vedi `valori-pannello-meta.md`).
