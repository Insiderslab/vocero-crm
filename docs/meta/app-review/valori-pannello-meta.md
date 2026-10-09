# Valori da inserire nel pannello Meta

> **Nessun segreto.** Il dominio vero non è nel repository: sostituire `<CRM_DOMAIN>` (dominio pubblico del CRM, HTTPS obbligatorio) prima di incollare. Segreti (`META_APP_SECRET`, token, `META_WEBHOOK_VERIFY_TOKEN`) vivono solo nell'ambiente dell'istanza e nel pannello, mai qui.
> I nomi dei campi del pannello cambiano spesso: la colonna «Campo» indica l'intento; se l'etichetta è diversa, cercare quella equivalente. Le voci **[verificare]** non sono state controllate nel pannello.

## 1. Impostazioni di base dell'app

| Campo | Valore |
|---|---|
| App domains (Domini dell'app) | `<CRM_DOMAIN>` |
| Privacy Policy URL | `https://<CRM_DOMAIN>/privacy` |
| Terms of Service URL | `https://<CRM_DOMAIN>/termini` |
| User data deletion (istruzioni) | `https://<CRM_DOMAIN>/cancellazione-dati` |
| Contact email dell'app | `<LEGAL_CONTACT_EMAIL>` (la stessa della variabile d'ambiente) |
| Categoria dell'app | `<scelta dell'owner>` (es. business e pagine) |
| Icona dell'app | 1024x1024, fornita dall'owner |

Le tre pagine esistono già nel CRM, sono pubbliche, senza login, e sono in italiano (predefinito), inglese e spagnolo. **Per il revisore**: il testo si legge in inglese con il pulsante di lingua in alto; senza cookie la pagina si apre in italiano. Segnalarlo nelle istruzioni al revisore.

Per «cancellazione dei dati» Meta accetta o un URL con le istruzioni oppure un URL di callback. Oggi c'è solo la pagina con le istruzioni; la **callback automatica** (e quella di **deautorizzazione**) è prevista nel pacchetto K1: quando esisterà, i valori saranno:

| Campo | Valore (da K1) |
|---|---|
| Deauthorize callback URL | `https://<CRM_DOMAIN>/api/<percorso-definito-in-K1>/deauthorize` |
| Data deletion request URL | `https://<CRM_DOMAIN>/api/<percorso-definito-in-K1>/data-deletion` |

## 2. Webhook (WhatsApp)

Il CRM espone il webhook con un segmento segreto nel percorso (`src/app/api/webhooks/wa/[webhookToken]`, mostrato in `/settings/whatsapp` agli utenti autorizzati).

| Campo | Valore |
|---|---|
| Callback URL | `https://<CRM_DOMAIN>/api/webhooks/wa/<META_WEBHOOK_VERIFY_TOKEN>` |
| Verify token | `<META_WEBHOOK_VERIFY_TOKEN>` (copiarlo dall'ambiente o dalla pagina WhatsApp del CRM, **non** incollarlo in documenti o chat) |
| Campi da sottoscrivere (WhatsApp Business Account) | `messages` e `message_template_status_update` **[verificare l'elenco richiesto]** |

Note: la firma dei webhook si verifica solo se `META_APP_SECRET` è impostato sull'istanza (`signatureLayer`). Il segmento nel percorso fa parte del segreto: se compare in un posto sbagliato va ruotato.

Per Instagram e Messenger il percorso e i campi si definiscono con M3 (adattatori), **[da definire]**.

## 3. Login (Embedded Signup v4 / Facebook Login for Business / Instagram)  [DIPENDE DA K2/K3/K4]

I percorsi di callback non esistono ancora: si decidono in K2-K4 e si inseriscono qui solo dopo che il codice li ha. Schema atteso (non definitivo):

| Campo | Valore |
|---|---|
| Valid OAuth Redirect URIs | `https://<CRM_DOMAIN>/api/<percorso-K2>/callback` · `https://<CRM_DOMAIN>/api/<percorso-K3>/callback` · `https://<CRM_DOMAIN>/api/<percorso-K4>/callback` |
| Allowed Domains for the JavaScript SDK | `https://<CRM_DOMAIN>` (solo se il popup usa l'SDK JS) |
| Configuration ID (Facebook Login for Business) | `<CONFIG_ID_EMBEDDED_SIGNUP_V4>`: identificativo della configurazione, non un segreto; va in variabile d'ambiente |
| Embedded Signup | versione **v4**; v2 e v3 ritirate il 15/10/2026 |

Regole: solo HTTPS (anche per `localhost` si usa un'app di prova separata, mai quella di produzione); nessun carattere jolly; un URI per ogni percorso reale.

## 4. App Review: campi di testo

| Campo | Valore |
|---|---|
| Descrizione dell'uso di ogni permesso | blocchi di `note-permessi.md` |
| Video | un file per canale (`copioni-video.md`), caricato nel pannello |
| Istruzioni per il revisore | URL `https://<CRM_DOMAIN>/login`, utente di prova `<REVIEW_USER_EMAIL>`, password **inserita solo nel pannello**, passi per arrivare alla pagina Canali, nota sulla lingua delle pagine pubbliche |
| Utenti di prova | account WhatsApp/Instagram/Facebook di prova creati dall'owner, **mai** account di clienti |

## 5. Variabili d'ambiente dell'istanza collegate (nomi, mai valori)

`APP_BASE_URL` (deve coincidere con `https://<CRM_DOMAIN>`), `META_WEBHOOK_VERIFY_TOKEN`, `META_APP_SECRET`, `META_GRAPH_API_VERSION`, `LEGAL_ENTITY_NAME`, `LEGAL_CONTACT_EMAIL`.
