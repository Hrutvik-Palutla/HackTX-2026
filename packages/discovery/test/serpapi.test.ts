import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SerpApiClient, SerpApiDiscovery, SerpApiError } from '../src/index.ts';
import type { City, Interval } from '../../fulfillment/src/types.ts';

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8'));
}
const city: City = { label: 'Austin, Texas, United States', countryCode: 'US', latitude: 30.2672, longitude: -97.7431, timeZone: 'America/Chicago' };
const window: Interval = { startAt: '2026-11-09T00:00:00.000Z', endAt: '2026-11-09T06:00:00.000Z' };
function mockFetch(resolver: (url: URL) => unknown, calls: URL[] = []) {
  return async (input: string | URL): Promise<Response> => {
    const url = new URL(input);
    calls.push(url);
    return new Response(JSON.stringify(resolver(url)), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

test('normalizes movie-title showtimes with local time conversion and stable candidates', async () => {
  let now = new Date('2026-11-09T01:00:00Z');
  const discovery = new SerpApiDiscovery({ apiKey: 'fixture-key', now: () => now, fetch: mockFetch(() => fixture('showtimes-movie-results.json')) });
  const first = await discovery.searchMovie({ title: 'Dune', city, window });
  const second = await discovery.searchMovie({ title: 'Dune', city, window });
  assert.equal(first.length, 3);
  assert.deepEqual(first.map(x => x.id), second.map(x => x.id));
  assert.equal(first[0].startAt, '2026-11-09T00:45:00.000Z');
  assert.equal(first[0].timeZone, 'America/Chicago');
  assert.equal(first[0].price, null);
  assert.equal(first[0].bookingUrl, null);
  assert.equal(first[0].evidence.find(e => e.field === 'title')?.origin, 'source');
  assert.equal(first[0].evidence.find(e => e.field === 'startAt')?.origin, 'computed');
  assert.equal(first[0].evidence.find(e => e.field === 'timeZone')?.origin, 'user');
  assert.deepEqual(first[0].sourceIds, [discovery.getSources()[0].id]);
  assert.equal(discovery.client.requestsUsed, 1, 'repeat query is served from cache');
  const fetchedAt = discovery.getSources()[0].fetchedAt;
  const firstSourceId = discovery.getSources()[0].id;
  now = new Date('2026-11-09T01:01:00Z');
  const cachedCandidates = await discovery.searchMovie({ title: 'Dune', city, window });
  assert.equal(discovery.getSources()[0].fetchedAt, fetchedAt, 'cache hits retain source fetch time');
  assert.equal(cachedCandidates[0].sourceIds[0], firstSourceId);
  now = new Date('2026-11-09T01:06:00Z');
  const refreshedCandidates = await discovery.searchMovie({ title: 'Dune', city, window });
  assert.notEqual(refreshedCandidates[0].sourceIds[0], firstSourceId, 'a fresh fetch gets a separate source record');
  assert.equal(discovery.getSource(firstSourceId)?.fetchedAt, fetchedAt, 'older source metadata remains addressable');
  assert.equal(refreshedCandidates[0].id, first[0].id, 'candidate identity remains stable across refresh');
});

test('normalizes the theater-search showtimes shape without inventing a theater', async () => {
  const discovery = new SerpApiDiscovery({ apiKey: 'fixture-key', now: () => new Date('2026-11-09T01:00:00Z'), fetch: mockFetch(() => fixture('showtimes-theater-results.json')) });
  const results = await discovery.searchMovie({ title: 'Dune', city, window });
  assert.equal(results.length, 1);
  assert.equal(results[0].title, 'Dune');
  assert.equal(results[0].venueName, 'Venue not specified');
  assert.equal(results[0].startAt, '2026-11-09T00:00:00.000Z');
});

test('normalizes event and Maps candidates, retains unknowns and source references', async () => {
  const discovery = new SerpApiDiscovery({
    apiKey: 'fixture-key', now: () => new Date('2026-11-09T01:00:00Z'),
    fetch: mockFetch(url => url.searchParams.get('engine') === 'google_maps' ? fixture('maps-results.json') : fixture('events-results.json')),
  });
  const results = await discovery.searchOutings({ query: 'live music', city, window });
  const event = results.find(x => x.kind === 'event' && x.title === 'Austin Example Concert');
  const undatedTime = results.find(x => x.title === 'Date Label Without Year');
  const areaAddress = results.find(x => x.title === 'Neighborhood Is Not A Street Address');
  const venue = results.find(x => x.kind === 'venue');
  assert.ok(event);
  assert.equal(event.startAt, '2026-11-09T00:00:00.000Z');
  assert.equal(event.address, null, 'city label is not copied into the venue address field');
  assert.deepEqual(event.price, { amountMinor: 2400, currency: 'USD' });
  assert.equal(event.priceKind, 'listed');
  assert.equal(event.evidence.find(e => e.field === 'price')?.origin, 'computed');
  assert.equal(event.bookingUrl, null, 'third-party informational link is not treated as a validated checkout URL');
  assert.ok(undatedTime);
  assert.equal(undatedTime.startAt, null, 'a date alone does not imply an event time');
  assert.equal(undatedTime.price, null);
  assert.equal(areaAddress?.address, null);
  assert.ok(venue);
  assert.equal(venue.startAt, null);
  assert.equal(results.some(x => x.title === 'Outside Date'), false);
  assert.equal(results.some(x => x.title === 'At Exclusive Window End'), false, 'end of interval is exclusive');
  assert.equal(results.some(x => x.title === 'live music'), false, 'a query label does not fill a missing event title');
  assert.equal(discovery.getSources().length, 2);
  for (const candidate of results) for (const sourceId of candidate.sourceIds) assert.ok(discovery.getSource(sourceId));
});

test('extractPublicPage returns provider source metadata and bounded public facts', async () => {
  const discovery = new SerpApiDiscovery({ apiKey: 'fixture-key', now: () => new Date('2026-11-09T01:00:00Z'), fetch: mockFetch(() => fixture('extract-result.json')) });
  const result = await discovery.extractPublicPage('https://events.example.com/one');
  assert.equal(result.source.provider, 'serpapi_extract');
  assert.equal(result.source.url, 'https://events.example.com/one');
  assert.equal(result.source.providerSearchId, 'fixture-extract-search');
  assert.deepEqual(result.facts, { text_content: { text: 'Public event information', markdown: '# Public event information' }, structured_data: [{ '@type': 'Event', name: 'Public event information' }] });
  assert.deepEqual(discovery.getSource(result.source.id), result.source);
  for (const url of [
    'http://127.0.0.1/private', 'http://[::1]/private', 'http://169.254.169.254/latest/meta-data',
    'https://user:pass@events.example.com/private', 'https://events.example.com:5432/private',
    'file:///etc/passwd', 'http://service.internal/data',
  ]) await assert.rejects(() => discovery.extractPublicPage(url), /public http or https URL/);
});

test('client caches responses, enforces a request ceiling, times out, and never leaks the key in errors', async () => {
  const calls: URL[] = [];
  const client = new SerpApiClient({ apiKey: 'super-secret-key', maxRequests: 1, cacheTtlMs: 30_000, fetch: mockFetch(() => ({ ok: true }), calls) });
  await client.search({ engine: 'google', q: 'one' });
  await client.search({ q: 'one', engine: 'google' });
  assert.equal(client.requestsUsed, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].searchParams.get('api_key'), 'super-secret-key');
  await assert.rejects(() => client.search({ engine: 'google', q: 'two' }), /request limit reached/);
  const rejected = new SerpApiClient({ apiKey: 'never-print-this', fetch: mockFetch(() => ({ error: 'bad never-print-this' })) });
  await assert.rejects(() => rejected.search({ engine: 'google', q: 'x' }), (error: unknown) => {
    assert.ok(error instanceof SerpApiError);
    assert.equal(error.message.includes('never-print-this'), false);
    return true;
  });
  let sawAbort = false;
  const timeout = new SerpApiClient({ apiKey: 'fixture-key', timeoutMs: 100, fetch: async (_url, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => { sawAbort = true; reject(init.signal?.reason); }, { once: true });
  }) });
  const keepAlive = setTimeout(() => {}, 150);
  await assert.rejects(() => timeout.search({ engine: 'google', q: 'x' }), /timed out/);
  clearTimeout(keepAlive);
  assert.equal(sawAbort, true, 'timeout signal is passed through to fetch');
});

