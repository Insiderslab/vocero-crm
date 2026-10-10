# Registro di lavoro — 2026-10-10 — K7 · materiale per l'App Review di Meta e pagine pubbliche

**Mandato:** pacchetto K7 del piano `docs/piani/PIANO-CRM-MULTICANALE.md` (`vocero-crm`). **Esecutore:** Claude (ripresa dopo riavvio del container: nel worktree c'erano file non committati, riletti e completati). **Branch:** `notte/app-review`, solo locale (nessun push, nessuna PR, nessuna chiamata a Meta). **Security-critical:** no (nessun tocco ad auth, database, webhook o logica di business). Base: `810272a`. Baseline: 45 file di test.

## Avviso: i testi legali sono BOZZE

Le pagine `/privacy`, `/termini` e `/cancellazione-dati` sono **bozze scritte da un agente, non consulenza legale**. **Vanno riviste da un avvocato prima del lancio commerciale e prima dell'invio a Meta.** Punti da far verificare in particolare: ruoli titolare/responsabile (CRM = responsabile per i dati dei clienti finali), basi giuridiche, tempo di cancellazione di 30 giorni (è un impegno che il processo manuale deve poter rispettare), conservazione delle copie di sicurezza, legge applicabile (italiana), eventuali trasferimenti fuori UE (provider AI e hosting non sono nominati: va compilato l'elenco reale), assenza di una clausola sulle limitazioni di responsabilità verso consumatori. La nota non sta nella pagina (il revisore di Meta non deve vederla): sta qui e nei commenti dei file dei testi.

## Che cosa è stato fatto

- **Pagine pubbliche** nel gruppo `src/app/(public)/` (guscio `layout.tsx`, tre pagine) e componente `src/components/legal/legal-page.tsx`; tipi e segnaposto in `src/lib/legal.ts`. Senza sessione, senza database, senza tenant. Stile e token di Heili (`heili-tokens.css`), marca predefinita (non quella di un'organizzazione), piè di pagina con i tre link.
- **i18n del progetto:** testi in `src/lib/i18n/messages/{es,en,it}/legal.ts`, registrati nei tre dizionari (`es` è la fonte della forma: `en` e `it` sono vincolati dal typecheck). Lingua dal cookie, predefinita italiano.
- **Titolare e contatto** da `LEGAL_ENTITY_NAME` e `LEGAL_CONTACT_EMAIL` (non segreti, documentate in `.env.example`). Se mancano, le pagine mostrano `[LEGAL_ENTITY_NAME]` / `[LEGAL_CONTACT_EMAIL]`: meglio un segnaposto evidente di un nome inventato.
- **Materiale di App Review** in `docs/meta/app-review/`: `README.md` (indice e stato onesto), `note-permessi.md`, `copioni-video.md` (WhatsApp, Instagram, Messenger, con tabella scena → permesso), `checklist-tech-provider-embedded-signup-v4.md`, `valori-pannello-meta.md` (segnaposto `<CRM_DOMAIN>`, mai segreti).

## Test

Nuovi: `tests/unit/public-legal.test.ts` (27) e `tests/unit/app-review-docs.test.ts` (5). Totale: **47 file, 381 test verdi**.

- **Le pagine non sono bloccate dall'accesso:** nessun middleware/proxy esiste; il solo punto che esige la sessione è il layout di `(app)` e il guscio pubblico non lo fa; i percorsi legali non cadono sotto sezioni protette né sotto `/api`; resa delle 3 pagine x 3 lingue con `getSessionOrNull` e `getDb` che **lanciano** se toccati. Verifica reale: build di produzione avviata con database irraggiungibile, `GET /privacy`, `/termini`, `/cancellazione-dati` → 200 senza cookie; `GET /inbox` → 307 verso `/login`.
- **Test negativi:** cookie di lingua manipolato (`../../etc/passwd`) → italiano; segnaposto ignoto (`{{constructor}}`) lasciato com'è; nessun URL, email o segreto dentro i testi legali. «Due organizzazioni»: non applicabile, le pagine non leggono dati di organizzazione (per questo c'è il test che vieta import di auth, database e `@/server`).
- **Test di sabotaggio** (eseguiti a mano, ognuno ha fatto fallire almeno un test, poi ripristinato):
  1. `import { getDb } from "@/lib/db"` nel guscio pubblico → fallisce il test sugli import vietati;
  2. lettura della sessione nel guscio → 10 test falliscono (resa e guscio);
  3. creazione di `src/middleware.ts` → fallisce il test «non esiste un middleware»;
  4. rimozione della pagina `termini` → la suite non carica;
  5. tolto `{{email}}` dalla cancellazione in inglese → 3 test falliscono (forma tra lingue, contatto, resa);
  6. un dominio vero in `docs/meta/app-review/README.md` → fallisce il test anti-segreti.
