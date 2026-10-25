import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { SerpApiClient, SerpApiDiscovery, SerpApiError, SerpApiResearch } from '../src/index.ts';

function fakeFetch(payload: (url: URL) => unknown, calls: URL[] = []) {
  return async (input: string | URL): Promise<Response> => {
    const url = new URL(input);
    calls.push(url);
    return new Response(JSON.stringify(payload(url)), { headers: { 'content-type': 'application/json' } });
  };
}

test('research search returns structured results, readable evidence, and stable metadata', async () => {
  const calls: URL[] = [];
  const discovery = new SerpApiDiscovery({ apiKey: 'fixture-key', now: () => new Date('2026-10-25T12:00:00Z'), fetch: fakeFetch(() => ({
    search_metadata: { id: 'provider-id' },
    organic_results: [{ title: 'Library event', snippet: 'A public program', link: 'https://events.example.org/one' }],
  }), calls) });
  const result = await discovery.research.search({ query: 'library programs' });
  assert.equal(calls[0].searchParams.get('engine'), 'google');
  assert.equal(result.query, 'library programs');
  assert.equal(result.fetchedAt, '2026-10-25T12:00:00.000Z');
  assert.match(result.sourceId, /^research_/);
  assert.match(result.text, /Library event.*A public program/);
  assert.equal((result.results.organic_results as unknown[]).length, 1);
  assert.equal(JSON.stringify(result).includes('fixture-key'), false);
});

test('new research session receives its own bounded request allowance', async () => {
  let requests = 0;
  const discovery = new SerpApiDiscovery({ apiKey: 'fixture-key', maxRequests: 1, cacheTtlMs: 0, fetch: fakeFetch(() => { requests++; return {}; }) });
  await discovery.research.search({ query: 'first' });
  await assert.rejects(discovery.research.search({ query: 'second' }), SerpApiError);
  const nextRun = discovery.newSession();
  await nextRun.research.search({ query: 'first' });
  assert.equal(requests, 2);
});

const require = createRequire(new URL('../../../apps/booking-worker/package.json', import.meta.url));
let chromiumAvailable = false;
try { chromiumAvailable = existsSync((require('playwright') as { chromium: { executablePath(): string } }).chromium.executablePath()); } catch { /* Browser is optional in local test environments. */ }

test('render reads JavaScript populated text without calling Extract', { skip: !chromiumAvailable }, async () => {
  const calls: URL[] = [];
  const client = new SerpApiClient({ apiKey: 'fixture-key', fetch: fakeFetch(() => { throw new Error('Extract should be bypassed'); }, calls) });
  // Inject public DNS for this owned fixture hostname; Chromium intercepts all requests before they leave the process.
  const fixtureUrl = 'https://research-fixture.example.org/page';
  const research = new SerpApiResearch(client, {
    resolveHost: async () => [{ address: '93.184.216.34' }],
    fixtureHtml: { url: fixtureUrl, html: '<!doctype html><title>Fixture</title><body><label for="month">Month</label><select id="month"><option value="oct">October</option><option value="nov">November</option></select><button onclick="document.querySelector(\'#app\').textContent = \'November event details\'">Next date</button><div id="app">October events</div><a href="https://events.example.org/tickets">Event details</a><script type="application/ld+json">{"name":"November community event"}</script></body>' },
  });
  const result = await research.read({ url: fixtureUrl, render: true, actions: [{ kind: 'select', label: 'Month', value: 'nov' }, { kind: 'click', label: 'Next date' }] });
  assert.match(result.title, /Fixture/);
  assert.match(result.text, /November event details/);
  assert.match(result.text, /November community event/);
  assert.equal(result.links?.[0]?.url, 'https://events.example.org/tickets');
  assert.equal(calls.length, 0);
});

test('rejects unsafe transactional actions before resolving or fetching a page', async () => {
  const client = new SerpApiClient({ apiKey: 'fixture-key', fetch: fakeFetch(() => ({})) });
  const research = new SerpApiResearch(client);
  await assert.rejects(research.read({ url: 'https://public.example.org/', actions: [{ kind: 'click', label: 'Book tickets' }] }), /not allowed/);
  await assert.rejects(research.read({ url: 'https://public.example.org/', actions: Array.from({ length: 5 }, () => ({ kind: 'click' as const, label: 'Next date' })) }), /At most four/);
});
