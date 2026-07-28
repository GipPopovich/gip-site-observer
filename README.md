# Gip Site Observer

Canale operativo stabile per permettere a Gip di vedere e verificare i siti web di Gigi anche quando il browser diretto della chat non è disponibile.

## Cosa produce

Per ogni sito configurato in `sites.json` il sistema prova HTTPS, WWW e HTTP, registra diagnostica DNS e di caricamento e salva:

- screenshot desktop completo;
- screenshot mobile completo;
- HTML della pagina;
- testo visibile;
- titolo, meta description, canonical, H1 e H2;
- link, form, immagini e ALT mancanti;
- errori di rete, console e pagina;
- `metadata.json`, `report.md`, `manifest.json` e riepilogo della corsa.

## Garanzia operativa

Il sistema copre i normali siti pubblici raggiungibili dai runner GitHub. Login, CAPTCHA, firewall, allowlist IP, staging privati o flussi complessi richiedono una configurazione dedicata.

## Uso ordinario

1. Aggiungere il dominio a `sites.json`.
2. Aprire una pull request oppure effettuare un push su `main`.
3. Attendere il workflow `Gip Site Observer`.
4. Scaricare l’artifact `gip-site-packs` e verificarne `RUN_SUMMARY.md` e `manifest.json`.

## Stato

Versione operativa blindata: `1.0.0`.
