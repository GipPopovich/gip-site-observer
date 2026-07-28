# Gip Site Observer — Runbook operativo

## Scopo

Garantire un canale indipendente dal browser della chat per osservare siti pubblici, conservare prove visive e tecniche e rendere l’analisi ripetibile.

## Fonte di verità

- Repository: `GipPopovich/gip-site-observer`
- Registro domini: `sites.json`
- Motore: `capture.mjs`
- Classificatore: `classify.mjs`
- Workflow: `.github/workflows/site-observer.yml`
- Output canonico: artifact `gip-site-packs`

## Procedura normale

1. Inserire il dominio in `sites.json` con nome e URL canonico.
2. Creare una pull request verso `main`.
3. Verificare che il job `observe` termini.
4. Scaricare l’artifact.
5. Leggere prima `RUN_SUMMARY.md`, poi `manifest.json`.
6. Ispezionare almeno uno screenshot prima di dichiarare il sito visto.
7. Unire la pull request solo dopo la verifica dell’artifact.

## Stati canonici

- `VISIBLE`: sito raggiungibile e pagina effettivamente visibile.
- `VISIBLE_UNKNOWN_STATUS`: pagina leggibile senza status HTTP disponibile.
- `AUTH_REQUIRED`: il server richiede autenticazione.
- `BLOCKED`: risposta 403; il dominio risponde ma nega l’accesso al runner.
- `NOT_FOUND`: risposta 404; il dominio risponde ma quella pagina non esiste.
- `HTTP_ERROR`: altro errore HTTP.
- `UNREACHABLE`: nessun tentativo produce una pagina HTML leggibile.

Una pagina catturata non equivale automaticamente a un sito visibile. `captureSuccess` prova che è stato acquisito un output; `visible` prova che la pagina reale è accessibile.

## Recupero automatico

Il motore prova in sequenza:

- URL richiesto;
- HTTPS con `www`;
- HTTP senza `www`;
- HTTP con `www`.

Registra DNS IPv4/IPv6, redirect, status HTTP, richieste fallite, errori JavaScript e tentativi effettuati. Se nessun tentativo produce HTML leggibile, salva comunque diagnostica, eventuale screenshot parziale e `error.txt`.

## Regole di verità

- Workflow verde non equivale automaticamente a sito visto.
- Artifact presente non equivale automaticamente a sito visto.
- HTTP 403 o 404 non viene registrato come sito visibile.
- La conferma richiede rilettura del manifest e ispezione dello screenshot.
- Non dichiarare accesso a login, CAPTCHA o aree private senza una prova specifica.
- Non inserire password, cookie o token direttamente nel repository.

## Siti protetti

Per login, staging privato, CAPTCHA, firewall o allowlist IP usare una missione separata. Eventuali credenziali devono stare in GitHub Secrets e non nei file del repository o nei report.

## Ripristino

Se il workflow smette di funzionare:

1. controllare permessi del ChatGPT Codex Connector;
2. verificare che GitHub Actions sia abilitato;
3. rilanciare da `workflow_dispatch`;
4. leggere log e artifact anche in caso di errore;
5. correggere in un ramo dedicato;
6. eseguire almeno un test pubblico prima del merge.

## Criterio di blindatura

Il canale è considerato operativo quando, nella stessa corsa, produce una pagina reale `VISIBLE`, distingue correttamente almeno due condizioni negative tra `BLOCKED`, `NOT_FOUND` e `UNREACHABLE`, conserva artifact verificabili e il protocollo è registrato nella Memoria Madre.
