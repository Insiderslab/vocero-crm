# Registro di lavoro — 2026-10-10 — ruoli-whatsapp

**Mandato:** falla trovata nella notte (fuori perimetro di C3): le route della connessione WhatsApp non controllano il ruolo. **Esecutore:** Claude. **Branch locale:** `notte/ruoli-whatsapp` (nessun push, nessuna PR). **Security-critical:** sì (permessi su credenziali e segreto del webhook): serve una revisione indipendente prima del merge.

Base: `810272a` (`origin/claude/keen-ptolemy-l0kv8g`). Baseline: 45 file, 349 test verdi.

## La falla

Un `member` (ruolo più basso) poteva, nella propria organizzazione:

| Route | Prima | Conseguenza |
|---|---|---|
| `PUT /api/settings/whatsapp` | solo `withAuth` | sostituire WABA, numero e token dell'organizzazione (il token viene ri-validato su Meta, cifrato e salvato) |
| `POST /api/settings/whatsapp/test` | solo `withAuth` | usare il CRM per provare token arbitrari contro Meta |
| `GET /api/settings/whatsapp` | solo `withAuth` | leggere WABA ID, phone number ID, stato e ultime 4 cifre del token |
| `GET /api/settings/webhook` | solo `withAuth` | leggere `META_WEBHOOK_VERIFY_TOKEN`, cioè il segmento segreto dell'URL del webhook (`/api/webhooks/wa/<token>`) |

Nessuna esposizione tra organizzazioni: tutte le query erano già per `session.organizationId`. Il difetto era solo di ruolo, dentro la stessa organizzazione.

## Correzione

**Una sola fonte (§3.2).** `src/lib/roles.ts` ora ha `isOrgAdmin(role)` (owner/admin, fail-closed su qualunque altro valore, comprese maiuscole e stringa vuota). `canManageApiKeys` (invariata nel comportamento) e il nuovo `canManageWhatsapp` ne sono viste con nome: le regole non possono divergere.

**Una sola guardia per le route.** `withAdminAuth(handler)` in `src/lib/api.ts`: come `withAuth`, ma risponde 403 `forbidden` a chi non è owner/admin **prima** di leggere il body, interrogare il DB o chiamare Meta. È usata da:
- `GET` e `PUT` di `src/app/api/settings/whatsapp/route.ts`;
- `POST` di `src/app/api/settings/whatsapp/test/route.ts`;
- `GET` di `src/app/api/settings/webhook/route.ts`.

**Pagina.** `/settings/whatsapp` mostra solo l'avviso `settings.whatsapp.forbidden` (es/en/it) a member e senza sessione, come già `/settings/api-keys`. Prima un member vedeva il wizard con le chiamate che ora falliscono.

## Verifica di TUTTE le route sotto `src/app/api/settings/**`

| Route | Metodo | Controllo di ruolo | Esito |
|---|---|---|---|
| `whatsapp` | GET, PUT | ora `withAdminAuth` | **corretto** |
| `whatsapp/test` | POST | ora `withAdminAuth` | **corretto** |
| `webhook` | GET | ora `withAdminAuth` | **corretto** |
| `bot-keys`, `bot-keys/[id]` | GET, POST, DELETE | `canManageApiKeys` | già ok |
| `export-keys`, `export-keys/[id]` | GET, POST, DELETE | `canManageApiKeys` | già ok |
| `team` | POST | `role !== "owner"` (solo owner) | già ok |
| `team` | GET | nessuno | **eccezione documentata**: elenca nome, email e ruolo dei membri della propria organizzazione; la usa la schermata Team per qualunque membro. Decisione dell'owner se restringerla |
| `branding` | PUT | `role !== "owner"` | già ok (più stretto di admin) |
| `branding` | GET | nessuno | pubblico a progetto (il login ha bisogno della marca); restituisce solo la marca dell'organizzazione della sessione |
| `branding/favicon` | PUT, DELETE | `role !== "owner"` | già ok |

Nessun'altra route di modifica sotto `settings/**` è senza controllo di ruolo.

## Test

