# 013 — Collegamento WhatsApp guidato

> **Pacchetto 013** · branch `wa-guidato` (base `origin/main` @ `30ccd1b`) · 2026-10-15.
> **Carril: ciclo completo** — tocca il modello dati (migrazione `drizzle/0016_instance_setting.sql`).
> Piano, modello dati e attività stanno in questo file, come in 006.
> ⚠ **Scritto durante l'implementazione**, a partire dal mandato dell'owner (che faceva da
> specifica prima del codice): è documentazione delle decisioni prese, non un progetto
> precedente al codice (Principio VI).

## Problema

1. **Configurazione dell'istanza con SSH.** Il pulsante «Collega con Meta» (Embedded
   Signup in coexistence, spec 006) compare solo se l'ambiente ha `META_APP_ID`,
   `META_ES_CONFIG_ID` e `META_APP_SECRET`. Le prime due si impostano oggi con un
   comando SSH sul VPS (`rilascio-crm.sh attiva-pulsante <ID>`): l'owner, che non è
   sviluppatore, non può farlo da solo.
2. **Pagina WhatsApp lunga e tecnica.** Test di usabilità: «La schermata WhatsApp è
   lunga e tecnica, senza una modalità guidata per chi non è sviluppatore» (WABA,
   token, webhook, override tutti insieme).

## Comportamento osservabile (criteri di accettazione)

### A. /admin → Piattaforma → Meta (solo super-admin)

1. In `/admin` c'è una sezione **Piattaforma** con la scheda **Meta (Embedded Signup)**.
   La vede e la usa solo il super-admin (`SUPERADMIN_EMAILS`). La pagina reindirizza
   chi non lo è (come prima); l'API risponde **403 `not_superadmin`** a member, admin e
   owner di qualunque azienda che non siano super-admin, **401** senza sessione.
2. Campi **App ID** e **Configuration ID**. Validazione (server, ripetuta nel modulo):
   **solo cifre, da 6 a 25**, spazi ai lati tolti; vuoto = cancella il valore salvato.
   Un ID non valido → 422 e niente scritto. Il corpo accetta **solo** `appId` e
   `configId`: qualunque altro campo (es. `appSecret`) → 422.
3. **Fonte visibile.** Accanto a ogni campo: «dall'ambiente», «salvato qui» o «non
   impostato». Se la variabile d'ambiente c'è, **vince lei** (override, come prima) e
   la scheda lo dice, mostrando anche il valore salvato che resta ignorato.
4. **App Secret solo d'ambiente.** La scheda dice solo se `META_APP_SECRET` è presente
   e, con i contatori della firma della PR #9, quando è arrivata l'ultima firma
   verificata e quanti eventi sono stati rifiutati dal riavvio. **Mai il valore.**
5. Stato complessivo: «Pronto» se ci sono i due ID e il segreto e non c'è il gateway
   Wapi; altrimenti cosa manca (o che con Wapi il pulsante non compare).
6. **Checklist dei passi su Meta** (una volta sola), con link: app Business con
   WhatsApp; configurazione Embedded Signup **v4** con `featureType`
   `whatsapp_business_app_onboarding`; il dominio dell'istanza (`APP_BASE_URL`, in
   produzione `crm.heili.cloud`) tra i «Domini consentiti per l'SDK JavaScript»; i
   **6 campi** del webhook (`messages`, `message_template_status_update`,
   `smb_message_echoes`, `history`, `smb_app_state_sync`, `account_update`); App
   Secret nell'ambiente.
7. Lo usa l'Embedded Signup: `getEmbeddedSignupConfig` legge **ambiente o DB**
   (ambiente se impostato). Il pulsante compare nelle aziende appena gli ID sono
   salvati, senza riavvio. Il canje del `code` usa `client_id` = App ID effettivo.

### B. Configurazione → WhatsApp guidata (owner/admin; es/en/it)

