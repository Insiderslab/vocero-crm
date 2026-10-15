# Registro di lavoro — 2026-10-15 — 013 «Collegamento WhatsApp guidato»

**Mandato:** rendere semplice collegare WhatsApp per un owner che non è sviluppatore.
(1) Niente SSH per la configurazione Meta dell'istanza: scheda «Piattaforma → Meta» in
`/admin` (super-admin) con App ID e Configuration ID in una tabella d'istanza
(migrazione 0016), ambiente come override, App Secret solo d'ambiente. (2) Pagina
Configurazione → WhatsApp guidata in 3 passi con striscia di stato; il tecnico in
«Avanzate». (3) Nessun cambio a webhook, ingestione, canje dell'Embedded Signup (salvo
da dove legge la config) e firma della PR #9.

**Branch:** `wa-guidato` (worktree `crm-waguide`), base `origin/main` @ `30ccd1b`.
Commit locali, **nessun push**, produzione non toccata.
**Spec:** [`specs/custom-heili/013-collegamento-whatsapp-guidato.md`](../../specs/custom-heili/013-collegamento-whatsapp-guidato.md).
**Guida per l'owner:** [`docs/ops/collegare-whatsapp.md`](../ops/collegare-whatsapp.md).

Baseline su `30ccd1b`: unit 85 file / 1286 test; golden 14 file / 148.

## Cosa è cambiato

### Piattaforma → Meta (super-admin)
- Tabella **`instance_setting`** (chiave/valore) — `drizzle/0016_instance_setting.sql`:
  solo catalogo, `SET LOCAL lock_timeout = '5s'` come 0013–0015, snapshot `0016`
  concatenato a `0015` (`prevId` = id della 0015; il resto dello snapshot identico).
  Due `CHECK`: chiavi in lista bianca (`meta_app_id`, `meta_es_config_id`) e valore
  `^[0-9]{6,25}$`. Il DB stesso rifiuta un App Secret o testo libero.
