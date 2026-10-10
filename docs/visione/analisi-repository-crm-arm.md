# Analisi dei repository open source per il CRM AI e l'ARM (AI Reputation Management) — 9/10/2026

> Stato: ricerca. Fonti: pagine dei progetti e articoli comparativi del 2025-2026. **Licenze e dati vanno verificati sul file LICENSE di ogni repository prima di usare codice.** Non è una consulenza legale.
> Collegato a `docs/visione/crm-multicanale-multicliente.md` e al principio di autoriciclo di Heili (moduli `heili.module.v1`, pacchetti di settore `heili.pack.v1`).

## 0. Cosa intendiamo per ARM
Il CRM gestisce l'acquisizione dei clienti e la **reputazione** del cliente finale, con moduli che si accendono o si spengono per ogni progetto (ristorazione, edilizia, agenzia). La reputazione ha tre fronti:
1. **Recensioni:** Google, TripAdvisor, Facebook, TheFork, Trustpilot. Monitoraggio, risposta assistita dall'AI, richiesta di recensioni ai clienti soddisfatti.
2. **Menzioni e social:** social listening (Reddit, notizie, social) e pubblicazione dei contenuti.
3. **Reputazione nelle risposte delle AI (GEO/AEO):** come ChatGPT, Gemini, Claude, Perplexity e gli AI Overviews di Google parlano del cliente e quali fonti citano.

## 1. Raccomandazione in breve
- **Non sostituire Vocero/Heili con un altro CRM.** Vocero ha già quello che nessun progetto open source ha insieme:
  - isolamento per organizzazione;
  - WhatsApp ufficiale;
  - agente AI con Laboratorio di prova;
  - campi liberi per settore (`ficha`);
  - chiavi per organizzazione.

  Il valore che lo distingue sono i **pacchetti di settore + AI + reputazione**, non il CRM di base.
- **Dai progetti open source prendiamo tre cose:**
  - **(a) l'architettura da imitare**, cioè le idee, senza copiare codice con licenza AGPL;
  - **(b) codice da riusare**, solo con licenza MIT o Apache;
  - **(c) servizi separati** collegati via API, quando la licenza non permette di incorporarli.

