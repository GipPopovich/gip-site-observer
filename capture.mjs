import fs from 'node:fs/promises';
import path from 'node:path';
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

const browser = await chromium.launch({ headless: true });
const manifest = { generatedAt: new Date().toISOString(), sites: [] };

try {
  for (const site of config.sites ?? []) {
    const siteDir = path.join(root, slug(site.name || site.url));
    await fs.mkdir(siteDir, { recursive: true });

    const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const mobile = await browser.newContext({ ...devices['iPhone 13'] });
    const record = { name: site.name, requestedUrl: site.url };

    try {
      const page = await desktop.newPage();
      const started = Date.now();
      const response = await page.goto(site.url, {
        waitUntil: 'domcontentloaded',
        timeout: config.defaults?.timeoutMs ?? 45000
      });
      await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
      await page.waitForTimeout(config.defaults?.waitAfterLoadMs ?? 1500);

      const data = await page.evaluate(() => {
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

      record.finalUrl = page.url();
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

      const mobilePage = await mobile.newPage();
      await mobilePage.goto(site.url, { waitUntil: 'domcontentloaded', timeout: config.defaults?.timeoutMs ?? 45000 });
      await mobilePage.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
      await mobilePage.waitForTimeout(config.defaults?.waitAfterLoadMs ?? 1500);
      await mobilePage.screenshot({ path: path.join(siteDir, 'mobile.png'), fullPage: true });

      await fs.writeFile(path.join(siteDir, 'metadata.json'), JSON.stringify(record, null, 2));
      const report = `# ${record.title || site.name}\n\n- URL richiesta: ${site.url}\n- URL finale: ${record.finalUrl}\n- Stato HTTP: ${record.status}\n- Caricamento: ${record.loadMs} ms\n- Meta description: ${record.metaDescription || '(mancante)'}\n- Canonical: ${record.canonical || '(mancante)'}\n- H1: ${record.h1.join(' | ') || '(mancante)'}\n- H2: ${record.h2.join(' | ') || '(mancante)'}\n- Link: ${record.links.length}\n- Form: ${record.forms.length}\n- Immagini: ${record.images.length}\n- Immagini senza ALT: ${record.missingAltImages}\n`;
      await fs.writeFile(path.join(siteDir, 'report.md'), report);
      record.success = true;
    } catch (error) {
      record.success = false;
      record.error = error?.stack || String(error);
      await fs.writeFile(path.join(siteDir, 'error.txt'), record.error);
    } finally {
      await desktop.close();
      await mobile.close();
    }

    manifest.sites.push(record);
  }
} finally {
  await browser.close();
}

await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));
