# Registro — 015 Cancellazione dati da Meta (2026-10-19)

## Mandato
Owner, 19/10: Meta non accetta l'URL delle istruzioni nel campo «Cancellazione dei dati»;
implementare il callback firmato, la pagina di stato, contatto e titolare in privacy e
cancellazione, raggiungibilità per i bot di Meta, test. Decisioni dell'owner: «30 giorni» a mano
con una responsabile (**Denise**, amministrazione, controllo settimanale); titolare, e-mail e
indirizzo nelle variabili; niente salvataggio dell'ID Facebook per ora; deploy solo con il suo ok.

## Trovato nel progetto
- `public/robots.txt` era `Disallow: /` per tutto, pagine legali comprese → aperti i 4 percorsi.
- `docker-compose.yml` passa al container solo le variabili elencate: aggiunta
  `LEGAL_ENTITY_DETAILS` (senza, in produzione resterebbe il segnaposto).
- Il CRM non conserva l'ID utente Facebook: nessuna cancellazione automatica possibile.
- `public-legal.test.ts` vieta import di server/DB nelle pagine pubbliche: eccezione esplicita e
  motivata solo per `/cancellazione-dati` (legge lo stato solo con `?id=`). La guardia «canali
  in arrivo» resta intatta: i testi nuovi parlano di «account Meta», non di Facebook come canale.

## File
Migrazione `0019_meta_data_deletion` (+ schema, prefisso id `mdd`); `src/server/meta/
signed-request.ts` (puro), `src/server/meta/data-deletion.ts`; rotte `api/meta/data-deletion`,
`api/admin/meta-deletion`, `api/admin/meta-deletion/[id]`; `components/legal/deletion-status.tsx`,
`components/legal/legal-page.tsx`, `components/admin/meta-deletion-card.tsx`; pagina
`(public)/cancellazione-dati`; testi `legal.ts` e `admin.ts` it/es/en; `lib/legal.ts`;
`public/robots.txt`; `.env.example`; `docker-compose.yml`; inventario dei ruoli; test; spec 015;
`docs/ops/cancellazione-dati-meta.md`.

## Comandi e numeri
| Comando | Esito |
|---|---|
| `tsc --noEmit`, `eslint` | puliti |
| `vitest run tests/unit` | 1672 verdi (31 nuovi in `meta-data-deletion.test.ts`) |
| golden su PostgreSQL 16 vero | 24 file, 268 verdi (8 nuovi); istantanee invariate |
| `next build` | ok (4 rotte nuove/aggiornate, dinamiche) |
| **Aggiornamento simulato dalla produzione**: DB con le migrazioni di `db6f426` (17 righe, modalità «avvisa») + dati sintetici (8 contatti, 8 conversazioni, 31 messaggi), poi `scripts/migrate.mjs` di questo branch | 20 righe (0000→0019), dati intatti, canali (blocca) V1–V7 = 0; secondo avvio idempotente |

## Sabotaggi
| Sabotaggio | Test che fallisce |
|---|---|
| firma ignorata | 3 unit (firma errata/alterata, rotta 400) |
| pagina che interroga il DB anche con codice malformato | «codice malformato → senza toccare il database» |
| tolto `Allow: /cancellazione-dati` da robots.txt | «robots.txt apre le pagine legali» |
| tolto il riuso della richiesta aperta | golden «Meta riprova: stesso codice» |
