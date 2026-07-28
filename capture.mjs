import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const OBSERVER_VERSION = '1.0.1-preview-full-text-crawl';
const config = JSON.parse(await fs.readFile('sites.json', 'utf8'));
const startUrl = config.sites?.[0]?.url;
if (!startUrl) throw new Error('Missing start URL in sites.json');

const start = new URL(startUrl);
const maxPages = config.defaults?.maxPagesPerSite ?? 500;
const timeoutMs = config.defaults?.candidateTimeoutMs ?? 30000;
const waitAfterLoadMs = config.defaults?.waitAfterLoadMs ?? 700;
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const root = path.resolve('site-packs', stamp, 'futurvibe-preview-full-text-crawl');
const pagesDir = path.join(root, 'pages');
await fs.mkdir(pagesDir, { recursive: true });

const excludedPathPrefixes = [
  '/wp-admin', '/wp-login', '/wp-json', '/xmlrpc.php',
  '/cart', '/checkout', '/wp-content/', '/wp-includes/'
];
const excludedFragments = ['/feed/', '/comments/feed/', '/trackback/'];
const excludedExtensions = /\.(?:avif|bmp|css|csv|docx?|eot|gif|ico|jpe?g|js|json|map|mp3|mp4|mov|ogg|pdf|png|pptx?|rar|rss|svg|tar|tiff?|ttf|txt|wav|webm|webp|woff2?|xlsx?|xml|zip)$/i;

function normalizeUrl(raw) {
  try {
    const u = new URL(raw, startUrl);
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    if (u.hostname !== start.hostname) return null;
    u.protocol = 'https:';
    u.hash = '';
    u.search = '';
    let pathname = u.pathname.replace(/\/{2,}/g, '/');
    if (excludedPathPrefixes.some((prefix) => pathname.startsWith(prefix))) return null;
    if (excludedFragments.some((fragment) => pathname.includes(fragment))) return null;
    if (excludedExtensions.test(pathname)) return null;
    if (!pathname.endsWith('/')) pathname += '/';
    u.pathname = pathname;
    return u.toString();
  } catch {
    return null;
  }
}

function fileSlug(url, index) {
  const u = new URL(url);
  const body = decodeURIComponent(u.pathname)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 110) || 'home';
  return `${String(index).padStart(4, '0')}-${body}`;
}

const browser = await chromium.launch({
  headless: true,
  args: ['--disable-blink-features=AutomationControlled']
});
const context = await browser.newContext({
  viewport: { width: 1365, height: 900 },
  ignoreHTTPSErrors: true,
  locale: 'it-IT',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
});
const page = await context.newPage();

const queue = [normalizeUrl(startUrl)];
const queued = new Set(queue);
const visited = new Set();
const records = [];

