# Rilascio — pagine pubbliche e materiale App Review (K7)

**Per chi:** l'owner (unico autorizzato ad agire in produzione, Legge Zero). Nessun agente esegue questi passi. Non ci sono segreti in questo documento: le variabili sotto non sono segrete.
**Riferimenti:** `docs/meta/app-review/README.md`, `docs/lavoro/2026-10-10-app-review.md`, `src/lib/legal.ts`.

## Variabili d'ambiente (nessuna migrazione, schema invariato)

| Variabile | Effetto |
|---|---|
| `LEGAL_ENTITY_NAME`, `LEGAL_CONTACT_EMAIL` | Titolare e contatto mostrati nelle pagine. Se mancano compaiono `[LEGAL_ENTITY_NAME]` / `[LEGAL_CONTACT_EMAIL]`. |
| `LEGAL_TEXTS_REVIEWED` | **Non impostarla al primo rilascio.** Finché non vale esattamente `true`, `/privacy`, `/termini` e `/cancellazione-dati` mostrano l'avviso «Documento in revisione legale» e la data con «bozza». |

## Passi

1. Rilasciare il codice con `LEGAL_ENTITY_NAME` e `LEGAL_CONTACT_EMAIL` impostate e **`LEGAL_TEXTS_REVIEWED` assente**: le pagine sono raggiungibili ma dichiarate bozza.
2. Verificare da una finestra anonima, via HTTPS: le tre pagine rispondono 200 senza accesso, con l'avviso visibile. Con un browser in inglese (o `Accept-Language: en`) le pagine sono in inglese; con cookie `heili-locale` vale il cookie.
3. Far rivedere i testi a un avvocato (punti da verificare nel registro `docs/lavoro/2026-10-10-app-review.md`).
4. **Dopo la revisione legale** (e le eventuali modifiche ai testi, con `LEGAL_LAST_UPDATED` aggiornata in `src/lib/legal.ts`): impostare `LEGAL_TEXTS_REVIEWED=true` e riavviare. L'avviso e la dicitura «bozza» spariscono.
5. Solo allora inviare i link a Meta. Prima ancora, K2/K3/K4 devono essere reali (Embedded Signup, Instagram, Messenger): finché non lo sono, testi e note dicono «in arrivo» e la revisione non si invia.

## Ritorno indietro

Rimuovere `LEGAL_TEXTS_REVIEWED` (o impostarla a un valore diverso da `true`): le pagine tornano a mostrare l'avviso di bozza.
