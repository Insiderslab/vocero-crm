# Piano di programmazione — CRM multicliente e multicanale (dal 10/10/2026)

> Direzione: `docs/visione/crm-multicanale-multicliente.md` · Analisi dei riferimenti: `docs/visione/analisi-repository-crm-arm.md`.
> Valgono le Leggi di Heili (`docs/LEGGI-AI-CODING.md`) e la costituzione Speckit del repo (`.specify/`).

## 1. Configurazione degli agenti (modelli Anthropic)

| Ruolo | Modello (alias Claude Code) | ID API | Prezzo input/output per 1M token | Sforzo | Fa |
|---|---|---|---|---|---|
| **Orchestratore** | Claude Opus 5.5 (sessione principale) | `claude-opus-5-5` | 4 $ / 20 $ | alto | Specifiche e ADR, scomposizione in pacchetti, integrazione, revisione finale, rapporti con l'owner |
| **Esecutore** | Claude Sonnet 5.5 · `sonnet` | `claude-sonnet-5-5` | 2 $ / 10 $ | **medio** (alto per migrazioni e sicurezza) | Scrive codice e test di **un** pacchetto, in un worktree separato |
| **Esploratore** | Claude Haiku 5.5 · `haiku` | `claude-haiku-5-5` | 0,10 $ / 0,50 $ (fino a 100K token di prompt) | basso | Inventari, ricerche nel codice, stringhe i18n, dati di prova, bozze di documentazione. Sola lettura, salvo i18n e fixture |
| **Verificatore** | Claude Opus 5.5 · `opus` | `claude-opus-5-5` | 4 $ / 20 $ | alto | Verifica avversaria dei pacchetti critici (isolamento, migrazioni, webhook, credenziali): prova a romperli |
| Verificatore leggero | Claude Sonnet 5.5 | `claude-sonnet-5-5` | 2 $ / 10 $ | medio | Verifica dei pacchetti non critici (UI, documenti) |

**Perché questa divisione:**
- **Sonnet 5.5** è il modello Anthropic pensato per il coding quotidiano e gli agenti, a metà prezzo di Opus 5.5. Per il coding agentico conviene partire da sforzo medio.
- **Haiku 5.5** costa circa 40 volte meno di Opus in input: va bene solo per lavoro meccanico o di lettura.
- **Opus** resta dove un errore costa caro: architettura e verifica di sicurezza.

**Regola sui costi:** conta il **costo per pacchetto chiuso**, non per singola richiesta. Se Sonnet a sforzo medio richiede troppi giri su un tipo di pacchetto, si alza lo sforzo a alto prima di cambiare modello. Si misura sui primi 3 pacchetti.

I file degli agenti sono in `.claude/agents/`: `crm-esecutore.md` (sonnet), `crm-verificatore.md` (opus), `crm-esploratore.md` (haiku).

**Coordinamento con Codex:**
- **Corsia del CRM multicanale (vocero-crm, wapi, heili-dm): a Claude.**
- **Codex** resta sulla fase S di heili-platform.
- Mai due agenti sugli stessi file.

## 2. Metodo per ogni pacchetto
1. **Specifica** (orchestratore): `specs/00X-…` con Speckit (specify → plan → tasks), perimetro dei file, criteri di pronto e test negativi richiesti.
2. **Esplorazione** (Haiku, facoltativa): inventario dei punti da toccare.
3. **Esecuzione** (Sonnet, in un worktree):
   - diff minimo e test, compresi i test negativi;
   - test di sabotaggio su ogni guardia nuova: si inverte la guardia e almeno un test deve fallire;
   - registro in `docs/lavoro/`.