1. In alto una **striscia di stato**: numero collegato (numero e nome verificato),
   modalità (**App + CRM (coexistence)** o **Solo API**), **firma del webhook**
   (verificata «X fa» / in attesa del primo evento / rifiutata / manca l'App Secret /
   ambiente di prova) dai contatori della PR #9, **ultimo messaggio ricevuto**.
2. Stati chiari, ognuno con il suo avviso:
   - **non configurata** (manca la configurazione Meta della piattaforma): «Il tuo
     amministratore deve completare la configurazione Meta», nessun pulsante, link a
     «Avanzate» per chi ha già un token; con il gateway Wapi lo dice;
   - **pronta**: si parte dal passo 1;
   - **collegata**: avviso verde con il numero;
   - **da ricollegare** (`reconnect_required`): avviso rosso con **«Ricollega con
     Meta»** e, sotto, l'alternativa manuale in «Avanzate» (solo quella se la
     piattaforma non è pronta);
   - **coexistence tagliata** (`app_disconnected`, `account_update` di Meta): avviso
     rosso «Meta ha scollegato il numero dal CRM» con lo stesso rimedio. Ha la
     precedenza sul token scaduto.
3. Tre passi:
   1. **Collega il numero**: il grande pulsante «Collega con Meta» e una riga che
      spiega che l'app WhatsApp Business resta sul telefono;
   2. **Conferma sul telefono**: scegli il numero, conferma dall'app, «Condividi la
      cronologia» (fino a 6 mesi, senza attivare l'IA);
   3. **Prova**: scrivi da un altro telefono; la pagina mostra **«Ultimo messaggio
      ricevuto: X fa» in diretta** (evento SSE `message.new`, senza ricaricare).
   Stato di ogni passo: fatto / adesso / dopo / in attesa dell'amministratore.
4. **«Avanzate»** (chiusa per default, si apre anche con `#avanzate` o dai link della
   guida): collegamento manuale (WABA, Phone Number ID, token, origine diretta o
   agenzia/override), URL del webhook + verify token + stato della firma, chiave
   Wapi. Tutto funziona come prima, con le stesse guardie: pagina e API solo
   owner/admin, URL del webhook solo owner/admin (`withAdminAuth`).
5. Un member continua a vedere solo l'avviso «solo owner/admin».

### C. Cosa NON cambia

- Webhook e ingestione, logica di canje dell'Embedded Signup (salvo da dove legge
  App ID / Configuration ID), comportamento della firma della PR #9.
- `META_APP_SECRET` resta solo nell'ambiente.

## Decisioni

- **Tabella chiave/valore `instance_setting`**, non una riga unica con colonne: è
  piccola e già pronta per altre impostazioni d'istanza non segrete. Due `CHECK`:
  chiavi in lista bianca (`meta_app_id`, `meta_es_config_id`) e valore solo cifre
  6–25. Così **il DB stesso** rifiuta un App Secret o un testo libero.
- **Niente `organization_id`**: è configurazione dell'istanza, non un dato di dominio
  (Costituzione III riguarda le tabelle di dominio). Scrive solo il super-admin.
- **L'ambiente vince** se impostato (anche uno solo dei due ID: si risolvono ID per
  ID). Con entrambi nell'ambiente il DB non si legge nemmeno.
- **Nuova `GET /api/settings/whatsapp/status`** (owner/admin) invece di toccare
  `GET /api/settings/whatsapp`: un file nuovo si unisce senza conflitti con la PR #14,
  che rifà il lato server dei canali. Non porta segreti, nemmeno le ultime 4 cifre del
  token (la guida non le usa; restano in «Avanzate»).
- **Ultimo messaggio** = `max(conversation.last_inbound_at)` dell'organizzazione,
  senza le conversazioni del Laboratorio (`is_test`): lo scrive l'ingestione di ogni
  messaggio nuovo e NON lo storico della coexistence (che non apre la finestra).
