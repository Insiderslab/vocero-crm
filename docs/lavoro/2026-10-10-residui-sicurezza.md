# Registro di lavoro — 2026-10-10 — residui-sicurezza (M0.3)

**Mandato:** residui di sicurezza di `src/server/api-keys.ts` (registro `docs/lavoro/2026-10-05-c2-3.md`, sezione non chiusi). Branch locale `notte/residui-sicurezza`, nessun push. **Security-critical:** serve revisione indipendente prima del merge.

## Chiusi
1. `requireInstanceKey`: i fallimenti (senza header, chiave corta/errata, confronto fallito) contano per IP del client (`<bucket>:invalid:<ip>`, stessa `clientIp`); l'IP gia' bloccato riceve 429 anche con la chiave buona (come per le chiavi per organizzazione). Il contatore `<bucket>:instance` si consuma solo dopo il confronto riuscito: un flood di x-api-key false non blocca piu' la chiave d'istanza legittima.
2. Rate limit in memoria: pulizia ammortizzata ogni `SWEEP_EVERY` (500) accessi di `checkRateLimit`; elimina le voci la cui marca piu' recente e' fuori dalla finestra massima vista (scadute per qualunque limite). Test: `rateLimitSize`.
3. Test di protezione: `authRateLimitAllowed` (estratta dall'hook di login in `src/lib/rate-limit.ts`, stesso comportamento) testata per IP via x-forwarded-for; `tests/unit/roles.test.ts` per il confronto esatto di `canManageApiKeys` ('owner-x', 'xadmin', 'Owner', ...).

## Sabotaggi (invertire, un test fallisce, ripristinato)
sweep disattivato; chiave login senza IP; ruolo con includes/lowercase; contatore istanza non consumato dopo successo; fallimenti sul contatore istanza invece che per IP: tutti rilevati.

## Non chiusi
Nessuno. Nota: l'affidabilita' di `clientIp` dipende dal proxy che fissa x-forwarded-for (gia' documentato nel codice).