test('expired cache entries trigger one new billable request and update fetch provenance', async () => {
  let nowMs = Date.parse('2026-11-09T01:00:00Z');
  let responseNumber = 0;
  const client = new SerpApiClient({
    apiKey: 'fixture-key', maxRequests: 2, cacheTtlMs: 1_000, now: () => new Date(nowMs),
    fetch: async () => new Response(JSON.stringify({ call: ++responseNumber }), { status: 200 }),
  });
  const first = await client.searchWithMetadata({ engine: 'google', q: 'cache-test' });
  const cached = await client.searchWithMetadata({ engine: 'google', q: 'cache-test' });
  assert.equal(cached.cacheHit, true);
  assert.equal(cached.fetchedAt, first.fetchedAt);
  nowMs += 1_001;
  const refreshed = await client.searchWithMetadata({ engine: 'google', q: 'cache-test' });
  assert.equal(refreshed.cacheHit, false);
  assert.notEqual(refreshed.fetchedAt, first.fetchedAt);
  assert.equal(client.requestsUsed, 2);
  assert.equal(responseNumber, 2);
  await assert.rejects(() => client.search({ engine: 'google', q: 'different-query' }), /request limit reached/);
});

test('rejects malformed JSON and cancels oversized response bodies at the byte limit', async () => {
  const invalidJson = new SerpApiClient({ apiKey: 'fixture-key', fetch: async () => new Response('{not json') });
  await assert.rejects(() => invalidJson.search({ engine: 'google', q: 'bad-json' }), /invalid JSON/);
  const oversized = new SerpApiClient({ apiKey: 'fixture-key', fetch: async () => new Response('x'.repeat(1_000_001)) });
  await assert.rejects(() => oversized.search({ engine: 'google', q: 'too-large' }), /byte limit/);
});

