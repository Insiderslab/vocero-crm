# Cancellazione dati da Meta: come si gestisce (responsabile: Denise, amministrazione)

## Quando arriva una richiesta
Una persona ha rimosso l'app «Whatpp Business Insiderslab» dal suo account Meta e ha chiesto di
cancellare i dati. Meta chiama `POST https://crm.heili.cloud/api/meta/data-deletion`; il CRM
registra la richiesta e Meta mostra alla persona un codice e il link
`https://crm.heili.cloud/cancellazione-dati?id=<codice>`.

## Ogni settimana (almeno una volta)
1. `https://crm.heili.cloud/admin` → sezione **Privacy** → «Richieste di cancellazione Meta».
2. Per ogni richiesta aperta: «Segna In corso», poi cerca i dati. Il CRM **non** conserva l'ID
   Facebook, quindi va cercato a mano:
   - **account del CRM** della persona (email con cui è registrata);
   - **collegamento Meta** dell'organizzazione che ha collegato il numero (Impostazioni →
     WhatsApp): se l'azienda chiude il rapporto, si scollega e si cancella;
   - **contatti e conversazioni**: sono dati dell'azienda cliente (noi siamo responsabili del
     trattamento): si cancellano solo su istruzione dell'azienda.
   Se non si trova niente da collegare all'ID: annotarlo («Nessun dato collegato»).
3. Scrivi nella nota cosa è stato cancellato, poi «Segna Completata»: la pagina pubblica mostra
   «Completata».
4. Se la persona ha scritto anche a info@insiderslab.it, rispondi confermando la cancellazione.
5. Scadenza: **30 giorni** dalla ricezione (la scheda mostra i giorni rimasti, in rosso se in
   ritardo).

## Variabili (non segrete) da avere nel `.env` di produzione PRIMA del deploy
```
LEGAL_ENTITY_NAME="InsidersLab SNC di Finoti Stefano & C."
LEGAL_CONTACT_EMAIL=info@insiderslab.it
LEGAL_ENTITY_DETAILS="Via Argentina 25, 33100 Udine, P.IVA IT03168500308"
```
`META_APP_SECRET` c'è già (webhook WhatsApp): il callback usa la stessa.

## Su Meta (dopo il deploy)
App `609974691965875` → Impostazioni → Di base → «Cancellazione dei dati» → **URL di callback
per la richiesta di cancellazione dei dati**: `https://crm.heili.cloud/api/meta/data-deletion`.
Prova ufficiale: dal proprio account Facebook rimuovere l'app e scegliere «Invia richiesta».