- **«Conferma sul telefono» è fatto quando il numero risulta collegato**: avviene
  dentro la finestra di Meta e il CRM non ne riceve un evento a parte.
- **Firma**: stato per istanza (contatori di processo della PR #9, si azzerano al
  riavvio, uno per replica). Si mostra anche quando l'azienda non ha ancora un numero.
- Chiavi i18n non più usate dalla pagina (`connectedNumber`, `tokenTail`,
  `coexTitle`, `coexDescription`, `coexPoint1`, `coexBadge`, `connected`) rimosse.

## Fuori ambito

- Rendere l'App Secret configurabile da UI (è un segreto: resta nell'ambiente).
- Verificare dal CRM la configurazione lato Meta (dominio, campi del webhook): la
  checklist è manuale; l'unico segnale automatico è la firma verificata.
- Alta di numeri NUOVI (non dell'app) con Embedded Signup: invariato (spec 006).
- Persistenza dei contatori della firma tra riavvii.

## Modello dati

```
instance_setting
  key         text PK      CHECK key in ('meta_app_id','meta_es_config_id')
  value       text NOT NULL CHECK value ~ '^[0-9]{6,25}$'
  updated_by  text          -- id dell'utente super-admin
  updated_at  timestamp NOT NULL default now()
```

Migrazione `0016_instance_setting.sql`: solo catalogo (tabella nuova e vuota),
`SET LOCAL lock_timeout = '5s'` come 0013–0015, snapshot `0016` concatenato a `0015`.

## Piano (file)

| Pezzo | File |
|---|---|
| Schema + migrazione | `src/lib/db/schema.ts`, `drizzle/0016_instance_setting.sql`, `drizzle/meta/0016_snapshot.json` |
| Archivio impostazioni d'istanza | `src/server/platform/instance-settings.ts` |
| Risoluzione ambiente-o-DB, validazione, stato della scheda | `src/server/platform/meta-config.ts` |
| Embedded Signup (solo da dove legge la config) | `src/server/whatsapp/embedded-signup.ts`, `src/app/api/settings/whatsapp/embedded-signup/route.ts` |
| API super-admin | `src/app/api/admin/platform/meta/route.ts` (`withSuperadmin`) |
| Stato della guida | `src/server/whatsapp/guide-status.ts`, `src/app/api/settings/whatsapp/status/route.ts` (`withAdminAuth`) |
| Macchina a stati pura | `src/lib/whatsapp-guide.ts` |
| UI | `src/components/admin/meta-platform-card.tsx`, `src/app/(app)/admin/page.tsx`, `src/components/settings/whatsapp-guide.tsx`, `whatsapp-advanced.tsx` (ex `whatsapp-wizard.tsx`), `coexistence-connect.tsx` (ora solo pulsante), `src/app/(app)/settings/whatsapp/page.tsx` |
| i18n | `src/lib/i18n/messages/{es,en,it}/{admin,settings}.ts` |

## Attività e verifiche

- [x] Unit: risoluzione (ambiente vince), validazione, Embedded Signup da DB/ambiente,
      rotta super-admin, macchina a stati e vista in ogni stato e lingua.
- [x] Golden (PostgreSQL vero): solo super-admin (member/admin/owner → 403), config
      usata dall'Embedded Signup (`client_id`), ambiente vince, nessun segreto nelle
      risposte, CHECK del DB, ultimo entrante isolato.
- [x] Inventario dei ruoli: `tests/unit/helpers/route-roles.ts`.
- [x] E2E API (`scripts/e2e-selftest.mjs`, sezione 013; la 009 non si salta più) e
      browser (`scripts/e2e-whatsapp-guidato.mjs`), V1–V6 = 0.
- [x] Sabotaggi: guardia super-admin, precedenza dell'ambiente, segreto mai esposto.
- [x] Guida per l'owner: `docs/ops/collegare-whatsapp.md`.