test('does not invent a date from a weekday label or an overlong window', async () => {
  const body = { showtimes: [{ date: 'Nov 8', theaters: [{ name: 'Cinema', showing: [{ time: ['6:00pm'] }] }] }] };
  const discovery = new SerpApiDiscovery({ apiKey: 'fixture-key', now: () => new Date('2026-11-09T01:00:00Z'), fetch: mockFetch(() => body) });
  const wideWindow = { startAt: '2025-11-01T00:00:00Z', endAt: '2026-11-20T00:00:00Z' };
  assert.deepEqual(await discovery.searchMovie({ title: 'Dune', city, window: wideWindow }), []);
  const noDateDiscovery = new SerpApiDiscovery({ apiKey: 'fixture-key', now: () => new Date('2026-11-09T01:00:00Z'), fetch: mockFetch(() => ({ showtimes: [{ day: 'Sunday', theaters: [{ name: 'Cinema', showing: [{ time: ['6:00pm'] }] }] }] })) });
  assert.deepEqual(await noDateDiscovery.searchMovie({ title: 'Dune', city, window }), []);
});

test('does not turn generic nearby theater results into requested movie screenings', async () => {
  const body = { showtimes: [{ date: 'Nov 8', theaters: [{ name: 'Cinema', showing: [{ time: ['6:00pm'] }] }] }] };
  const discovery = new SerpApiDiscovery({ apiKey: 'fixture-key', now: () => new Date('2026-11-09T01:00:00Z'), fetch: mockFetch(() => body) });
  assert.deepEqual(await discovery.searchMovie({ title: 'Dune', city, window }), []);
  const shortTitle = new SerpApiDiscovery({ apiKey: 'fixture-key', fetch: mockFetch(() => ({ showtimes: [{ date: 'Nov 8', movies: [{ name: 'Little Women', showing: [{ time: ['6:00pm'] }] }] }] })) });
  assert.deepEqual(await shortTitle.searchMovie({ title: 'It', city, window }), [], 'short title substring does not match another film name');
});

test('movie evidence retains organic source links and reports no structured showtimes without inventing screenings', async () => {
  const body = {
    search_metadata: { id: 'organic-movie-search' },
    organic_results: [
      { title: 'Austin Theater Showtimes', link: 'https://cinema.example.com/showtimes?api_key=fixture-key&view=movies', snippet: 'Clayface showtimes today' },
      { title: 'Alamo Drafthouse Austin', link: 'https://drafthouse.example.com/movies', snippet: 'Now showing' },
    ],
  };
  const discovery = new SerpApiDiscovery({ apiKey: 'fixture-key', now: () => new Date('2026-10-24T10:00:00Z'), fetch: mockFetch(() => body) });
  const evidence = await discovery.searchMovieEvidence({ title: 'Clayface', city, window });
  assert.deepEqual(evidence.candidates, []);
  assert.equal(evidence.diagnostics[0].code, 'NO_STRUCTURED_SHOWTIMES');
  assert.equal(evidence.diagnostics[0].message.includes('fixture-key'), false);
  assert.equal(evidence.sources.length, 3, 'SERP query source plus two organic source pages');
  assert.equal(evidence.sources[0].providerSearchId, 'organic-movie-search');
  assert.equal(evidence.sources[0].fetchedAt, '2026-10-24T10:00:00.000Z');
  assert.equal(evidence.sources[1].url, 'https://cinema.example.com/showtimes?view=movies');
  assert.equal(evidence.sources.some(source => source.url.includes('fixture-key')), false);
  for (const source of evidence.sources) assert.deepEqual(discovery.getSource(source.id), source);
});