Nuovi, 38 in 3 file:
- `tests/unit/settings-whatsapp-routes.test.ts` (due organizzazioni):
  - member → 403 su ciascuna delle 4 operazioni, senza alcuna lettura, prova su Meta, scrittura o sottoscrizione, e senza che il corpo della risposta contenga WABA, token o segreto del webhook;
  - ruoli sconosciuti (`""`, `Owner`, `ADMIN`, `viewer`, `superadmin`) → 403 su tutte (fail-closed);
  - senza sessione → 401;
  - owner e admin → 200 su tutte; del token escono solo le ultime 4 cifre;
  - lo stesso utente member in A (anche se owner in B) → 403 su A;
  - isolamento: l'owner di B legge solo la connessione di B (mai WABA, phone ID o token di A); un'organizzazione senza connessione non riceve quella di un'altra; salvare come B scrive in B anche se il corpo nomina `org_a`; un member di A che conosce il `wabaId` di A non sostituisce nulla.
- `tests/unit/settings-whatsapp-page.test.ts`: la pagina (member e senza sessione → solo avviso; owner/admin → wizard); `canManageApiKeys` e `canManageWhatsapp` coincidono con `isOrgAdmin` per 7 valori di ruolo.
- `tests/unit/settings-routes-guard.test.ts`: guardrail strutturale. Ogni handler esportato sotto `src/app/api/settings/**` deve avere un controllo di ruolo o figurare, con il motivo, nella lista delle eccezioni (oggi 2: `team` GET, `branding` GET); un'eccezione che non esiste più fa fallire il test. Contiene anche i test di sabotaggio dello scanner stesso (una route sabotata viene segnalata).

Nessun test esistente è stato modificato.

## Sabotaggio (eseguito, poi ripristinato)

| Sabotaggio | Esito |
|---|---|
| in `withAdminAuth` il controllo diventa `if (false)` | 11 test falliti (route) |
| `withAuth` al posto di `withAdminAuth` in `whatsapp/route.ts` | 11 falliti (route + guardrail) |
| idem in `whatsapp/test/route.ts` | 9 falliti |
| idem in `webhook/route.ts` | 9 falliti |
| pagina senza controllo (`false` al posto di `!canManageWhatsapp(...)`) | 1 fallito (member vedrebbe il wizard) |

## Prove

| Comando | Esito |
|---|---|
| `pnpm typecheck` | ok |
| `pnpm lint` | ok |
| `pnpm test` | **48 file, 387 test** verdi (baseline 45/349, +38) |
| `pnpm build` | ok |
| `pnpm db:generate` | non necessario: nessuna modifica allo schema |

## Non verificato

- Nessuna prova contro un database reale né contro Meta: le route sono provate con sessione e moduli WhatsApp sostituiti da doppioni (come `bot-keys-routes.test.ts`). Il ruolo viene da `requireSession`/`resolveMembership`, non toccati.
- Non eseguito l'E2E con Playwright (richiede app viva e mock).
- Non verificata a mano la UI dei member dopo il cambio (solo rendering lato server della pagina).

## Da segnalare all'owner (fuori perimetro, non toccato)

1. **Voce "WhatsApp" in `SettingsNav` e redirect `/settings` → `/settings/whatsapp`** restano per tutti: un member che apre Impostazioni atterra sull'avviso di divieto. Decisione di prodotto: nascondere la voce ai member e reindirizzarli a `/settings/team` (richiede di cambiare `settings-nav.test.ts`, che oggi afferma che il member la vede).
2. **`POST /api/templates/sync`** (`src/app/api/templates/sync/route.ts`) e le altre route di `src/app/api/templates/**` usano solo `withAuth`: un member può sincronizzare e, da verificare, creare modelli da far approvare a Meta con le credenziali dell'organizzazione. Non è lettura di segreti, ma è azione esterna: da decidere se serve owner/admin.
3. **L'URL del webhook è globale**, non per organizzazione: `META_WEBHOOK_VERIFY_TOKEN` è una variabile d'ambiente unica, e `GET /api/settings/webhook` la mostra a ogni organizzazione (ora solo ai suoi owner/admin). In un'istanza con più organizzazioni, l'admin di un'organizzazione conosce il segreto dell'URL usato da tutte. Per il multi-cliente (visione del piano) serve un segreto per organizzazione: decisione di architettura, non banale.
4. `branding` e `team` usano `role !== "owner"` in linea, non la regola unica: corretti ma duplicati. Candidati a una `isOrgOwner` in `roles.ts` (refactor separato).