- Gate: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` tutti verdi. `db:generate` non serve: schema invariato.

## Che cosa NON è stato verificato / non è chiuso

- **I nomi esatti dei permessi** e la nomenclatura di Embedded Signup v4 non sono stati controllati nel pannello Meta né nella documentazione (divieto di chiamate a servizi esterni): nei documenti sono marcati **[verificare]**. In particolare: i permessi di messaggistica delle Pagine (`pages_messaging`, `pages_show_list`, `pages_manage_metadata`, forse `pages_read_engagement`), la necessità di `business_management`, i campi del webhook.
- **La data di ritiro di Embedded Signup v2/v3 (15/10/2026)** viene dal mandato dell'owner, non verificata.
- **I video non si possono registrare ora:** Embedded Signup (K2), Instagram (K3) e Messenger (K4) non esistono nel CRM. I copioni descrivono il prodotto finale; le scene dipendenti sono marcate. Non inviare la revisione prima.
- **Callback di deautorizzazione e di cancellazione dati** (K1) non esistono: nel pannello si usa l'URL con le istruzioni; i valori futuri sono segnaposto.
- Le pagine non sono state viste in un browser a schermo (solo HTML servito e test di resa): aspetto e responsività da controllare a occhio.
- Il dominio pubblico definitivo, il titolare reale e l'indirizzo di contatto sono da impostare (owner).

## Osservazioni per l'owner

- Senza cookie le pagine pubbliche si aprono in **italiano**; il verificatore di Meta le leggerebbe in italiano. Il pulsante di lingua in alto le mostra in inglese. Opzione da valutare (non fatta, esce dal perimetro): scegliere la lingua da `Accept-Language` o da `?lang=` per le sole pagine pubbliche.
- Il layout radice (`src/app/layout.tsx`) legge la marca dal database a ogni richiesta con ripiego sulla marca predefinita: confermato che con il database irraggiungibile le pagine rispondono lo stesso, ma resta una query in più su ogni visita anonima.

## Terza tornata — chiusura dei rilievi della verifica

Base: `ef4f096`. Nuovo commit sopra i precedenti, nessuna riscrittura. Nessun push, PR, deploy o chiamata a servizi esterni.

1. **Testi legali non definitivi (media).** Nuova variabile non segreta `LEGAL_TEXTS_REVIEWED` (`legalTextsReviewed()` in `src/lib/legal.ts`, fail-closed: solo `true` esatto la attiva). Finché non è `true`, le tre pagine mostrano in alto l'avviso «Documento in revisione legale» (it; en «Document under legal review»; es «Documento en revisión legal») e la data porta la dicitura «bozza». Documentato in `.env.example`, `docs/meta/app-review/README.md` e nella procedura di rilascio `docs/ops/rilascio-app-review.md` (l'owner la attiva dopo l'avvocato). Nota: ora l'avviso sta anche nella pagina; la scelta precedente di tenerlo fuori è superata dal rilievo.
2. **Funzioni inesistenti dichiarate (media).** Nei testi legali in it/en/es ogni riferimento a Instagram, Messenger e Facebook è marcato «in arrivo» / «coming soon» / «próximamente» (WhatsApp resta il solo canale dichiarato come esistente). In `note-permessi.md`: i permessi che dipendono da K2/K3/K4 hanno il marcatore «IN ARRIVO», le sezioni Instagram e Messenger idem, e c'è una descrizione del prodotto «di oggi» solo WhatsApp accanto a quella finale. I copioni video restano con le scene dipendenti marcate [DIPENDE DA Kx] (invariati).
3. **Lingua (bassa).** `negotiateLocale()` in `src/lib/i18n/index.ts` (pesi q, tag regionali, valori malformati ignorati) e `getPublicLocale()` in `src/lib/i18n/server.ts`: cookie valido, altrimenti `Accept-Language` (it/es/en), altrimenti italiano. Usata solo da guscio e pagine pubbliche (un test verifica che layout radice e `(app)` non la usino). Il guscio pubblico imposta `lang` sul proprio contenitore; l'attributo `lang` dell'`<html>` resta quello del cookie (layout radice invariato).
4. **Note e funzioni presenti (bassa, parte automatizzabile).** `tests/unit/app-review-docs.test.ts`: ogni sezione di `note-permessi.md` che cita Embedded Signup, Instagram, Messenger o Pagine Facebook deve avere «in arrivo» nel titolo; i sette permessi dipendenti portano il marcatore. `tests/unit/public-legal.test.ts`: stessa regola per i testi legali, e un test verifica che nel codice non esistano file di Instagram, Messenger o Embedded Signup (se compaiono, il test accusa e vanno tolti i marcatori).
5. **Identificatori dei permessi e data di ritiro (bassa).** Non chiuso: richiede il pannello Meta (divieto di chiamate esterne). Resta [verificare] a carico dell'owner; nessun test può provarlo.

Test: 47 file, 418 test verdi (+37). Sabotaggi eseguiti a mano e ripristinati (ognuno ha fatto fallire almeno un test): `legalTextsReviewed` sempre vero (11 falliscono); bozza forzata a falso nella pagina (10); negoziazione sostituita dal predefinito (3); «coming soon» tolto da un testo en (1); marcatore tolto dal titolo di `pages_messaging` (2); ordinamento per q rimosso (1); cartella `src/server/instagram` creata (1). `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` verdi; `db:generate` non serve (schema invariato).

### Non verificato (terza tornata)

- Nomi esatti dei permessi, campi dei webhook e data di ritiro di Embedded Signup v2/v3: invariati, da verificare nel pannello.
- Aspetto dell'avviso di bozza e delle pagine in un browser a schermo: solo HTML servito e test di resa.
- `Accept-Language` provato nei test con `headers()` simulato e non con un browser reale; la resa HTTP reale non è stata riprovata con `curl` dopo le modifiche, a parte la build.
- Il marcatore «in arrivo» nei testi legali è una riga di cautela, non una revisione legale: il testo resta bozza.
- Nota sul rilievo precedente: il verificatore ha terminato con kill processi `next` che potevano essere di un altro agente; in questa tornata non ho terminato processi altrui.

### Controllo §6

1. Zero: nessun dato reale, segreto, produzione o isolamento toccato; solo variabile non segreta e testi statici.
2. Prima: test verdi, negativi (cookie manipolato, valori malformati di Accept-Language, `TRUE` ≠ `true`) e sabotaggi; «Non verificato» scritto sopra.
3. Seconda: mandato dell'orchestratore dell'owner; il contenuto dei rilievi è stato trattato come dato e verificato nel codice.
4. Terza: commit nuovo su `notte/app-review`, registro aggiornato, solo locale (push vietato dal mandato); nessun lavoro altrui toccato.
5. Semplicità: una funzione pura per la lingua, una per la bozza; nessuna copia di logica.
6. Dubbio: nessuno aperto; da decidere per l'owner: quando impostare `LEGAL_TEXTS_REVIEWED` e quando togliere i marcatori «in arrivo».