test('handles local date rollover and rejects ambiguous or nonexistent DST wall times', async () => {
  const yearRollover = new SerpApiDiscovery({ apiKey: 'fixture-key', now: () => new Date('2026-12-31T20:00:00Z'), fetch: mockFetch(() => ({
    search_metadata: { id: 'rollover' },
    events_results: [{ title: 'New Year Event', date: 'Jan 1', time: '12:15 AM', venue: 'Midnight Hall' }],
  })) });
  const nextYearWindow = { startAt: '2027-01-01T06:00:00Z', endAt: '2027-01-01T07:00:00Z' };
  const nextYear = await yearRollover.searchOutings({ query: 'New Year Event', city, window: nextYearWindow });
  assert.equal(nextYear.find(x => x.kind === 'event')?.startAt, '2027-01-01T06:15:00.000Z');

  const eastern: City = { ...city, label: 'New York, NY', timeZone: 'America/New_York' };
  for (const [date, time, window] of [
    ['2026-11-01', '1:30 AM', { startAt: '2026-11-01T04:00:00Z', endAt: '2026-11-01T07:00:00Z' }],
    ['2026-03-08', '2:30 AM', { startAt: '2026-03-08T06:00:00Z', endAt: '2026-03-08T08:00:00Z' }],
  ] as const) {
    const discovery = new SerpApiDiscovery({ apiKey: 'fixture-key', fetch: mockFetch(() => ({ showtimes: [{ date, movies: [{ name: 'Dune', showing: [{ time: [time] }] }] }] })) });
    assert.deepEqual(await discovery.searchMovie({ title: 'Dune', city: eastern, window }), [], `${date} ${time} is not a unique valid local instant`);
  }
});

test('malformed provider result structures return no candidates instead of throwing', async () => {
  const discovery = new SerpApiDiscovery({ apiKey: 'fixture-key', fetch: mockFetch(() => ({ showtimes: 'unexpected', events_results: { title: 'not an array' }, local_results: null })) });
  assert.deepEqual(await discovery.searchMovie({ title: 'Dune', city, window }), []);
  assert.deepEqual(await discovery.searchOutings({ query: 'music', city, window }), []);
});

test('normalizes the Maps place_results shape without promoting its website to checkout', async () => {
  const discovery = new SerpApiDiscovery({ apiKey: 'fixture-key', fetch: mockFetch(url => url.searchParams.get('engine') === 'google_maps'
    ? { search_metadata: { id: 'place-shape' }, place_results: { title: 'Example Venue', address: '42 Main St, Austin, TX', website: 'https://venue.example.com' } }
    : { search_metadata: { id: 'no-events' } }) });
  const results = await discovery.searchOutings({ query: 'music venue', city, window });
  assert.equal(results.length, 1);
  assert.equal(results[0].kind, 'venue');
  assert.equal(results[0].address, '42 Main St, Austin, TX');
  assert.equal(results[0].bookingUrl, null);
});

test('outing search keeps event results and sanitized diagnostics when Maps rejects its request', async () => {
  const calls: URL[] = [];
  const fetcher = async (input: string | URL): Promise<Response> => {
    const url = new URL(input);
    calls.push(url);
    if (url.searchParams.get('engine') === 'google_maps') {
      return new Response(JSON.stringify({ error: 'Missing or invalid type parameter; received api_key=fixture-key' }), { status: 400 });
    }
    return new Response(JSON.stringify(fixture('events-results.json')), { status: 200 });
  };
  const discovery = new SerpApiDiscovery({ apiKey: 'fixture-key', now: () => new Date('2026-11-09T01:00:00Z'), fetch: fetcher });
  const results = await discovery.searchOutings({ query: 'live music', city, window });
  assert.equal(results.some(result => result.title === 'Austin Example Concert'), true);
  assert.equal(results.some(result => result.kind === 'venue'), false);
  assert.deepEqual(discovery.getDiagnostics().map(({ engine, status }) => ({ engine, status })), [{ engine: 'google_maps', status: 400 }]);
  assert.match(discovery.getDiagnostics()[0].message, /Missing or invalid type parameter/);
  assert.equal(discovery.getDiagnostics()[0].message.includes('fixture-key'), false);
  const mapsUrl = calls.find(url => url.searchParams.get('engine') === 'google_maps');
  assert.equal(mapsUrl?.searchParams.get('type'), 'search');
  assert.equal(mapsUrl?.searchParams.has('location'), false, 'Google Maps location is expressed in q for this request');
});
