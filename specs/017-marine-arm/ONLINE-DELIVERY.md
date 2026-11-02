# Consegna del pilota online â€” 2 novembre 2026

## Aggiornamento pannelli e calendario — 2 novembre 2026

La versione corrente è `20261102-panels-r1`, immagine `sha256:c2993abcfdbf446ac8b3f3b3527b6e2fba40d5e7adb98de6fe8be7b816937e12`. Sostituisce solo due file di interfaccia della precedente r5. Stesso URL e credenziali: l'amministratore parte da Resumen e può visitare sette pannelli. Calendario, riepilogo, operazioni e amministrazione sono funzionanti; ARM, agenzie e accessi hanno viste informative esplicitamente indicate come da completare. [Guida ai pannelli](PANNELLI.md).

Verifiche di questo aggiornamento: 48 test marine, TypeScript, lint dei file modificati, build, sette scenari browser sintetici e30controlli sul sito pubblico con account amministratore e membro. Zero scritture marine nella prova pubblica. Revisione indipendente del codice e successiva chiusura del controllo su risposte lente/fuori ordine/errori completate. Hair, gli altri servizi verificati e l'ambiente applicativo sono invariati; è stato ricreato soltanto il container app di Bambola. La prova Android fisica resta da svolgere. Il lint dell'intero repository segnala un errore preesistente in un operatore bootstrap, non incluso nella modifica.

Il calendario è limitato ai50tour restituiti dall'API e lo dichiara; non è lo storico completo. Restano tutti i limiti del pilota sintetico elencati sotto. Il precedente rapporto49HTTP/32browser descrive la r5, non una nuova esecuzione integrale su questa versione. Il cooldown antiabuso citato sotto è storico e terminato.


Disponibile: https://bambola.heili.cloud/nautica. Revisione indipendente finale24: PASS per prove con dati fittizi. Rosanni e tre operatori hanno accessi separati nella cartella locale protetta C:/Users/stefa/bambola-runtime/accessi. LEGGIMI.txt spiega quale singolo file consegnare a ciascuno; nessuna password Ã¨ pubblicata in questo documento o in chat.

Provati online:49controlliHTTP e32asserzioni browser mobile, comprendenti login/ruoli/logout, registrazione/QR, imbarco/fermata/rientro/sbarco, servizi, separazione tenant, bodycap e tentativi di spoofing IP. Migrazioni, ripetizione dell'avvio e backup/ripristino verificati. I test degli operatori erano automatici in Chromium, non su Android fisici. Guida del personale: PILOTO-ANDROID.md.

Hair e altri servizi rispettano la baseline. Il dominio Ã¨ stato aggiunto con una sola A TTL300 e18altreRRset invariate. HTTPS valido; Caddy conserva il prefisso originario e ha ricevuto solo il blocco Bambola. Immagineapp immutabile r5 sha256:cf918239b6e77893a1159c2bfcb30e9fe4fdc07826d6950502a5f85cb741b2fa; manifest79ea9b06f1c718b017b2cba81ca089a8a2facfd161b892a46b0e06d80c251838. CompatibilitÃ  operatori separata fc70a95, senza modifiche all'applicazione.

Il dependency audit resta FAILED (5critical,13high): le analisi e prove di raggiungibilitÃ  coprono soltanto questo pilota ristretto. Prima dell'uso reale: ruolo DB con privilegi minimi, prova dei telefoni e della comprensione del personale, capacitÃ  del registro pubblico con molte persone sulla stessa rete, formato e processo Capitaneria. Il limite pubblico attuale Ã¨60richieste/10minuti perIP; il precedente test locale da130passeggeri non prova la capacitÃ  pubblica condivisa. WhatsApp e pagamenti non sono collegati.

Gli attacchi sintetici finali hanno intenzionalmente saturato il limite del nostro IP di collaudo fino alla scadenza naturale della finestra (circa11:06ora italiana). Non Ã¨ stato riavviato il servizio per cancellare i contatori. Questo non equivale a indisponibilitÃ  generale; un altro IP ha un proprio contatore. I telefoni reali devono provare la camera e il codice manuale prima di qualsiasi utilizzo operativo.

La sola automazione notturna la-bambola-lavoro-notturno-e-revisione-finale Ã¨ stata eliminata dopo il completamento. Chat e altre automazioni non modificate. Le copie di consegna credenziali sono protette localmente; la copia server Ã¨ stata eliminata dopo verifica hash e test conclusi. Nessun messaggio inviato al personale.
