# Catena CRM — #16 → #14 → #13 → #10 su `main` (16/10/2026)

Richiesta del proprietario (16/10): preparare le PR #13 e #10 rinumerate e
aggiornate su `main`, senza toccare i branch delle PR originali. Ordine:
#16 → #14 → #13 → #10.

## Branch

| Branch | Contenuto | Sostituisce |
|---|---|---|
| `claude/crm-13-rinumerata` | `main` + #16 + #14 + #13 | #13 (e porta con sé #16, #14) |
| `claude/crm-catena` | il precedente + #10 + correzione guardia | #10 |

Le PR originali restano intatte: si uniscono queste al loro posto, oppure si
chiudono e si usano come riferimento.

## Migrazioni

`main` ha già `0016_instance_setting` (PR #15). Le due PR aggiungevano
entrambe una `0016_*`:

- `0016_team_broadcast` (#13) → **`0017_team_broadcast`**
- `0016_richieste_sito` (#10) → **`0018_richieste_sito`**

Metodo: journal e snapshot di `main`, tolta la migrazione della PR,
`pnpm db:generate --name …` per rigenerare journal e snapshot (`prevId`
concatenati 0016 → 0017 → 0018, `when` crescenti). Il corpo SQL è quello
originale della PR (con `SET LOCAL lock_timeout`, il CHECK `NOT VALID` e
l'indice parziale scritti a mano), cambiano solo i commenti sul numero. Un
secondo `db:generate`: «No schema changes». I registri storici
(`2026-10-11-richieste-dal-sito.md`) citano i numeri di allora: non riscritti.

## Conflitti risolti

- `schema.ts`, `ids.ts`, `scripts/e2e-selftest.mjs`: aggiunte di entrambe le
  parti, tenute tutte.
- `src/lib/types.ts`: `MessageDto.channel` = unione completa (#14) + `web` (#10).
- **#10 su #14**: #14 ha spostato identità e ingesta WhatsApp in
  `src/server/channels/core/`. La regola di #10 (il primo entrante WhatsApp in
  vivo dà il nome verificato a un contatto nato dal modulo del sito) è portata
  in `core/identity.ts` (`getOrCreateWhatsappContact`, `verifiedInbound`,
  `hasWhatsappInbound`) e `core/ingest.ts` (`resolveContact`,
  `ingestInboundMessage`); echi e storico della coexistence non la attivano.
  `inbox/identity.ts` e `inbox/ingest.ts` restano gli shim di #14.

## Correzione emersa dalla revisione (#16 × #10)

`inboundStats` (guardia del webhook, #16) contava come entranti anche le
richieste del sito (`channel = web`, #10): con Meta che non consegna più e il
modulo del sito attivo, l'avviso di silenzio insolito non sarebbe scattato.
Ora conta solo `channel = whatsapp`. Golden nuovo in
`tests/golden/webhook-route-guard.golden.test.ts`: rosso senza la correzione,
verde con.

## Verifiche

- `pnpm typecheck`, `pnpm lint`: puliti.
- `pnpm test`: 97 file, 1641 test verdi.
- `pnpm test:golden` (PostgreSQL 16 locale usa-e-getta): 23 file, 259 verdi
  prima della correzione; 260 dopo.
- `pnpm build`: ok.
- Migrazioni su base vuota con `scripts/migrate.mjs`: 0016–0018 applicate,
  verifiche canali V1–V7 = 0.
- `pnpm test:e2e` con app in `pnpm dev` e mock: **278/278**. Per l'E2E
  servono anche `OPENROUTER_MODEL` (qualsiasi valore col mock),
  `SUPERADMIN_EMAILS` con l'operatore E2E e `AGENT_RETRY_MS` corto.
- Revisione indipendente delle risoluzioni: nessuna perdita funzionale;
  unico problema reale quello corretto sopra.

## Non fatto

Nessun merge in `main`, nessun commento sulle PR originali, nessun deploy.
