# Consegna del pilota online — 2 novembre 2026

Disponibile: https://bambola.heili.cloud/nautica. Revisione indipendente finale24: PASS per prove con dati fittizi. Rosanni e tre operatori hanno accessi separati nella cartella locale protetta C:/Users/stefa/bambola-runtime/accessi. LEGGIMI.txt spiega quale singolo file consegnare a ciascuno; nessuna password è pubblicata in questo documento o in chat.

Provati online:49controlliHTTP e32asserzioni browser mobile, comprendenti login/ruoli/logout, registrazione/QR, imbarco/fermata/rientro/sbarco, servizi, separazione tenant, bodycap e tentativi di spoofing IP. Migrazioni, ripetizione dell'avvio e backup/ripristino verificati. I test degli operatori erano automatici in Chromium, non su Android fisici. Guida del personale: PILOTO-ANDROID.md.

Hair e altri servizi rispettano la baseline. Il dominio è stato aggiunto con una sola A TTL300 e18altreRRset invariate. HTTPS valido; Caddy conserva il prefisso originario e ha ricevuto solo il blocco Bambola. Immagineapp immutabile r5 sha256:cf918239b6e77893a1159c2bfcb30e9fe4fdc07826d6950502a5f85cb741b2fa; manifest79ea9b06f1c718b017b2cba81ca089a8a2facfd161b892a46b0e06d80c251838. Compatibilità operatori separata fc70a95, senza modifiche all'applicazione.

Il dependency audit resta FAILED (5critical,13high): le analisi e prove di raggiungibilità coprono soltanto questo pilota ristretto. Prima dell'uso reale: ruolo DB con privilegi minimi, prova dei telefoni e della comprensione del personale, capacità del registro pubblico con molte persone sulla stessa rete, formato e processo Capitaneria. Il limite pubblico attuale è60richieste/10minuti perIP; il precedente test locale da130passeggeri non prova la capacità pubblica condivisa. WhatsApp e pagamenti non sono collegati.

Gli attacchi sintetici finali hanno intenzionalmente saturato il limite del nostro IP di collaudo fino alla scadenza naturale della finestra (circa11:06ora italiana). Non è stato riavviato il servizio per cancellare i contatori. Questo non equivale a indisponibilità generale; un altro IP ha un proprio contatore. I telefoni reali devono provare la camera e il codice manuale prima di qualsiasi utilizzo operativo.

La sola automazione notturna la-bambola-lavoro-notturno-e-revisione-finale è stata eliminata dopo il completamento. Chat e altre automazioni non modificate. Le copie di consegna credenziali sono protette localmente; la copia server è stata eliminata dopo verifica hash e test conclusi. Nessun messaggio inviato al personale.
