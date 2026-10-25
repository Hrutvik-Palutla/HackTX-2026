import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import type { ResearchAction, ResearchPort, ResearchPageEvidence, ResearchSearchEvidence } from '../../contracts/src/index.ts';
import type { SerpApiClient } from './serpapi.ts';

type Row = Record<string, unknown>;
type BrowserRequest = { redirectedFrom(): BrowserRequest | null; method(): string; url(): string; headers(): Record<string, string>; resourceType(): string };
type BrowserRoute = { request(): BrowserRequest; abort(): Promise<void>; continue(): Promise<void>; fulfill(options: { status: number; contentType: string; body: string }): Promise<void> };
type BrowserResponse = { headers(): Record<string, string>; body(): Promise<Uint8Array> };
type BrowserContext = { newPage(): Promise<Record<string, (...args: any[]) => any>> };
type ResearchBrowser = { close(): Promise<void>; newContext(options: unknown): Promise<BrowserContext> };
const MAX_TEXT = 40_000;
const MAX_REDIRECTS = 5;
const MAX_RESPONSE = 2_000_000;
function record(value: unknown): value is Row { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function text(value: unknown): string { return typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').slice(0, MAX_TEXT) : ''; }
function hash(value: string): string { return createHash('sha256').update(value).digest('hex').slice(0, 24); }
function sanitized(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[truncated]';
  if (typeof value === 'string') return value.replace(/([?&]api_key=)[^&\s]+/gi, '$1[redacted]').replace(/(["']?(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|secret)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, '$1[redacted]').slice(0, 20_000);
  if (Array.isArray(value)) return value.slice(0, 100).map(item => sanitized(item, depth + 1));
  if (record(value)) return Object.fromEntries(Object.entries(value).filter(([key]) => !/^(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|secret)$/i.test(key)).slice(0, 200).map(([key, item]) => [key, sanitized(item, depth + 1)]));
  return value;
}
function checkedActions(input: ResearchAction[] | undefined): ResearchAction[] {
  const actions = input ?? [];
  if (actions.length > 4) throw new TypeError('At most four page actions are allowed');
  return actions.map(action => {
    if (!action || (action.kind !== 'click' && action.kind !== 'select') || typeof action.label !== 'string') throw new TypeError('Invalid page action');
    const label = action.label.trim();
    if (!label || label.length > 100 || /\b(check[\s-]?out|pay(?:ment)?|buy|purchase|order|reserve|login|sign[\s-]?in|account|submit|confirm)\b|\bbook(?:ing)?\s+(?:tickets?|seats?|now)\b/i.test(label)) throw new TypeError('Page action label is not allowed');
    if (action.kind === 'select' && (typeof action.value !== 'string' || !action.value.trim() || action.value.length > 100)) throw new TypeError('Select actions need a bounded value');
    if (action.kind === 'click' && action.value !== undefined) throw new TypeError('Click actions do not accept a value');
    return { kind: action.kind, label, ...(action.value === undefined ? {} : { value: action.value }) };
  });
}
function isTransactionalPath(url: URL): boolean {
  return /\/(?:checkout|cart|payment|pay|purchase|order|login|sign[\s_-]?in|account|confirm)(?:\/|$)/i.test(url.pathname);
}
function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const p = address.split('.').map(Number);
    return !(p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && ((p[1] === 0 && p[2] === 0) || p[1] === 2 || p[1] === 168)) || (p[0] === 198 && (p[1] === 18 || p[1] === 19 || (p[1] === 51 && p[2] === 100))) || (p[0] === 203 && p[1] === 0 && p[2] === 113) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127));
  }
  if (isIP(address) === 6) {
    const a = address.toLowerCase();
    return !(a === '::' || a === '::1' || a.startsWith('fc') || a.startsWith('fd') || a.startsWith('fe8') || a.startsWith('fe9') || a.startsWith('fea') || a.startsWith('feb') || a.startsWith('ff') || a.startsWith('::ffff:') || a.startsWith('2001:db8:') || a.startsWith('100:'));
  }
  return false;
}
type Address = { address: string };
type Resolver = (hostname: string) => Promise<Address[]>;
async function checkedUrl(raw: string, resolver: Resolver = hostname => lookup(hostname, { all: true, verbatim: true })) : Promise<URL> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new TypeError('A public http or https URL is required'); }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && url.port !== (url.protocol === 'https:' ? '443' : '80')) || !host.includes('.') || ['localhost', 'local', 'internal', 'test', 'example', 'invalid', 'home', 'lan', 'corp', 'arpa'].some(s => host === s || host.endsWith(`.${s}`))) throw new TypeError('A public http or https URL is required');
  const addresses = isIP(host) ? [{ address: host }] : await resolver(host);
  if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) throw new TypeError('The URL must resolve only to public IP addresses');
  return url;
}

