# 015 — Cancellazione dati da Meta (Data Deletion Request Callback)

> **Pacchetto 015** · branch `feat/015-cancellazione-dati-meta` (base `origin/main` @ `2d1f12c`) · 2026-10-19.
> **Carril: ciclo completo** — migrazione `drizzle/0019_meta_data_deletion.sql`.
> Scritto durante l'implementazione, dal mandato dell'owner (19/10): documenta le decisioni (Principio VI).

## Problema
Per l'App Review, Meta non accetta l'URL con le istruzioni nel campo «Cancellazione dei dati»
delle impostazioni dell'app: serve il **callback** che riceve il `signed_request` e risponde
con un URL di stato e un codice di conferma.

## Comportamento osservabile

### A. `POST /api/meta/data-deletion` (pubblico)
1. Corpo `application/x-www-form-urlencoded` (accettato anche `multipart/form-data`) con
   `signed_request`; massimo 8 KB; 60 richieste al minuto per IP.
2. `signed_request` = `<firma>.<payload>` in base64 URL-safe. La firma è l'HMAC-SHA256 della
   parte `<payload>` con **`META_APP_SECRET`** (lo stesso del webhook WhatsApp), confrontata a
   tempo costante. Il JSON si legge solo dopo una firma valida; `algorithm` deve essere
   `HMAC-SHA256`; `user_id` obbligatorio; `issued_at`, se presente, intero e non più vecchio di
   3 giorni né nel futuro oltre 10 minuti (richiesta rigiocata → 400).
3. Firma non valida, payload malformato, algoritmo diverso, `user_id` mancante, corpo non form
   → **400**, nessuna riga scritta. Senza `META_APP_SECRET` → **503**, nessuna riga.
4. Valida → riga in `meta_data_deletion_request` (ID Meta, codice, stato `received`,
   `issued_at`, date) e **200** `{ "url": "<APP_BASE_URL>/cancellazione-dati?id=<codice>",
   "confirmation_code": "<codice>" }`.
5. Codice: 20 caratteri alfanumerici da fonte crittografica (nanoid, ~119 bit), UNIQUE e con
   CHECK nel database. Se per lo stesso utente c'è una richiesta non completata, si restituisce
   quella (Meta riprova): nessuna riga doppia, anche con callback simultanei (lock per utente).
6. Nei log solo il codice e il motivo di un rifiuto: mai firma, payload, ID Meta o segreto.

### B. Nessuna cancellazione automatica (deciso)
Il CRM **non conserva l'ID utente Facebook** (l'Embedded Signup salva WABA, numero e token
dell'azienda, non chi ha fatto il login). La richiesta quindi non si lega da sola a dati del
CRM: si registra e la gestisce una persona (§D). Salvare l'ID Facebook al collegamento: rinviato
dall'owner a dopo l'App Review.

### C. `/cancellazione-dati`
- Senza `id`: le istruzioni (come prima) + nuova sezione 6 «Se hai chiesto la cancellazione
  tramite Meta» + riquadro finale **contatto e titolare**.
- Con `?id=<codice>`: sopra le istruzioni, il riquadro di stato «Richiesta ricevuta» / «In corso»
  / «Completata» con le date; codice inesistente o malformato → «Codice non trovato» (un codice
  malformato non arriva al database); database irraggiungibile → «non disponibile».
  Mai l'ID Meta né la nota interna.
- `/privacy` chiude con lo stesso riquadro contatto e titolare.
- Testo (it): «Per chiedere la cancellazione dei tuoi dati scrivi a {{email}} dall'indirizzo con
  cui sei registrato, indicando numero WhatsApp e organizzazione. Cancelliamo i dati entro 30
  giorni e confermiamo via e-mail. Titolare: {{entity}}, {{details}}.» con
  `LEGAL_CONTACT_EMAIL`, `LEGAL_ENTITY_NAME` e la nuova `LEGAL_ENTITY_DETAILS` (es/en tradotti).

### D. `/admin` → Privacy → «Richieste di cancellazione Meta» (solo super-admin)
Elenco (aperte prima) con ID Meta, codice, data, giorni ai 30 promessi (in rosso se in
ritardo), nota e pulsanti «In corso» / «Completata». `GET /api/admin/meta-deletion`,
`PATCH /api/admin/meta-deletion/[id]` (`withSuperadmin`). **Responsabile: Denise
(amministrazione)**, controllo almeno settimanale, conferma via e-mail (il CRM non manda e-mail).

### E. Raggiungibilità
`public/robots.txt`: `Allow` per `/privacy`, `/termini`, `/cancellazione-dati`,
`/api/meta/data-deletion`; il resto resta `Disallow: /`. Nessun middleware di login sulle rotte
pubbliche; Caddy non filtra i bot (limita solo il corpo di `/api/webhooks/*`).

## Prove
- `tests/unit/meta-data-deletion.test.ts`: firma valida/errata/alterata, malformati, algoritmo,
  `user_id`, rotta (200/400/503, form e multipart, niente segreti in risposte e log), pagina di
  stato (valido, in corso, completata, inesistente, malformato), privacy, robots.
- `tests/golden/meta-data-deletion.golden.test.ts` (PostgreSQL vero): righe, nessuna riga se la
  firma è sbagliata, riuso del codice, codice nuovo dopo il completamento, CHECK del codice,
  stato pubblico, ruoli e flusso /admin.
