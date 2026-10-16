# Registro — 014 Guardia del webhook WhatsApp (2026-10-16)

## Perché
16/10: il callback dell'app Meta era su n8n («WhatsApp Trigger»), i messaggi del +1 555
non arrivavano e nessuno lo vedeva. Diagnosi e rimedio sono passati da due script sul VPS.
L'owner ha chiesto: «Procediamo sì con gli altri punti» (controllo automatico, pulsante
di ripristino, avviso di silenzio).

## Cosa
- `src/lib/webhook-route.ts`: logica pura (classificazione, silenzio, tipi).
- `src/server/whatsapp/webhook-route.ts`: controllo con Meta + cache, giro orario,
  ripristino del callback dell'app, statistiche di entrata.
- Rotte: `GET /api/settings/whatsapp/route-check` (admin),
  `POST /api/admin/platform/meta/webhook` (superadmin).
- UI: `src/components/settings/webhook-route-alert.tsx` (pagina WhatsApp + barra in
  `app-shell`). Testi es/en/it in `settings.whatsapp.route.*`.
- `instrumentation`: `startWebhookRouteGuard()`.
- wa-mock: `POST {app}/subscriptions` → `{ success: true }`.

## Decisioni
- **Solo l'host** dell'indirizzo estraneo esce dal server (nei log e nelle risposte).
- **«unknown» non è un allarme**: Meta giù o risposta senza il campo non devono
  accendere barre rosse.
- **Ripristino solo super-admin**: l'app Meta è una per istanza e il cambio vale per
  tutte le aziende.
- **Silenzio**: soglie conservative (≥ 3/giorno di media su 14 giorni, ≥ 24 h) per non
  dare falsi allarmi su numeri poco usati.
- Nessuna migrazione: lo stato vive in memoria (come i contatori della firma).

## Comandi e numeri
| Comando | Esito |
|---|---|
| `tsc --noEmit` | pulito |
| `eslint src tests/unit/webhook-route-guard.test.ts` | pulito |
| `vitest run tests/unit` | 90 file, 1447 test verdi (28 nuovi) |
| `vitest -c vitest.golden.config.ts` (PostgreSQL 16 vero) | 18 file, 182 test verdi (10 nuovi); istantanee invariate |
| `next build` | ok (le due rotte nuove compaiono come dinamiche) |

Nota golden: `message.created_at` lo scrive PostgreSQL (orologio reale) mentre l'arnés
congela l'orologio JS al 2030; il test allinea la riga all'orologio del test.

## Sabotaggi
| Sabotaggio | Test che fallisce |
|---|---|
| `foreignHost` = indirizzo completo (con percorso) | 5 test unit (host/percorso, vista) |
| tolto `scrubSecrets` dal messaggio di Meta | «Meta rifiuta: il messaggio torna senza segreti» |
| rotta di ripristino con `withAdminAuth` invece di `withSuperadmin` | `settings-routes-guard` (inventario per AST) |

## Da verificare in produzione
- Dopo il rilascio: Impostazioni → WhatsApp di «Negocio de Stefano Finoti» mostra la riga
  verde «Meta manda i messaggi al CRM».
- Nei log, entro un'ora dall'avvio: nessuna riga `[webhook-guard] ... NON manda`.
