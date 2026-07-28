import fs from 'node:fs/promises';
import path from 'node:path';

const packsRoot = path.resolve('site-packs');
const entries = await fs.readdir(packsRoot, { withFileTypes: true });
const runDirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
const latest = runDirs.at(-1);

if (!latest) {
  throw new Error('Nessuna cartella di esecuzione trovata in site-packs.');
}

const runRoot = path.join(packsRoot, latest);
const manifestPath = path.join(runRoot, 'manifest.json');
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));

function classify(site) {
  const captureSuccess = site.success === true;
  const status = site.status;
  let accessState;

  if (!captureSuccess) accessState = 'UNREACHABLE';
  else if (status == null) accessState = 'VISIBLE_UNKNOWN_STATUS';
  else if (status >= 200 && status < 400) accessState = 'VISIBLE';
  else if (status === 401) accessState = 'AUTH_REQUIRED';
  else if (status === 403) accessState = 'BLOCKED';
  else if (status === 404) accessState = 'NOT_FOUND';
  else accessState = 'HTTP_ERROR';

  const visible = accessState === 'VISIBLE' || accessState === 'VISIBLE_UNKNOWN_STATUS';
  return {
    ...site,
    captureSuccess,
    accessState,
    visible,
    success: visible
  };
}

manifest.sites = manifest.sites.map(classify);
manifest.summary = {
  total: manifest.sites.length,
  captured: manifest.sites.filter((site) => site.captureSuccess).length,
  visible: manifest.sites.filter((site) => site.visible).length,
  blocked: manifest.sites.filter((site) => site.accessState === 'BLOCKED').length,
  notFound: manifest.sites.filter((site) => site.accessState === 'NOT_FOUND').length,
  authRequired: manifest.sites.filter((site) => site.accessState === 'AUTH_REQUIRED').length,
  httpError: manifest.sites.filter((site) => site.accessState === 'HTTP_ERROR').length,
  unreachable: manifest.sites.filter((site) => site.accessState === 'UNREACHABLE').length
};

await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

const summary = `# Gip Site Observer — Run Summary\n\n- Versione: ${manifest.observerVersion}\n- Siti totali: ${manifest.summary.total}\n- Pagine catturate: ${manifest.summary.captured}\n- Siti realmente visibili: ${manifest.summary.visible}\n- Bloccati 403: ${manifest.summary.blocked}\n- Pagina assente 404: ${manifest.summary.notFound}\n- Autenticazione richiesta: ${manifest.summary.authRequired}\n- Altri errori HTTP: ${manifest.summary.httpError}\n- Non raggiungibili: ${manifest.summary.unreachable}\n\n${manifest.sites.map((site) => `- ${site.accessState} — ${site.name}: ${site.finalUrl || site.requestedUrl}`).join('\n')}\n`;

await fs.writeFile(path.join(runRoot, 'RUN_SUMMARY.md'), summary);
console.log(summary);
