# Istruzioni per gli agenti (Codex e altri)

Questo repo è il CRM **Heili Orbit** (fork MIT di Vocero CRM). Per stack, mappa del codice e confini di modifica vale `CLAUDE.md`, che si applica a qualunque agente.

## Ciclo attivo (2 ottobre 2026)

- **Mandato dei pacchetti CRM (C1–C6):** `docs/mandati/MANDATO-CODEX-CRM-2026-10-02.md`.
- **Mandato principale** (orchestratore GPT Sol, esecutori GPT Luna, regole, revisione, report): repo `Insiderslab/heili-platform`, file `docs/mandati/PROMPT-CODEX-ORCHESTRATORE-SOL-2026-10-02.txt`.
- **Principio guida:** `heili-platform/docs/principio-autoriciclo.md`. Il CRM è il modulo `crm-orbit`; le personalizzazioni per cliente stanno nella configurazione, mai nel codice.

## Regole minime

- Il codice e i test sono l'autorità sullo stato del sistema.
- Ogni modifica che tocca autenticazione, chiavi, credenziali o separazione tra organizzazioni deve avere test negativi tra organizzazioni e revisione indipendente.
- Divieti:
  - merge su `main`, force-push o cancellazione di branch;
  - dipendenze nuove: si installa solo dal lockfile (`pnpm install --frozen-lockfile`);
  - lettura di `.env` o di dati reali;
  - operazioni su database o servizi di produzione.
- Mantenere l'attribuzione MIT dell'upstream (`LICENSE`).
