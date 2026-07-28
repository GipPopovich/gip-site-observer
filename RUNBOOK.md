# Gip Site Observer — Runbook operativo

## Scopo

Garantire un canale indipendente dal browser della chat per osservare siti pubblici, conservare prove visive e tecniche e rendere l’analisi ripetibile.

## Fonte di verità

- Repository: `GipPopovich/gip-site-observer`
- Registro domini: `sites.json`
- Motore: `capture.mjs`
- Workflow: `.github/workflows/site-observer.yml`
- Output canonico: artifact `gip-site-packs`

## Procedura normale

1. Inserire il dominio in `sites.json` con nome e URL canonico.
2. Creare una pull request verso `main`.
3. Verificare che il job `observe` termini con successo.
4. Scaricare l’artifact.
5. Leggere prima `RUN_SUMMARY.md`, poi `manifest.json`.
6. Considerare un sito realmente visto soltanto se esistono almeno `metadata.json`, `desktop.png` e contenuto HTML o testo leggibile.
7. Unire la pull request solo dopo la verifica dell’artifact.

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
- La conferma richiede rilettura del manifest e ispezione di almeno uno screenshot.
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

Il canale è considerato operativo quando tre siti pubblici differenti producono nella stessa corsa output verificabili e il protocollo è registrato nella Memoria Madre.