- `src/server/platform/instance-settings.ts` (lettura/scrittura) e
  `src/server/platform/meta-config.ts`: `resolveMetaIds` (pura: ambiente se impostato,
  poi DB, poi niente; ID per ID), `metaIdInput`/`metaPlatformInput` (Zod, `strict`),
  `getMetaPlatformIds` (con entrambi gli ID nell'ambiente il DB non si legge),
  `getMetaPlatformStatus` (costruito campo per campo; dell'App Secret solo
  `present` + contatori della firma della PR #9).
- `getEmbeddedSignupConfig` diventa **asincrona** e legge `getMetaPlatformIds`; prima
  controlla segreto e Wapi (stesso risultato di prima, ma senza leggere il DB quando
  non serve). `completeEmbeddedSignup` la attende; il resto del canje è invariato.
- `GET/PUT /api/admin/platform/meta` con `withSuperadmin`.
- Scheda `src/components/admin/meta-platform-card.tsx` in `/admin` (sezione
  «Piattaforma»): ID con fonte (ambiente / salvato qui / non impostato), validazione
  nel modulo, stato dell'App Secret, «Pronto»/«Da completare», checklist Meta con link.

### Pagina WhatsApp guidata (owner/admin)
- Macchina a stati pura `src/lib/whatsapp-guide.ts`: `guideState`
  (non configurata / pronta / collegata / da ricollegare / coexistence tagliata — il
  taglio ha la precedenza sul token), `guideSteps`, `connectionMode`,
  `signatureState` (verificata solo se l'ultima firma valida è più recente dell'ultimo
  rifiuto).
- `GET /api/settings/whatsapp/status` (`withAdminAuth`) →
  `src/server/whatsapp/guide-status.ts`: piattaforma pronta (+ motivo), connessione
  senza token né ultime 4 cifre, firma (richiesta, configurata, contatori), ultimo
  entrante = `max(conversation.last_inbound_at)` senza Laboratorio (`scoped()`).
- `src/components/settings/whatsapp-guide.tsx`: striscia, avvisi per stato, 3 passi,
  «ultimo messaggio ricevuto» in diretta (SSE `message.new` → refetch; «X fa» si
  aggiorna ogni 30 s), «Avanzate» in `<details id="avanzate">` chiusa (si apre dai link
  o con `#avanzate`). La vista è un componente puro (`WhatsappGuideView`) testabile.
- `whatsapp-wizard.tsx` → **`whatsapp-advanced.tsx`** (`git mv`): solo collegamento
  manuale + webhook, stesse API; gli avvisi passano alla guida. `coexistence-connect.tsx`
  ora è solo il pulsante (+ esito), con etichetta configurabile («Ricollega con Meta»).
- i18n es/en/it: `settings.whatsapp.guide.*`, `admin.platform.*`; `reconnectBody`
  riscritto; rimosse 7 chiavi non più usate.

### Non toccati
Webhook (`src/app/api/webhooks/**`), `src/server/inbox/**` (ingestione, firma,
contatori), `src/lib/meta/**`, `src/server/whatsapp/credentials.ts`,
`src/app/api/settings/whatsapp/route.ts` (dove la PR #14 mappa il 409).
`git diff 30ccd1b -- src/app/api/webhooks src/server/inbox src/lib/meta` è vuoto.

## Rotte nuove → ruolo (inventario `tests/unit/helpers/route-roles.ts`)

| Rotta | Metodi | Politica | Perché |
|---|---|---|---|
| `admin/platform/meta` | GET, PUT | superadmin | ID Meta dell'istanza (non segreti); dell'App Secret solo presenza e contatori |
| `settings/whatsapp/status` | GET | admin | stato della guida (numero, modo, firma, ultimo entrante), senza segreti |

## File server toccati (per l'unione con la PR #14)

- Modificati: `src/server/whatsapp/embedded-signup.ts` (solo `getEmbeddedSignupConfig`
  + `await`), `src/app/api/settings/whatsapp/embedded-signup/route.ts` (solo `await` e
  commento), `src/lib/db/schema.ts` (tabella in coda), `drizzle/meta/_journal.json`.
- Nuovi: `src/server/platform/instance-settings.ts`, `src/server/platform/meta-config.ts`,
  `src/server/whatsapp/guide-status.ts`, `src/app/api/admin/platform/meta/route.ts`,
  `src/app/api/settings/whatsapp/status/route.ts`, `src/lib/whatsapp-guide.ts`,
  `drizzle/0016_instance_setting.sql`, `drizzle/meta/0016_snapshot.json`.
- Prova: `git merge-tree --write-tree HEAD <PR #14 @ df7ce58>` → **nessun conflitto**
  testuale (la PR #14 tocca la rotta embedded-signup in un altro punto e l'inventario
  dei ruoli in altre righe; non ha una migrazione 0016; tiene `getCredentialsByOrg`).

## Prove

| Comando (`./node_modules/.bin/*`) | Esito |
|---|---|
| `tsc --noEmit` · `eslint .` · `next build` | ok (le due rotte nuove nel build) |
| `vitest run` | **87 file, 1379 test** verdi (baseline 85/1286; +35 `platform-meta`, +49 `whatsapp-guide`, +9 casi dell'inventario dei ruoli) |
| golden su base nuova (`vocero_waguide_golden_full1`) | **16 file, 162/162** (148 + 14 nuovi), **istantanee invariate** (`tests/golden/__golden__` senza modifiche) |
| E2E `e2e-selftest.mjs` su base nuova (`next dev` + mock, `META_APP_SECRET` sintetico, **senza** `META_APP_ID`/`META_ES_CONFIG_ID`), due corse (`vocero_waguide_e2e`, poi `vocero_waguide_e2e2` col codice finale) | **225/225** entrambe, 0 SKIP: la sezione 009 (coexistence) prima si saltava, ora corre con gli ID salvati in `/admin` dalla sezione 013 |
| `channels_legacy_check()` dopo l'E2E | V1–V6 = 0 |
| E2E browser `e2e-whatsapp-guidato.mjs` (stessa app) | **40/40**, nessun errore JavaScript |

Test nuovi:
- `tests/unit/platform-meta.test.ts` — risoluzione (ambiente vince, misto, spazi),
  validazione (5/26 cifre, lettere, cifre a larghezza piena, vuoto = cancella, corpo
  `strict`), Embedded Signup da DB/ambiente (DB non letto con l'ambiente completo,
  spento senza segreto o con Wapi), stato senza segreto, rotta: 401/403 senza
  letture né scritture, 422, cancellazione.
- `tests/unit/whatsapp-guide.test.ts` — stati, passi, firma, vista in 6 stati × 3
  lingue senza chiavi crude.
- `tests/golden/platform-meta.golden.test.ts` — member/admin/owner non super-admin →
  403 senza scritture; super-admin salva (fonte `db`, `updated_by`); 422; CHECK del DB;
  senza config → 409 senza chiamare Meta; con config → canje completo con `client_id`
  = App ID salvato; nessun App Secret/token/verify token nelle risposte; ultimo entrante
  senza Laboratorio né altra organizzazione; member → 403 sullo stato.
- `tests/golden/platform-meta-env.golden.test.ts` — l'ambiente vince (scheda e canje).
- Modificati: `coexistence.test.ts` (doppio dell'archivio), `settings-whatsapp-page.test.ts`
  e `wapi-key-page.test.ts` (la carta Wapi e il modo manuale stanno in «Avanzate», chiusa).

## Schermate (`docs/lavoro/img/013/`, italiano)

| File | Cosa |
|---|---|
| `guida-1-non-configurata.png` | manca la configurazione Meta della piattaforma |
| `guida-2-pronta.png` | pronta: pulsante «Collega con Meta» nel passo 1 |
| `guida-3-collegata.png` · `-scuro.png` · `-390.png` | collegata in coexistence, ultimo messaggio ricevuto |
| `guida-4-da-ricollegare.png` | token scaduto: «Ricollega con Meta» + alternativa manuale |
| `guida-5-coexistence-tagliata.png` | Meta ha scollegato il numero |
| `admin-meta-chiaro.png` · `admin-meta-scuro.png` · `admin-meta-390.png` | scheda Piattaforma → Meta |
| `admin-meta-compilata.png` | modulo compilato prima di salvare |

Lo stato «da ricollegare» nello script del browser si ottiene scrivendo nel DB **di
prova** (`status = 'reconnect_required'`) e riallineando `channel_account` con
`channels_legacy_sync_accounts` (V2 resta 0): con il wa-mock non c'è un modo via API
di far rifiutare a Meta un token già salvato.

## Sabotaggi (uno alla volta, file ripristinato)

| # | Sabotaggio | Unit (4 file) | Golden (2 file nuovi) |
|---|---|---|---|
| S1 | `admin/platform/meta` con `withAdminAuth` invece di `withSuperadmin` | rosso (6) | rosso (3: member/admin/owner) |
| S2 | il DB vince sull'ambiente (ordine invertito in `pick`) | rosso (2) | rosso (1) |
| S3 | lo stato della piattaforma espone `META_APP_SECRET` | rosso (2) | rosso (1) |
| S4 | lo stato della guida espone il token WhatsApp | verde (non coperto da unit) → **rosso (2)** dopo il test aggiunto il 15/10 sera, vedi sotto | rosso (1) |

Nota S2: con entrambi gli ID nell'ambiente il DB non si legge, quindi il canje usa
l'ambiente anche col sabotaggio; lo vede il test della scheda (fonte e valore).

## Non verificato

- Nessuna prova con Meta reale: la finestra di Meta, il dominio consentito e la
  configurazione v4 si vedono solo in produzione. I nomi dei menu di Meta nella
  checklist e i link alla documentazione di Meta non sono stati aperti da qui.
- Deploy: nessuno. Con il rilascio arriva la migrazione 0016 (solo catalogo).

## Domande aperte per l'owner

1. Dopo il rilascio, togliere `META_APP_ID`/`META_ES_CONFIG_ID` dall'ambiente del VPS
   (e il sotto-comando `attiva-pulsante` di `rilascio-crm.sh`) per gestirli da `/admin`?
   Finché ci sono, vincono loro e la scheda lo dice.
2. La striscia mostra la firma del webhook anche quando l'azienda non ha ancora un
   numero (è un dato dell'istanza). Va bene, o meglio «—» finché non c'è un numero?
3. Ricollegare con Meta da «token scaduto» porta una connessione manuale in
   coexistence (il pulsante fa solo coexistence). Va bene così, o per le connessioni
   manuali mostrare solo la via di «Avanzate»?

## 2026-10-15 (sera) — Decisioni del coordinatore sulle domande aperte

| # | Decisione | Fatto | Commit |
|---|---|---|---|
| Q3 | Un numero collegato a mano (modalità non coexistence) da ricollegare NON offre «Ricollega con Meta» (il +1 555 di test di Meta non deve mai passare in coexistence con un clic) | regola pura `reconnectVia()` in `src/lib/whatsapp-guide.ts` (`manual` per ogni connessione non coexistence, `meta` solo coexistence con piattaforma pronta); avviso «Questo numero è collegato a mano…» + pulsante «Incolla un token nuovo» che apre «Avanzate» con il cursore sul campo del token (verificato nel browser: `details` aperto, focus su `#token`, 0 pulsanti Meta). Unit (7 casi) + golden (manuale → `manual`, coexistence → `meta`, con `markReconnectRequired` vero) | `ddb4e6e` |
| Q2 | Senza numero, firma «—» nella striscia; il valore d'istanza resta in /admin | unit + controllo nel browser | `6de18aa`, `11a8002` |
| S4 | Il buco di copertura unit | `tests/unit/guide-status-secrets.test.ts`: scansione ricorsiva delle chiavi (`token|secret|verify|last4|cipher|password`) + scansione dei valori (token della fixture, ultime 4, App Secret, verify token). S4 ripetuto in tre varianti (`token`, `tokenLast4`, token dentro un altro campo): **rosso, 2 su 4**, in tutte | `0249332` |
| Q1 | Nessun cambio di codice: una volta salvati gli ID in /admin, si possono togliere `META_APP_ID`/`META_ES_CONFIG_ID` dal `.env` del VPS (facoltativo; finché ci sono, vince l'ambiente) | riga in `docs/ops/collegare-whatsapp.md` (Parte 1, punto 5) e qui | questo commit |
| — | Commit non autoconsistente (`7a707b0` senza la riga dell'inventario, arrivata in `586dbc1`) | **lasciato com'è**: sistemarlo vuol dire riscrivere la storia con un rebase interattivo, non disponibile qui. A `7a707b0` da solo `settings-routes-guard.test.ts` sarebbe rosso; dal commit successivo in poi è verde | — |

Schermate: `guida-1-non-configurata.png` e `guida-2-pronta.png` rigenerate (firma «—»);
nuova `guida-4b-manuale-da-ricollegare.png` (numero manuale, solo «Incolla un token nuovo»).

**Prove (stessi gate):** `tsc`, `eslint .`, `next build` ok · `vitest run` **88 file,
1394** · golden su base nuova (`vocero_waguide_golden_full2`) **16 file, 164/164**,
istantanee invariate · E2E `e2e-selftest.mjs` su base nuova (`vocero_waguide_e2e3`)
**225/225**, 0 SKIP · browser `e2e-whatsapp-guidato.mjs` **41/41** · V1–V6 = 0.
