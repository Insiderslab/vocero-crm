# MANDATO — US1: invito con link copiabile

Spec: `specs/custom-heili/004-registro-e-invitaciones.md`, **solo User Story 1 (P1)**.
Branch di lavoro: `claw/us1-inviti`. Base: `notte-2026-08-21`.
Esecutore: Kimi. Revisore: Stefano, lunedì.

## Perimetro

Puoi modificare SOLO:

- `src/app/api/settings/team/**`
- `src/app/invitacion/**` (nuova pagina di accettazione)
- `src/lib/auth/**`, `src/server/**` limitatamente agli inviti
- `tests/**`

Tutto il resto è fuori perimetro. Se ti serve toccare altro: **fermati e segnala**.

## Vietato

- toccare `main` o `notte-2026-08-21`
- modificare `src/lib/db/schema.ts` — questo carril NON tocca il modello dati.
  Se serve una migrazione, il carril sale a ciclo completo: **fermati e segnala**
- toccare `.env`, credenziali, deploy, docker-compose, DB di produzione
- implementare US2 o US3 (super-admin, self-signup): non sono in questo mandato
- invio email: proibito dalla costituzione II. L'invito è un link copiabile

## Chiarimenti già risolti — non reinterpretarli

- **FR-102 scadenza**: usa il default del plugin (48h). Non introdurre i 7 giorni.
- **FR-107 MAX_ORGANIZATIONS**: fuori perimetro, riguarda US3.

## Cosa significa "fatto"

I 5 acceptance scenario della US1 devono avere un test che li copre:

1. owner crea invito con email+ruolo → UI mostra link unico, invito `pending` con scadenza
2. link valido + visitatore senza account → vede org e ruolo, crea account SOLO con l'email dell'invito, diventa membro, invito `accepted`
3. link valido + utente già registrato con quella email → login, accetta, diventa membro
4. link usato/scaduto/revocato → pagina "invito non valido", non crea nulla
5. membro non owner/admin che crea invito → 403

Più la regressione SC-004: il self-test E2E esistente resta verde.

## Protocollo di sessione

Ogni sessione chiude così, senza eccezioni:

1. `npm test` — **incolla l'output reale** nel work-log. Nessun output = task non fatto
2. commit sul branch `claw/us1-inviti`, push
3. aggiorna `LAVORO-CLAW-US1.md` con:
   - cosa ho fatto in questa sessione (con file toccati)
   - **cosa NON ho verificato**
   - **cosa deve controllare il revisore**

Un commit di soli file `.md` non conta come lavoro: il gate lo scarta.

## Se ti blocchi

Due tentativi. Al terzo: fermati, scrivi il blocco nel work-log, non improvvisare
e non allargare il perimetro per aggirarlo.
