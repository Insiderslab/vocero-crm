# Materiale per l'App Review di Meta (pacchetto K7)

> Pacchetto K7 del piano `docs/piani/PIANO-CRM-MULTICANALE.md`. Valgono le Leggi di Heili (`docs/LEGGI-AI-CODING.md`). **Nessun segreto in questa cartella**: dove serve un dominio o un'utenza ci sono segnaposto tra `<...>`.

## Che cosa c'è

| File | Contenuto |
|---|---|
| `note-permessi.md` | Note di utilizzo per ogni permesso, in inglese, pronte da incollare nel modulo di revisione |
| `copioni-video.md` | Copioni dei video dimostrativi: WhatsApp, Instagram, Messenger |
| `checklist-tech-provider-embedded-signup-v4.md` | Checklist per diventare Tech Provider e per Embedded Signup v4 |
| `valori-pannello-meta.md` | Valori da inserire nel pannello Meta (URL pubblici, domini, webhook), con segnaposto di dominio |

Pagine pubbliche del CRM (non autenticate, in italiano, inglese e spagnolo; cambio lingua dal pulsante in alto):

| Pagina | Percorso |
|---|---|
| Informativa sulla privacy | `/privacy` |
| Termini del servizio | `/termini` |
| Cancellazione dei dati | `/cancellazione-dati` |

Il titolare e il contatto che compaiono nelle pagine si impostano con due variabili d'ambiente, **non segrete**: `LEGAL_ENTITY_NAME` e `LEGAL_CONTACT_EMAIL` (vedi `.env.example`). Finché non sono impostate le pagine mostrano i segnaposto `[LEGAL_ENTITY_NAME]` e `[LEGAL_CONTACT_EMAIL]`: **vanno impostate prima di inviare i link a Meta**, altrimenti il verificatore vede segnaposto.

## Stato onesto: che cosa si può già registrare e che cosa no

Il materiale descrive il comportamento **del prodotto che deve esistere al momento della revisione**. Oggi (10/10/2026):

| Canale | Collegamento nel CRM | Si può registrare il video? |
|---|---|---|
| WhatsApp | A mano (token e Phone Number ID incollati, `src/server/whatsapp/connect.ts`). **Embedded Signup non c'è**: è il pacchetto K2 | **No, non ancora.** Il video richiede Embedded Signup v4 reale |
| Instagram | Non c'è nel CRM (esiste in `heili-dm`). Pacchetto K3 | **No, non ancora** |
| Messenger | Non c'è. Pacchetto K4 | **No, non ancora** |

La skill `whatsapp-meta-app-review` fissa lo standard minimo: l'azienda collega **il proprio** account, l'app legge numero e modelli reali, invia un modello approvato, il dispositivo del destinatario mostra il messaggio. Un video fatto con Postman, log o dati finti viene respinto. Quindi: **non si invia la richiesta prima che K2, K3 e K4 siano reali**. I copioni sono pronti per quel momento; le parti che dipendono da funzioni non ancora costruite sono segnate **[DIPENDE DA K2/K3/K4]**.

## Che cosa serve all'owner (nessuno di questi passaggi lo fa un agente)

1. Impostare `LEGAL_ENTITY_NAME` e `LEGAL_CONTACT_EMAIL` sull'istanza di produzione e verificare che le tre pagine si aprano da una finestra anonima, via HTTPS, nelle tre lingue.
2. **Far rivedere i testi legali a un avvocato.** Sono bozze (vedi il registro `docs/lavoro/2026-10-10-app-review.md`).
3. Decidere il dominio pubblico definitivo e sostituire i segnaposto di `valori-pannello-meta.md`.
4. Confermare nel pannello Meta i nomi esatti dei permessi (la nomenclatura cambia: in ogni file c'è un blocco «da verificare nel pannello»).
5. Preparare utenza di prova, numero di prova e Pagina/account Instagram di prova (credenziali solo nel pannello Meta, mai nel repository).
6. Registrare i video quando K2, K3 e K4 sono reali.

## Regole di scrittura

- Le note e i video sono in **inglese** (la skill lo raccomanda per i revisori); i commenti operativi sono in italiano.
- Le note descrivono comportamento del prodotto, non «uso generico dell'API».
- Le note devono **coincidere con il video**: se si cambia uno, si cambia l'altro.
- Mai chiedere un permesso che il prodotto non usa.
