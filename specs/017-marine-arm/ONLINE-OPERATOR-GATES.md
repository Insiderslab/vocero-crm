# Operazioni e controlli del pilota Bambola

2 novembre 2026. Supplemento operativo alla review Claude19, non una deroga ai controlli. Solo VPS Ubuntu1899808 /186.241.16.46, nuovo root `/opt/bambola-arm`. Hair e gli altri servizi restano esclusi dalle modifiche.

## Ripristino manuale di una scrittura Caddy interrotta — finding M1

Prova già eseguita su contenitore dedicato `bambola-arm-caddy-rehearsal-r3`, con l'esatta immagine Caddy fissata, rete none e nessuna porta host. Provati: risposta iniziale, cambio reale della risposta dopo SIGUSR1, scrittura parziale simulata, ripristino dei byte completi, validazione, nuovo SIGUSR1, stesso inode/container/start/restart. Otto controlli passati; contenitore rimosso. Evidenza locale `C:/Users/stefa/bambola-runtime/evidence/caddy-rehearsal-r3.json` e remota `/opt/bambola-arm/evidence/caddy-rehearsal-r3/result.json`. Il proxy condiviso non è stato usato per questa prova.

Se una nostra scrittura del Caddyfile condiviso fallisce prima di completarsi:

1. Fermare le sole operazioni Bambola. Non riavviare il proxy o Hair. Conservare hash, inode e byte correnti come evidenza privata; verificare se è davvero una nostra scrittura parziale e se sono intervenuti altri writer. Se l'origine è incerta o ci sono modifiche concorrenti, non sovrascrivere: segnalare il conflitto.
2. Prima di `dns-intent`, il ripristino usa i byte verificati di `/opt/bambola-arm/evidence/Caddyfile.before`, con hash uguale al `base_hash` registrato. Dopo `dns-intent`, anche se il marker DNS manca, usare esclusivamente il candidato maintenance verificato, con prefisso originale integro e blocco Bambola503 senza upstream. Non eliminare il record DNS e non ripristinare l'intero originale dopo quel confine.
3. Validare il candidato di ripristino con la stessa immagine Caddy e il file di variabili selezionate già salvato per la validazione. Verificare nuovamente inode e assenza di cambiamenti concorrenti subito prima di scrivere. Scrivere i byte completi sul file esistente preservando l'inode del bind mount, fare flush/fsync, confrontare hash/byte e validare il file completo prima della ricarica.
4. Solo dopo conferma del file completo, inviare SIGUSR1 a `second-brain-caddy-1`. Controllare nuovamente tutte le rotte e identità/start/restart/health dei container preesistenti; dopo DNS, Bambola deve restituire503 con TLS valido. Registrare lo stato reale e non dichiarare ripristino riuscito solo perché il segnale è stato accettato.

La prova sul contenitore dedicato dimostra il meccanismo; non simula un ripristino eseguito in produzione. Le scritture condivise restano limitate all'unico blocco Bambola autorizzato.

## Approvazione operativa prima di activate — finding M2

Il coordinatore deve registrare in un file di evidenze privato la verifica dei seguenti punti, con riferimenti ai risultati effettivi. Un campo assente o un comando interrotto non equivale a PASS.

- Manifest e immagine corrispondenti allo snapshot esatto; correzioni successive riviste; revisione Claude disponibile con limiti espliciti.
- Nuovo database/runtime isolati e servizi sani; owner/admin/tre crew verificati con sessioni nuove; signup chiuso; nessun provider o worker collegato.
- Contenitori e reti verificati: nessuna porta app/DB pubblicata, nessun percorso gateway→DB, nessun accesso frontend→app/DB, spoofing da peer respinto, app nonroot e hardening gateway effettivo.
- Immagine finale e percorsi vulnerabili confrontati con la matrice dipendenze; nessun high/critical raggiungibile o dubbio irrisolto. Non chiamare verde l'audit del lockfile.
- Backup/ripristino nel solo DB sintetico verificato; prova M1 disponibile; stato di Hair e altre rotte coerente con la baseline del tentativo corrente.
- Indirizzo del proxy ricavato dall'identità reale di `second-brain-caddy-1`, non da un valore non verificato. DNS additivo con altre RRset intatte; intent e marker verificati; maintenance pubblica TLS503.

Dopo activate, prima di qualsiasi consegna al personale: eseguire prove esterne HTTPS di login/ruoli/logout, isolamento tenant, registrazione/QR/movimenti/servizi, header/allowlist/body cap/IP throttling e viewport mobile. Un fallimento essenziale mantiene la consegna bloccata e richiede il ritorno alla maintenance verificata, preservando Hair. Le prove che richiedono un percorso pubblico attivo non vengono falsamente dichiarate completate prima dell'attivazione.

## Credenziali, backup e limiti

Consegna soltanto del file account tramite SCP nella cartella locale con ACL riservata; nessuna chiave runtime e nessun segreto in chat. Verificare hash/permessi del file consegnato; eliminare la sola copia server per la consegna dopo tutti i test. Conservare il backup sintetico privato per la prova pilota; definire la conservazione, revocare/ruotare gli accessi di prova prima di un uso reale. Non ruotare autonomamente credenziali già consegnate. Android fisici, comprensione del personale e modello Capitaneria restano verifiche distinte.
