import fs from 'node:fs/promises';
import path from 'node:path';
import dns from 'node:dns/promises';
import { chromium, devices } from 'playwright';

const config = JSON.parse(await fs.readFile('sites.json', 'utf8'));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const root = path.resolve('site-packs', stamp);
await fs.mkdir(root, { recursive: true });

const slug = (value) => value
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '') || 'site';

const unique = (items) => [...new Set(items.filter(Boolean))];
const manifest = { generatedAt: new Date().toISOString(), sites: [] };

async function inspect(page) {
  return page.evaluate(() => {
    const texts = (selector) => [...document.querySelectorAll(selector)]
      .map((el) => el.textContent?.trim().replace(/\s+/g, ' '))
      .filter(Boolean);
    const attr = (selector, name) => document.querySelector(selector)?.getAttribute(name) ?? '';
    const links = [...document.querySelectorAll('a[href]')].map((a) => ({
      text: a.textContent?.trim().replace(/\s+/g, ' ').slice(0, 180) ?? '',
      href: a.href
    }));
    const images = [...document.querySelectorAll('img')].map((img) => ({
      src: img.currentSrc || img.src || '',
      alt: img.getAttribute('alt') ?? '',
      width: img.naturalWidth || 0,
      height: img.naturalHeight || 0
    }));
    const forms = [...document.querySelectorAll('form')].map((form, index) => ({
      index: index + 1,
      action: form.action || '',
      method: (form.method || 'get').toUpperCase(),
      fields: [...form.querySelectorAll('input, select, textarea, button')].map((field) => ({
        tag: field.tagName.toLowerCase(),
        type: field.getAttribute('type') || '',
        name: field.getAttribute('name') || '',
        label: field.getAttribute('aria-label') || field.getAttribute('placeholder') || field.textContent?.trim().slice(0, 120) || ''
      }))
    }));
    return {
      title: document.title,
      metaDescription: attr('meta[name="description"]', 'content'),
      canonical: attr('link[rel="canonical"]', 'href'),
      language: document.documentElement.lang || '',
      h1: texts('h1'),
      h2: texts('h2'),
      visibleText: document.body?.innerText?.replace(/\n{3,}/g, '\n\n').slice(0, 100000) ?? '',
      html: document.documentElement.outerHTML,
      links,
      images,
      forms
    };
  });
}

for (const site of config.sites ?? []) {
  const requested = new URL(site.url);
  const siteDir = path.join(root, slug(site.name || requested.hostname));
  await fs.mkdir(siteDir, { recursive: true });

  const record = {
    name: site.name,
    requestedUrl: site.url,
    diagnostics: { ipv4: [], ipv6: [], attempts: [], requestFailures: [] }
  };

  try {
    record.diagnostics.ipv4 = await dns.resolve4(requested.hostname).catch(() => []);
    record.diagnostics.ipv6 = await dns.resolve6(requested.hostname).catch(() => []);

    const resolverRules = record.diagnostics.ipv4[0]
      ? `MAP ${requested.hostname} ${record.diagnostics.ipv4[0]},MAP www.${requested.hostname} ${record.diagnostics.ipv4[0]}`
      : null;

    const browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        ...(resolverRules ? [`--host-resolver-rules=${resolverRules}`] : [])
      ]
    });

    try {
      const desktop = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        ignoreHTTPSErrors: true,
        locale: 'it-IT',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
      });
      const page = await desktop.newPage();
      page.on('requestfailed', (request) => {
        if (record.diagnostics.requestFailures.length < 100) {
          record.diagnostics.requestFailures.push({
            url: request.url(),
            error: request.failure()?.errorText || 'UNKNOWN'
          });
        }
      });

      const candidates = unique([
        site.url,
        `https://www.${requested.hostname}/`,
        `http://${requested.hostname}/`,
        `http://www.${requested.hostname}/`
      ]);

      let response = null;
      let acceptedUrl = null;
      const started = Date.now();

      for (const candidate of candidates) {
        const attempt = { url: candidate, startedAt: new Date().toISOString() };
        try {
          response = await page.goto(candidate, { waitUntil: 'commit', timeout: 30000 });
          attempt.committed = true;
          attempt.status = response?.status() ?? null;
        } catch (error) {
          attempt.committed = false;
          attempt.error = error.message;
        }

        await page.waitForTimeout(6000).catch(() => {});
        attempt.finalUrl = page.url();
        attempt.title = await page.title().catch(() => '');
        attempt.bodyLength = await page.locator('body').innerText({ timeout: 3000 }).then((text) => text.length).catch(() => 0);
        record.diagnostics.attempts.push(attempt);

        if (page.url() !== 'about:blank' && (attempt.bodyLength > 20 || attempt.title)) {
          acceptedUrl = page.url();
          break;
        }
      }

      if (!acceptedUrl) {
        await page.screenshot({ path: path.join(siteDir, 'desktop-partial.png'), fullPage: true }).catch(() => {});
        throw new Error('Nessun tentativo ha prodotto una pagina HTML leggibile.');
      }

      await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(config.defaults?.waitAfterLoadMs ?? 1500);
      const data = await inspect(page);

      record.finalUrl = acceptedUrl;
      record.status = response?.status() ?? null;
      record.ok = response?.ok() ?? null;
      record.loadMs = Date.now() - started;
      record.title = data.title;
      record.metaDescription = data.metaDescription;
      record.canonical = data.canonical;
      record.language = data.language;
      record.h1 = data.h1;
      record.h2 = data.h2;
      record.links = data.links;
      record.images = data.images;
      record.forms = data.forms;
      record.missingAltImages = data.images.filter((img) => !img.alt).length;

      await page.screenshot({ path: path.join(siteDir, 'desktop.png'), fullPage: true });
      await fs.writeFile(path.join(siteDir, 'page.html'), data.html);
      await fs.writeFile(path.join(siteDir, 'visible-text.txt'), data.visibleText);

      const mobile = await browser.newContext({
        ...devices['iPhone 13'],
        ignoreHTTPSErrors: true,
        locale: 'it-IT'
      });
      const mobilePage = await mobile.newPage();
      await mobilePage.goto(acceptedUrl, { waitUntil: 'commit', timeout: 30000 }).catch(() => {});
      await mobilePage.waitForTimeout(7000);
      await mobilePage.screenshot({ path: path.join(siteDir, 'mobile.png'), fullPage: true });
      await mobile.close();
      await desktop.close();

      record.success = true;
      const report = `# ${record.title || site.name}\n\n- URL richiesta: ${site.url}\n- URL finale: ${record.finalUrl}\n- Stato HTTP: ${record.status ?? 'UNKNOWN'}\n- Caricamento: ${record.loadMs} ms\n- Meta description: ${record.metaDescription || '(mancante)'}\n- Canonical: ${record.canonical || '(mancante)'}\n- H1: ${record.h1.join(' | ') || '(mancante)'}\n- H2: ${record.h2.join(' | ') || '(mancante)'}\n- Link: ${record.links.length}\n- Form: ${record.forms.length}\n- Immagini: ${record.images.length}\n- Immagini senza ALT: ${record.missingAltImages}\n`;
      await fs.writeFile(path.join(siteDir, 'report.md'), report);
    } finally {
      await browser.close();
    }
  } catch (error) {
    record.success = false;
    record.error = error?.stack || String(error);
    await fs.writeFile(path.join(siteDir, 'error.txt'), record.error);
  }

  await fs.writeFile(path.join(siteDir, 'metadata.json'), JSON.stringify(record, null, 2));
  manifest.sites.push(record);
}

await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));