4. **Controlli automatici:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` e `db:generate` se c'è uno schema. **Tutti verdi, senza eccezioni.**
5. **Verifica avversaria** (Opus per i pacchetti critici): se non regge, si torna al punto 3.
6. **PR in bozza** verso `main`, con riepilogo in 5 righe. **Il merge lo fa l'owner.**
7. **WIP:** al massimo 3 pacchetti attivi. Si apre la fase successiva solo quando la precedente è «pronta».

## 3. Fasi e pacchetti

### M0 — Isolamento tra clienti (prerequisito, 1 settimana di calendario, dipende dai merge)
| ID | Pacchetto | File principali | Esecutore / verifica |
|---|---|---|---|
| M0.1 | Merge di C1 e C2, che sono già fatti, e rilascio con `docs/ops/rilascio-c1.md` | branch `claude/keen-ptolemy-l0kv8g` | Owner (merge e rilascio) |
| M0.2 | **C3: chiave Wapi per organizzazione, cifrata.** Oggi c'è una `WAPI_API_KEY` globale con allowlist `WAPI_ORG_IDS` (`src/lib/meta/client.ts`) | `src/lib/meta/client.ts`, `src/lib/env.ts`, schema, impostazioni | Sonnet (alto) / **Opus** |
| M0.3 | Residui: la chiave d'istanza bloccabile con richieste false (`requireInstanceKey`) e il contatore condiviso da IP comuni | `src/server/api-keys.ts` | Sonnet (medio) / Opus |
| M0.4 | Script di backup giornaliero del Postgres del CRM fuori dal VPS (solo script e documentazione) | `scripts/ops/`, `docs/ops/` | Sonnet / Sonnet |

**Pronto quando:** due organizzazioni di prova risultano separate in tutti i test negativi (bot, export, Wapi), e il backup e il ripristino sono documentati.

### M1 — Livello canali comune (2–3 settimane): WhatsApp invariato, modello pronto per gli altri canali
| ID | Pacchetto | Note | Esecutore / verifica |
|---|---|---|---|
| M1.1 | **ADR + specifica `specs/005-livello-canali`**: contratto `ChannelAdapter` (`ricevi → evento normalizzato`, `invia`, `capacità`, `stato`) e modello dati | Riferimento: Chatwoot (canale → inbox → conversazione). **L'owner approva l'ADR** | Opus (orchestratore) |
| M1.2 | **Migrazione dati in due tempi:** `channel_account` (da `meta_credentials`), `contact_identity` (da `contact.wa_identity`), `conversation.channel_account_id`, `message.channel` + `external_message_id` (da `wa_message_id`). Prima si aggiungono e si riempiono i campi nuovi; le colonne vecchie si tolgono solo in un rilascio successivo | Prova su un PostgreSQL reale, usa e getta: applicazione da zero e aggiornamento da produzione simulata | Sonnet (alto) / **Opus** |
| M1.3 | **Adattatore WhatsApp:** `src/server/inbox/*`, `src/server/whatsapp/*` e `/api/webhooks/wa` dietro il contratto. **Comportamento identico** | Test «golden» sui payload reali dei webhook (anonimizzati); tutti i test esistenti verdi | Sonnet (medio) / **Opus** |
| M1.4 | Inbox e scheda contatto per canale: badge del canale, filtro, più identità per contatto, unione con conferma | Stringhe in es/en/it scritte da Haiku | Sonnet / Sonnet |
| M1.5 | L'agente AI conosce le capacità del canale: finestra di risposta, modelli solo su WhatsApp, allegati | `src/server/ai/*` | Sonnet / Opus |

**Pronto quando:**
- tutti i test esistenti sono verdi, più i test golden;
- il test end-to-end WhatsApp dell'owner è riuscito;
- la migrazione è stata provata su una copia di dati.

### M2 — «Nuovo cliente» in meno di 15 minuti (2 settimane)
| ID | Pacchetto | Note | Esecutore / verifica |
|---|---|---|---|
| M2.1 | **Moduli attivabili per organizzazione** (`org_module`): ogni funzione si accende o si spegne per cliente | Il contratto `heili.module.v1` in versione ridotta | Sonnet / Opus |
| M2.2 | **Pacchetti di settore v1** (ristorazione, edilizia, agenzia): fasi della pipeline, profilo dell'agente, modelli della base di conoscenza, automazioni, moduli attivi. Sono dati, non codice | Haiku prepara le bozze, l'orchestratore le rivede | Sonnet / Sonnet |
| M2.3 | **Procedura guidata superadmin:** crea l'organizzazione, invita il titolare (spec 004: inviti con link), sceglie il pacchetto, apre il Laboratorio | `specs/custom-heili/004-registro-e-invitaciones.md` | Sonnet / Opus (inviti = sicurezza) |
| M2.4 | Collegamento dei canali dal pannello: oggi manuale, l'Embedded Signup arriva quando Meta abilita il Tech Provider | Interfaccia e stati; nessuna dipendenza bloccante | Sonnet / Sonnet |

### M3 — Instagram e Messenger (2–3 settimane, **dopo l'App Review di Meta**)
- **M3.0 (Opus, mezza giornata):** riusare il codice Instagram di **heili-dm** (DM, finestra di 24 ore, già in produzione) dentro l'adattatore, oppure scrivere un adattatore nuovo. Decisione da sottoporre all'owner.
- **M3.1 Adattatore Instagram** e **M3.2 adattatore Messenger:** Sonnet (alto) / Opus. Webhook con firma verificata prima di salvare, idempotenza, test di isolamento.

### M4 — Email (1–2 settimane)
- **M4.0** Scelta: indirizzo di inoltro più invio API/SMTP (più semplice), oppure OAuth Gmail e Microsoft (richiede la verifica delle app).
- **M4.1 Adattatore email** (thread, mittente verificato, allegati): Sonnet / Opus.

### M5 — TikTok (in attesa)
- La API dei DM non risulta disponibile per le aziende UE. Haiku controlla una volta al mese.
- Nel frattempo, solo lead da moduli e annunci.

### Corsia ARM (dopo M1, in parallelo a M3/M4)
- **R1 «Recensioni Google»** sul modello di AutoReview: l'AI scrive solo bozze e pubblica una persona; serve l'accesso all'API di Google Business Profile.
- **R2 «Reputazione nelle AI»**: Limelit Open come servizio.

## 4. Dipendenze esterne (owner) — avviarle ORA
| Cosa | Serve per | Tempi tipici |
|---|---|---|
| Merge di C1 e C2 e rilascio | M0 | Giorni |
| Business Verification (fatta) + **App Review di Meta** per la messaggistica di Instagram e Messenger | M3 | Settimane |
| **Tech Provider** di Meta (Embedded Signup) | M2.4 | Settimane |
| **Accesso all'API di Google Business Profile** | R1 | Settimane |
| Server di backup (Hetzner o Backblaze) | M0.4 | Giorni |
| Chi usa ogni numero: Clientify o CRM (Lumii, Insiderslab Team) | Evitare doppie risposte | Decisione |

## 5. Rischi
- **Migrazione M1.2:** è il punto più delicato. Va fatta in due tempi, con prova su copia dei dati e ritorno indietro documentato.
- **Due bot sullo stesso numero** (Clientify e CRM): va deciso per ogni numero.
- **Tempi Meta:** non accorciabili. Per questo M3 parte solo ad approvazione arrivata.
- **Costi:** si misurano sui primi pacchetti, con la regola «costo per pacchetto chiuso».

## 6. Prima ondata proposta (al via dell'owner)
Tre pacchetti in parallelo:
1. **M0.2 (C3)**: Sonnet, poi verifica Opus.
2. **M0.3 (residui)**: Sonnet, poi verifica Opus.
3. **M1.1 (ADR del livello canali)**: Opus, da approvare.

Nel frattempo Haiku fa l'inventario per M1.2 e M1.3: dove si usano `wa_identity`, `wa_message_id` e `meta_credentials`.
