# Anomalia preesistente di app.heili.cloud — riscontro in sola lettura

3 novembre 2026. Due container, second-brain-web-1 e approve-web-1, dichiarano l'alias web sulla rete second-brain_frontend. La configurazione Caddy contiene reverse_proxy web:3000. La risposta pubblica app.heili.cloud alterna la pagina Heili con HTTP200 e la pagina Approve con HTTP307 verso/dashboard; le richieste anonime dirette ai rispettivi indirizzi interni riproducono i due risultati. Il dominio pubblico risolve al solo VPS186.241.16.46. Configurazione/container/reti restano invariati durante i riscontri.

Questo può inoltrare richieste all'applicazione sbagliata. Non è stata verificata né affermata una divulgazione effettiva di credenziali o dati. Sono state lette solo pagine anonime e metadati/configurazione selezionata; nessun segreto o contenuto cliente è stato letto. Nessuna modifica a Heili web, Approve, Hair, proxy condiviso o DNS.

Bambola è separata: upstream bambola-arm-gateway:8080, alias univoco e nessun alias web. Il rilascio Bambola non corregge il conflitto esterno. Una futura correzione nel progetto responsabile dovrebbe usare un nome di upstream univoco e avere il suo piano di verifica/ripristino; non è stata eseguita da questo lavoro.

Prove private: route-anomaly-diagnosis.jsonl, route-anomaly-root-cause.jsonl e route-anomaly-public-fingerprints.jsonl in C:/Users/stefa/bambola-runtime/crm-qa. I controlli di Bambola conservano tutte le vecchie evidenze e verificano solo le risposte effettivamente raccolte, senza aggiungere esiti artificiali.