export class SerpApiResearch implements ResearchPort {
  private readonly client: SerpApiClient;
  private readonly options: { timeoutMs?: number; maxPageBytes?: number; resolveHost?: Resolver; fixtureHtml?: { url: string; html: string } };
  constructor(client: SerpApiClient, options: { timeoutMs?: number; maxPageBytes?: number; resolveHost?: Resolver; fixtureHtml?: { url: string; html: string } } = {}) { this.client = client; this.options = options; }
  async search(input: { query: string; engine?: string; params?: Record<string, string> }): Promise<ResearchSearchEvidence> {
    const query = input.query.trim().slice(0, 300);
    if (!query) throw new TypeError('Research query is required');
    const engine = (input.engine ?? 'google').trim();
    if (!/^[a-z][a-z0-9_]{0,63}$/i.test(engine) || ['extract'].includes(engine.toLowerCase())) throw new TypeError('A valid SerpApi search engine is required');
    const params = input.params ?? {};
    const entries = Object.entries(params);
    if (entries.length > 20 || entries.some(([key, value]) => !/^[a-z][a-z0-9_]{0,63}$/i.test(key) || ['api_key', 'engine', 'q'].includes(key.toLowerCase()) || typeof value !== 'string' || value.length > 500)) throw new TypeError('SerpApi parameters are invalid or exceed limits');
    const { body, fetchedAt } = await this.client.searchWithMetadata({ engine, ...Object.fromEntries(entries), q: query, hl: params.hl ?? 'en' });
    const url = engine === 'google_maps' ? `https://www.google.com/maps/search/${encodeURIComponent(query)}` : `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    const lines: string[] = [];
    for (const row of Array.isArray(body.organic_results) ? body.organic_results.slice(0, 20) : []) if (record(row)) lines.push([row.title, row.snippet, row.link].filter(x => typeof x === 'string').join(' — '));
    for (const key of ['events_results', 'local_results']) for (const row of Array.isArray(body[key]) ? (body[key] as unknown[]).slice(0, 20) : []) if (record(row)) lines.push([row.title, row.date, row.address, row.description, row.link].filter(x => typeof x === 'string').join(' — '));
    return { sourceId: `research_${hash(`${url}|${fetchedAt}`)}`, url, fetchedAt, engine, query, text: text(lines.join('\n')), results: sanitized(body) as Row };
  }
  async read(input: { url: string; render?: boolean; actions?: ResearchAction[] }): Promise<ResearchPageEvidence> {
    const actions = checkedActions(input.actions);
    let url = await checkedUrl(input.url, this.options.resolveHost);
    if (isTransactionalPath(url)) throw new TypeError('Transactional pages cannot be read');
    let pageText = '';
    let title: string | null = null;
    let fetchedAt = new Date().toISOString();
    let links: Array<{ text: string; url: string }> = [];
    let structuredDataText: string[] = [];
    if (!input.render) {
      try {
        const extracted = await this.client.searchWithMetadata({ engine: 'extract', url: url.href, mode: 'scrape', include_markdown: 'true' });
        const content = record(extracted.body.text_content) ? extracted.body.text_content : {};
        pageText = [text(content.full), text(content.markdown)].filter(Boolean).join('\n\n');
        title = typeof extracted.body.title === 'string' ? text(extracted.body.title).slice(0, 300) : null;
        fetchedAt = extracted.fetchedAt;
      } catch (error) {
        if (error instanceof Error && /request limit reached/i.test(error.message)) throw error;
        // Extract can fail for public pages; use the read-only browser path as a fallback.
      }
    }
    if (input.render || actions.length || !pageText.trim()) {
      const rendered = await this.render(url.href, actions);
      url = await checkedUrl(rendered.url, this.options.resolveHost);
      pageText = rendered.text;
      title = rendered.title;
      links = rendered.links;
      structuredDataText = rendered.structuredDataText;
      fetchedAt = new Date().toISOString();
    }
    if (!pageText.trim()) throw new Error('The page did not provide readable text');
    const linkText = links.map(link => `Link: ${link.text} — ${link.url}`).join('\n');
    const jsonLdText = structuredDataText.map((item, index) => `Structured data ${index + 1}: ${item}`).join('\n');
    return { sourceId: `research_${hash(`${url.href}|${fetchedAt}`)}`, url: url.href, fetchedAt, text: [pageText, linkText, jsonLdText].filter(Boolean).join('\n\n').slice(0, MAX_TEXT), title, links, structuredDataText };
  }
  private async render(initialUrl: string, actions: ResearchAction[]): Promise<{ url: string; text: string; title: string | null; links: Array<{ text: string; url: string }>; structuredDataText: string[] }> {
    const timeout = Math.min(20_000, this.options.timeoutMs ?? 15_000);
    const maxBytes = this.options.maxPageBytes ?? MAX_RESPONSE;
    let browser: ResearchBrowser | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const require = createRequire(new URL('../../../apps/booking-worker/package.json', import.meta.url));
      const { chromium } = require('playwright') as { chromium: { launch(options: unknown): Promise<any> } };
      const task = (async () => {
        // Docker's 64 MB /dev/shm crashes Chromium on heavier pages ("browser has been closed") without this flag.
        const activeBrowser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'], timeout }) as ResearchBrowser;
        browser = activeBrowser;
        const context = await activeBrowser.newContext({ javaScriptEnabled: true, acceptDownloads: false });
        const page = await context.newPage();
        page.setDefaultNavigationTimeout(timeout);
        page.setDefaultTimeout(timeout);
        let received = 0;
        let requestCount = 0;
        let overflow = false;
        const responseJobs: Promise<void>[] = [];
        await page.route('**/*', async (route: BrowserRoute) => {
          const request = route.request();
          try {
            requestCount++;
            let redirectDepth = 0;
            for (let prior = request.redirectedFrom(); prior; prior = prior.redirectedFrom()) redirectDepth++;
            // Text is all we read: images, video and fonts only spend the byte budget.
            if (overflow || ['image', 'media', 'font'].includes(request.resourceType())) return await route.abort();
            if (requestCount > 50 || redirectDepth > MAX_REDIRECTS || request.method() !== 'GET') return await route.abort();
            const next = await checkedUrl(request.url(), this.options.resolveHost);
            if (!['http:', 'https:'].includes(next.protocol) || isTransactionalPath(next)) return await route.abort();
            if (this.options.fixtureHtml?.url === next.href) {
              const body = this.options.fixtureHtml.html;
              const byteLength = Buffer.byteLength(body);
              if (received + byteLength > maxBytes) return await route.abort();
              return await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
            }
            const expectedLength = Number(request.headers()['content-length'] ?? 0);
            if (expectedLength > 0 && received + expectedLength > maxBytes) return await route.abort();
            await route.continue();
          } catch { await route.abort(); }
        });
        page.on('response', (response: BrowserResponse) => {
          const job = (async () => {
            const length = Number(response.headers()['content-length'] ?? 0);
            if (length > 0) received += length;
            else received += (await response.body()).byteLength;
            // Stop loading more, but keep reading what arrived; closing the browser here broke every later page call.
            if (received > maxBytes && !overflow) { overflow = true; await page.evaluate(() => window.stop()).catch(() => undefined); }
          })();
          responseJobs.push(job.catch(() => undefined));
        });
        await page.goto(initialUrl, { waitUntil: 'domcontentloaded', timeout });
        // Give client rendered apps a short chance to finish their network activity, then poll for stable body text.
        await page.waitForLoadState('networkidle', { timeout: Math.min(2_500, timeout) }).catch(() => undefined);
        for (const action of actions) {
          if (action.kind === 'select') {
            await page.getByLabel(action.label, { exact: true }).selectOption(action.value!, { timeout });
          } else {
            const button = page.getByRole('button', { name: action.label, exact: true });
            const link = page.getByRole('link', { name: action.label, exact: true });
            if (await button.count()) await button.first().click({ timeout });
            else if (await link.count()) await link.first().click({ timeout });
            else throw new Error('No button or link matched the requested accessible label');
          }
          await page.waitForLoadState('networkidle', { timeout: Math.min(2_000, timeout) }).catch(() => undefined);
        }
        let lastText = '';
        let stable = 0;
        let result = { title: '', text: '', links: [] as Array<{ text: string; href: string }>, structuredDataText: [] as string[] };
        const settleDeadline = Date.now() + Math.min(3_000, timeout);
        while (Date.now() < settleDeadline && stable < 3) {
          result = await page.evaluate(() => ({
            title: document.title,
            text: document.body?.innerText ?? '',
            links: Array.from(document.querySelectorAll('a[href]')).slice(0, 30).map(anchor => ({ text: anchor.textContent?.trim() ?? '', href: (anchor as HTMLAnchorElement).href })),
            structuredDataText: Array.from(document.querySelectorAll('script[type="application/ld+json"]')).slice(0, 10).map(script => script.textContent?.slice(0, 4_000) ?? '').filter(Boolean),
          }));
          const current = text(result.text);
          stable = current.trim() && current === lastText ? stable + 1 : 0;
          lastText = current;
          if (stable < 3) await new Promise(resolve => setTimeout(resolve, 200));
        }
        await Promise.all(responseJobs);
        if (!lastText.trim() && overflow) throw new Error(`Rendered page exceeded the ${maxBytes} byte limit before any text loaded`);
        const final = await checkedUrl(page.url(), this.options.resolveHost);
        const links: Array<{ text: string; url: string }> = [];
        for (const link of result.links) {
          try {
            const safe = await checkedUrl(link.href, this.options.resolveHost);
            if (links.some(existing => existing.url === safe.href)) continue;
            links.push({ text: text(link.text).slice(0, 300), url: safe.href });
          } catch { /* Drop links that are not public http(s) destinations. */ }
        }
        return { url: final.href, title: text(result.title).slice(0, 300) || null, text: lastText, links, structuredDataText: result.structuredDataText };
      })();
      // Launch has its own timeout; the page gets the full read budget on top of it.
      const deadline = new Promise<never>((_, reject) => { timeoutId = setTimeout(() => reject(new Error('Browser page read timed out')), timeout + 10_000); });
      return await Promise.race([task, deadline]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      await browser?.close();
    }
  }
}