while (queue.length && records.length < maxPages) {
  const url = queue.shift();
  if (!url || visited.has(url)) continue;
  visited.add(url);
  const index = records.length + 1;
  const record = {
    index,
    requestedUrl: url,
    checkedAt: new Date().toISOString(),
    success: false,
    status: null,
    finalUrl: null,
    title: '',
    metaDescription: '',
    canonical: '',
    robots: '',
    language: '',
    h1: [],
    h2: [],
    forms: 0,
    images: 0,
    missingAltImages: 0,
    internalLinksFound: 0,
    textLength: 0,
    error: null
  };

  try {
    let response = null;
    try {
      response = await page.goto(url, { waitUntil: 'commit', timeout: timeoutMs });
    } catch (navigationError) {
      record.error = navigationError?.message || String(navigationError);
    }
    await page.waitForTimeout(waitAfterLoadMs);
    await page.locator('body').waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});

    const data = await page.evaluate(() => {
      const texts = (selector) => [...document.querySelectorAll(selector)]
        .map((el) => el.textContent?.trim().replace(/\s+/g, ' '))
        .filter(Boolean);
      const attr = (selector, name) => document.querySelector(selector)?.getAttribute(name) ?? '';
      const links = [...document.querySelectorAll('a[href]')].map((a) => a.href);
      const images = [...document.querySelectorAll('img')].map((img) => ({
        src: img.currentSrc || img.src || '',
        alt: img.getAttribute('alt') ?? ''
      }));
      return {
        title: document.title || '',
        metaDescription: attr('meta[name="description"]', 'content'),
        canonical: attr('link[rel="canonical"]', 'href'),
        robots: attr('meta[name="robots"]', 'content'),
        language: document.documentElement.lang || '',
        h1: texts('h1'),
        h2: texts('h2'),
        visibleText: document.body?.innerText?.replace(/\n{3,}/g, '\n\n') ?? '',
        links,
        forms: document.querySelectorAll('form').length,
        images
      };
    });

    record.status = response?.status() ?? null;
    record.finalUrl = page.url();
    record.title = data.title;
    record.metaDescription = data.metaDescription;
    record.canonical = data.canonical;
    record.robots = data.robots;
    record.language = data.language;
    record.h1 = data.h1;
    record.h2 = data.h2;
    record.forms = data.forms;
    record.images = data.images.length;
    record.missingAltImages = data.images.filter((img) => !img.alt).length;
    record.textLength = data.visibleText.length;
    record.success = Boolean(data.visibleText.trim().length > 20 && page.url() !== 'about:blank' && (!record.status || record.status < 400));

    const internal = [...new Set(data.links.map(normalizeUrl).filter(Boolean))];
    record.internalLinksFound = internal.length;
    for (const link of internal) {
      if (!visited.has(link) && !queued.has(link) && queued.size < maxPages * 3) {
        queue.push(link);
        queued.add(link);
      }
    }

    const slug = fileSlug(url, index);
    await fs.writeFile(path.join(pagesDir, `${slug}.txt`), data.visibleText, 'utf8');
    await fs.writeFile(path.join(pagesDir, `${slug}.json`), JSON.stringify({ ...record, discoveredLinks: internal }, null, 2), 'utf8');
  } catch (error) {
    record.error = [record.error, error?.message || String(error)].filter(Boolean).join(' | ');
  }

  records.push(record);
  console.log(`[${index}/${maxPages}] ${record.success ? 'OK' : 'FAIL'} ${record.status ?? '-'} ${url}`);
}

await context.close();
await browser.close();

const summary = {
  observerVersion: OBSERVER_VERSION,
  generatedAt: new Date().toISOString(),
  startUrl,
  maxPages,
  queuedUniqueUrls: queued.size,
  visitedPages: records.length,
  successfulPages: records.filter((r) => r.success).length,
  failedPages: records.filter((r) => !r.success).length,
  statusCounts: records.reduce((acc, r) => {
    const key = String(r.status ?? 'UNKNOWN');
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {}),
  missingMetaDescriptionPages: records.filter((r) => !r.metaDescription).length,
  missingH1Pages: records.filter((r) => !r.h1.length).length,
  canonicalOnTemporaryHostPages: records.filter((r) => (r.canonical || '').includes(start.hostname)).length,
  totalTextCharacters: records.reduce((sum, r) => sum + r.textLength, 0),
  records
};

await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify(summary, null, 2), 'utf8');
const report = [
  '# FuturVibe Preview — Full Text Crawl',
  '',
  `- URL iniziale: ${startUrl}`,
  `- URL unici accodati: ${summary.queuedUniqueUrls}`,
  `- Pagine visitate: ${summary.visitedPages}`,
  `- Pagine riuscite: ${summary.successfulPages}`,
  `- Pagine fallite: ${summary.failedPages}`,
  `- Stati HTTP: ${JSON.stringify(summary.statusCounts)}`,
  `- Pagine senza meta description: ${summary.missingMetaDescriptionPages}`,
  `- Pagine senza H1: ${summary.missingH1Pages}`,
  `- Canonical ancora sul dominio temporaneo: ${summary.canonicalOnTemporaryHostPages}`,
  `- Caratteri di testo letti: ${summary.totalTextCharacters}`,
  '',
  '## Fallimenti',
  ...records.filter((r) => !r.success).map((r) => `- ${r.status ?? 'UNKNOWN'} — ${r.requestedUrl} — ${r.error ?? ''}`),
  ''
].join('\n');
await fs.writeFile(path.join(root, 'RUN_SUMMARY.md'), report, 'utf8');
console.log(JSON.stringify({ ...summary, records: undefined }, null, 2));