## 2. Mappa: bisogno → repository
| Bisogno | Repository | Licenza (da fonti, da verificare) | Come usarlo |
|---|---|---|---|
| **Inbox multicanale** (WhatsApp, Instagram, Messenger, email) | **Chatwoot** (Ruby on Rails) | MIT il nucleo; la cartella `/enterprise` è proprietaria | **Modello di riferimento per M1:** separa *canale* (integrazione), *inbox* (contenitore) e *conversazione*. Stack diverso dal nostro, quindi imitiamo l'architettura, non il codice. |
| Inbox e bot marketing (stile ManyChat) | ChatbotX | Community MIT, enterprise commerciale | Riferimento per i flussi «commento → DM» e per i canali social. Da valutare la maturità. |
| **CRM con oggetti personalizzati** per settore | **Twenty** (TypeScript/React, circa 45k stelle) | AGPL-3.0, enterprise proprietaria | **Solo studio:** il motore dei metadati (oggetti e campi personalizzati da interfaccia) è il modello giusto per i pacchetti di settore. Non copiare codice: l'AGPL obbligherebbe a pubblicare il nostro. |
| CRM leggero, interfaccia | Atomic CRM (marmelab; React, react-admin, Supabase) | Open source; licenza da verificare (probabilmente MIT) | Riferimento per le schermate di contatti, kanban e attività. Riuso del codice solo se è davvero MIT. |
| CRM Laravel | Krayin | MIT | Altro stack (PHP). Utile solo come riferimento. |
| **Architettura a plugin** (moduli che si accendono o spengono) | **erxes** (Nx, GraphQL Federation, micro-frontend) | AGPLv3 con plugin enterprise; la natura di vero software libero è contestata | **Solo studio:** `ENABLED_PLUGINS` sceglie quali moduli girano e il gateway li compone. È esattamente il nostro «modulo sì/no per progetto». Lo traduciamo nel contratto `heili.module.v1`. |
| **Acquisizione** (moduli, landing, lead scoring, campagne email) | Mautic (PHP) | GPL-3.0 | **Servizio separato**, collegato via API, se serve marketing automation completa. Il GPL non ha la clausola di rete, ma resta da verificare per la distribuzione. Pesante da gestire. |
| **Automazioni per progetto** | **Activepieces** | MIT il nucleo; enterprise proprietaria (white label, SSO) | **Si può incorporare.** I flussi per settore diventano «pezzi» attivabili. Ha agenti AI e supporto MCP. |
| Automazioni (alternativa) | n8n | Sustainable Use License | Va bene per **uso interno**. **Non incorporarlo** nel prodotto venduto senza una licenza commerciale. |
| **Recensioni Google con risposta AI** | **AutoReview** (DevvoLazza) | MIT | **Il miglior riferimento:** l'AI scrive bozze da una base di conoscenza approvata, ma **non ha le credenziali e non pubblica**. Pubblica una persona, con controllo di concorrenza. È coerente con le Leggi di Heili (Seconda Legge). |
| Recensioni (altri) | Google AI Review Responder, gbp-review-agent (server MCP), Review Intelligence Platform | Varie, progetti piccoli | Spunti: pubblicare o trattenere lo decide il codice, non il modello; instradamento dei reclami. |
| **Reputazione nelle risposte delle AI** | **Limelit Open** (Go, SQLite, MCP; con le chiavi del cliente) | Apache-2.0, versione preliminare | **Candidato da integrare** come servizio o modulo: traccia menzioni e citazioni in ChatGPT, Claude, Perplexity, Gemini e AI Overviews. |
| GEO (alternative) | OneGlanse (MIT), geo-aeo-tracker, Canonry | MIT o varie | OneGlanse legge le **interfacce web** dei prodotti AI (rischio di violare i termini d'uso). Preferire chi usa le API ufficiali. |
| Social listening | Radar (self-hosted, Claude) e pochi altri | Da verificare | Ecosistema open source **debole**. Meglio un modulo nostro semplice (notizie, Reddit, recensioni) o un fornitore a pagamento come fonte dati (Brand24, Mention). |
| Pubblicazione social | Postiz | AGPL-3.0 | Solo come **servizio separato e non modificato**, se serve. |
| WhatsApp | Evolution API (Baileys) | Apache-2.0, ma il connettore Baileys viola i termini di WhatsApp | **Da evitare:** rischio di ban permanente del numero. Restiamo sulla **Cloud API ufficiale** (come oggi con Wapi). |

## 3. Vincoli dei canali (da fonti, da verificare)
- **TikTok:** secondo fornitori terzi (settembre 2026), la Business Messaging API per i DM **non è disponibile per gli account aziendali di UE, Svizzera e Regno Unito**. Per ora TikTok entra solo come lead form o commenti, non come inbox.
- **Recensioni Google:** l'API di Google Business Profile richiede un'**approvazione di accesso**; fino ad allora le chiamate falliscono. Va chiesta subito, come la Business Verification di Meta.
- **Instagram e Messenger:** servono l'App Review di Meta e la verifica dell'azienda (vedi la scheda multicanale).

## 4. Come diventa modulare per progetto (proposta)
Ogni funzione è un **modulo** (`heili.module.v1`): dati, permessi, eventi, accesso AI, consumi. Ogni settore è un **pacchetto** (`heili.pack.v1`) che sceglie i moduli e li configura.

| Modulo | Ristorazione | Edilizia | Agenzia |
|---|---|---|---|
| Inbox WhatsApp | ✅ | ✅ | ✅ |
| Inbox Instagram e Messenger | ✅ | ◻️ | ✅ |
| Inbox email | ◻️ | ✅ | ✅ |
| Agente AI (qualifica lead) | ✅ prenotazioni ed eventi | ✅ preventivi e sopralluoghi | ✅ discovery call |
| Recensioni (monitoraggio e risposta) | ✅ Google, TripAdvisor, TheFork | ✅ Google | ✅ Google (+ Clutch?) |
| Richiesta di recensioni dopo il servizio | ✅ | ✅ a fine lavori | ✅ |
| Reputazione nelle AI (GEO) | ◻️ | ◻️ | ✅ (anche come servizio venduto) |
| Moduli e landing di acquisizione | ✅ | ✅ | ✅ |
| Campagne e follow-up | ✅ | ✅ | ✅ |
| Collegamento con Margin (commesse) | — | ✅ | — |
| Pubblicazione social | ◻️ | — | ✅ |

✅ attivo per default · ◻️ attivabile · — non previsto

## 5. Prossimi passi proposti
1. **Ora (fase S):** nessun nuovo modulo. Finire l'isolamento tra clienti (C1, C2, C3).
2. **Dipendenze esterne da avviare subito**, tutte a carico dell'owner:
   - Business Verification e App Review di Meta;
   - accesso all'API di Google Business Profile;
   - verifica su TripAdvisor e TheFork se serve la ristorazione.
3. **M1, livello canali:** imitare il modello canale → inbox → conversazione di Chatwoot.
4. **Primo modulo ARM: «Recensioni Google»**, sul modello di AutoReview:
   - l'AI scrive solo bozze e una persona pubblica;
   - le credenziali restano fuori dalla portata dell'AI;
   - test di isolamento tra organizzazioni.
5. **Secondo modulo ARM: «Reputazione nelle AI»**, integrando Limelit Open come servizio (Apache-2.0), da valutare quando esce dalla versione preliminare.
6. **Automazioni per settore:** prova di Activepieces incorporato (MIT), con un flusso per pacchetto.

## 6. Clientify come banco di prova (non open source)
Clientify è un SaaS chiuso: **il suo codice sorgente non è stato scansionato**. Il 5/10/2026, nella sessione «CRM con automazione WhatsApp», è stato analizzato tramite il connettore l'**account Clientify dell'agenzia**: capacità e dati, in sola lettura. Il resoconto è nel repo `Insiderslab/Insiderslab`, branch `claude/exciting-rubin-mow1yu`, cartella `crm-whatsapp/` (`ANALISI-STATO-2026-10-05.md` e `ANALISI-COMPLETA-2026-10-09.md`).

**Fatti emersi:**
- Modulo Comunicazioni con **1 canale WhatsApp Web** attivo, 788 contatti, 3 pipeline, automazione «Nuevo Lead» pubblicata.
- L'addon «API KEY Advanced» **non è attivo**, quindi la Team Inbox non è automatizzabile via API.
- Clientify ha il **controllo completo dei WABA di Lumii e di Insiderslab Team**: rischio di due bot sullo stesso numero. Per ogni numero va scritto chi lo usa.
- Esiste un export dei contatti (`clientify_contatti_28_08_2026.xls` su Drive), utile per la migrazione verso il nostro CRM.
- Su Drive c'è un contratto partner con Clientify (Condiciones Especiales Contrato Partner). **Da rileggere** prima di vendere un prodotto concorrente.

**Mappa delle funzioni**, ricavata dalle funzioni del connettore Clientify, confrontata con il nostro CRM:

| Funzione Clientify | Nel nostro CRM (vocero-crm) | Nota |
|---|---|---|
| Contatti, aziende, opportunità, pipeline, tag, campi personalizzati, segmenti, liste | ✅ contatti, pipeline, lead, tag, `ficha` libera | Mancano aziende (B2B) e segmenti/liste |
| Inbox multicanale | 🟡 solo WhatsApp | Livello canali M1 (scheda multicanale) |
| Agente AI con base di conoscenza, strumenti, scopo, anteprima | ✅ agente, KB, **Laboratorio con casi di test** | Il nostro è più avanzato sulla verifica |
| Automazioni (trigger e passi) | ✅ automazioni | Valutare Activepieces per i flussi per settore |
| Modelli email e campagne, liste marketing | ❌ | Modulo «Campagne» (o Mautic come servizio) |
| Landing page e moduli | ❌ | Modulo «Acquisizione» (endpoint dei form del sito già richiesto) |
| Lead scoring | ❌ | Modulo semplice, regole nel pacchetto di settore |
| Buyer persona, brand kit, identità aziendale | ❌ | Dati del pacchetto e del cliente (vanno anche nel Core) |
| Preventivi, proposte, prodotti, firma elettronica | ❌ | Collegare preventivatore e listino, più Heili Legal per i contratti |
| Riunioni e notetaker (riassunti da modelli) | ❌ | **Heili Meetings** (scheda nel Core) |
| Prospector (ricerca e arricchimento di aziende e persone) | ❌ | Valutare fonti dati a pagamento; attenzione al GDPR |
| Chiamate | ❌ | Fuori dal primo rilascio |
| Cruscotto e metriche | 🟡 | Report per il cliente (manca, vedi analisi 9/10) |
| **Reputazione: recensioni, menzioni, visibilità nelle AI** | ❌ | **Non è nel connettore Clientify**: è il nostro elemento distintivo (ARM) |

**Lettura:**
- Clientify copre bene vendite e marketing classici. Il nostro CRM è già più forte su WhatsApp e sull'agente AI verificato.
- Lo spazio libero è la **reputazione (ARM) unita ai pacchetti di settore**.
- I moduli che mancano rispetto a Clientify (campagne, landing, scoring, preventivi, riunioni) diventano moduli attivabili per pacchetto, non funzioni fisse.

## Fonti
- Chatwoot: https://github.com/chatwoot/chatwoot · https://www.chatwoot.com/docs/product/others/enterprise-edition/
- Twenty: https://marmelab.com/blog/2026/01/09/open-source-crm-benchmark-2026.html · https://ideaproof.io/open-source/project/twenty
- Atomic CRM: https://supabase.com/partners/atomic_crm · https://gittrend.io/repo/marmelab/atomic-crm
- CRM a confronto: https://webkul.com/blog/best-open-source-crm-software/ · https://www.getmunin.com/en/journal/best-open-source-crm/
- erxes: https://erxes.io/docs · https://erxes.io/blog/posts/changing-the-license-to-agplv3-with-the-enterprise-edition · https://isitreallyfoss.com/projects/erxes
- Activepieces / n8n: https://automationatlas.io/guides/n8n-vs-activepieces-2026-comparison/ · https://blog.elest.io/n8n-vs-activepieces-which-self-hosted-automation-platform-in-2026/
- Mautic / Postiz: https://www.opentechhub.io/mautic/ · https://cdn.jsdelivr.net/gh/gitroomhq/postiz-app@main/README.md
- Recensioni: https://github.com/DevvoLazza/AutoReview · https://github.com/TuanPhan17/Google-Ai-Review-Responder · https://github.com/satheeshds/gbp-review-agent · https://github.com/binesheb/google-review-autoreply
- GEO: https://github.com/limelitgeo/open · https://www.producthunt.com/products/oneglanse · https://github.com/danishashko/geo-aeo-tracker · https://github.com/topics/ai-visibility
- Social listening: https://www.producthunt.com/products/github-439 · https://dupple.com/learn/best-social-listening-tools
- ChatbotX: https://github.com/ChatbotXIO/ChatbotX
- TikTok: https://help.sleekflow.io/en_US/tiktok-business-messaging/connecting-tiktok-business-messaging-to-sleekflow · https://respond.io/help/tiktok/tiktok-overview
- WhatsApp non ufficiale: https://pasqualepillitteri.it/news/12968/integrare-whatsapp-evolution-api-cloud-api-meta · https://help.chatdaddy.tech/article/ban-type-distribution
