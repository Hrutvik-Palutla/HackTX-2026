import { isIP } from 'node:net';
import { createHash } from 'node:crypto';
import type { Candidate, City, Evidence, Interval, Money, Source } from '../../fulfillment/src/types.ts';
import { SerpApiResearch } from './research.ts';
import type { ResearchPort } from '../../contracts/src/index.ts';

type JsonRecord = Record<string, unknown>;
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type SerpApiClientOptions = {
  apiKey?: string;
  fetch?: FetchLike;
  baseUrl?: string;
  timeoutMs?: number;
  maxRequests?: number;
  cacheTtlMs?: number;
  maxCacheEntries?: number;
  now?: () => Date;
};

export class SerpApiError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'SerpApiError';
    this.status = status;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function list(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function cleanText(value: string, max = 500): string { return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max); }
function safeDiagnosticText(value: string, apiKey: string): string {
  let result = value;
  if (apiKey) result = result.replaceAll(apiKey, '[redacted]').replaceAll(encodeURIComponent(apiKey), '[redacted]');
  return cleanText(result.replace(/https?:\/\/\S+/gi, '[url]').replace(/api_key=[^&\s]*/gi, 'api_key=[redacted]'), 180);
}
function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}
function id(prefix: string, value: string): string { return `${prefix}_${hash(value)}`; }
function safeHttpUrl(value: unknown): string | null {
  const raw = str(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch { return null; }
}
function safeOrganicSourceUrl(value: unknown): string | null {
  const raw = safeHttpUrl(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.hostname === 'serpapi.com' || url.hostname.endsWith('.serpapi.com')) return null;
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|secret)$/i.test(key)) url.searchParams.delete(key);
    }
    if (/api[_-]?key|access[_-]?token/i.test(url.hash)) url.hash = '';
    return url.toString();
  } catch { return null; }
}
function isPublicWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (url.port && url.port !== (url.protocol === 'https:' ? '443' : '80')) return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (isIP(host) !== 0) return false;
    const blockedSuffixes = ['localhost', 'local', 'internal', 'test', 'example', 'invalid', 'home', 'lan', 'corp', 'arpa'];
    if (!host.includes('.') || blockedSuffixes.some(suffix => host === suffix || host.endsWith(`.${suffix}`))) return false;
    if (host.split('.').some(label => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))) return false;
    return true;
  } catch { return false; }
}
function rawCurrency(text: string | null, countryCode: string): string | null {
  if (!text) return null;
  const code = text.match(/\b[A-Z]{3}\b/);
  if (code) return code[0];
  const symbol = text.match(/^[^\d\s]+/);
  if (!symbol) return null;
  return symbol[0] === '$' && countryCode.toUpperCase() === 'US' ? 'USD' : symbol[0];
}
function dateIso(value: Date): string { return value.toISOString(); }
async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel();
    throw new SerpApiError(`SerpApi response exceeded the ${maxBytes} byte limit`);
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new SerpApiError(`SerpApi response exceeded the ${maxBytes} byte limit`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

type CacheEntry = { expiresAt: number; fetchedAt: string; value: unknown };
type SearchResult = { body: JsonRecord; fetchedAt: string; cacheHit: boolean };
export class SerpApiClient {
  private readonly apiKey: string;
  private readonly fetcher: FetchLike;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRequests: number;
  private readonly cacheTtlMs: number;
  private readonly maxCacheEntries: number;
  private readonly now: () => Date;
  private requestCount = 0;
  private requestSignal?: AbortSignal;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(options: SerpApiClientOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.SERPAPI_API_KEY ?? '';
    this.fetcher = options.fetch ?? fetch;
    this.baseUrl = options.baseUrl ?? 'https://serpapi.com/search.json';
    // Google showtime queries can take longer than ordinary search; keep a bounded margin below SerpApi's 30 s default.
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.maxRequests = options.maxRequests ?? 40;
    this.cacheTtlMs = options.cacheTtlMs ?? 5 * 60_000;
    this.maxCacheEntries = options.maxCacheEntries ?? 100;
    this.now = options.now ?? (() => new Date());
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 100 || this.timeoutMs > 120_000) throw new RangeError('timeoutMs must be 100..120000');
    if (!Number.isInteger(this.maxRequests) || this.maxRequests < 1) throw new RangeError('maxRequests must be positive');
    if (!Number.isInteger(this.maxCacheEntries) || this.maxCacheEntries < 1) throw new RangeError('maxCacheEntries must be positive');
  }

  get requestsUsed(): number { return this.requestCount; }
  setAbortSignal(signal: AbortSignal) { this.requestSignal = signal; }
  clearCache(): void { this.cache.clear(); }

  async search(params: Record<string, string>): Promise<JsonRecord> {
    return (await this.searchWithMetadata(params)).body;
  }

  async searchWithMetadata(params: Record<string, string>, signal?: AbortSignal): Promise<SearchResult> {
    signal = this.requestSignal ? (signal ? AbortSignal.any([signal, this.requestSignal]) : this.requestSignal) : signal;
    signal?.throwIfAborted();
    if (!this.apiKey) throw new SerpApiError('SerpApi API key is not configured');
    const canonical = new URLSearchParams(Object.entries(params).sort(([a], [b]) => a.localeCompare(b))).toString();
    const cached = this.cache.get(canonical);
    const nowMs = this.now().getTime();
    if (cached && cached.expiresAt > nowMs) return { body: structuredClone(cached.value) as JsonRecord, fetchedAt: cached.fetchedAt, cacheHit: true };
    if (cached) this.cache.delete(canonical);
    if (this.requestCount >= this.maxRequests) throw new SerpApiError('SerpApi request limit reached');
    this.requestCount++;
    const url = new URL(this.baseUrl);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    url.searchParams.set('api_key', this.apiKey);
    try {
      const response = await this.fetcher(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs) });
      if (!response.ok) {
        let detail = '';
        try {
          const errorText = await readBoundedText(response, 32_000);
          const errorBody: unknown = JSON.parse(errorText);
          if (isRecord(errorBody)) {
            const providerError = str(errorBody.error);
            if (providerError) detail = `: ${safeDiagnosticText(providerError, this.apiKey)}`;
          }
        } catch { /* Keep the status diagnostic when an error body is absent or malformed. */ }
        throw new SerpApiError(`SerpApi request failed (HTTP ${response.status})${detail}`, response.status);
      }
      const bodyText = await readBoundedText(response, 1_000_000);
      let body: unknown;
      try { body = JSON.parse(bodyText); } catch { throw new SerpApiError('SerpApi returned invalid JSON'); }
      if (!isRecord(body)) throw new SerpApiError('SerpApi returned an unexpected response');
      const providerError = str(body.error);
      if (providerError) throw new SerpApiError(`SerpApi rejected the request: ${safeDiagnosticText(providerError, this.apiKey)}`);
      const fetchedAt = this.timestamp();
      if (this.cacheTtlMs > 0) {
        this.cache.set(canonical, { value: body, fetchedAt, expiresAt: this.now().getTime() + this.cacheTtlMs });
        while (this.cache.size > this.maxCacheEntries) this.cache.delete(this.cache.keys().next().value as string);
      }
      return { body: structuredClone(body), fetchedAt, cacheHit: false };
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof SerpApiError) throw error;
      if (error instanceof DOMException && error.name === 'TimeoutError') throw new SerpApiError('SerpApi request timed out');
      const cause = error instanceof Error ? error.cause : null;
      const causeCode = isRecord(cause) ? str(cause.code) : null;
      const errorKind = error instanceof Error ? error.name : 'Error';
      if (causeCode) throw new SerpApiError(`SerpApi network request failed (${causeCode}; ${errorKind})`);
      throw new SerpApiError('SerpApi request failed');
    }
  }

  timestamp(): string { return dateIso(this.now()); }
}

function sourceFor(provider: Source['provider'], title: string, url: string, searchId: string | null, fetchedAt: string): Source {
  return { id: id('src', `${provider}|${url}|${searchId ?? ''}|${fetchedAt}`), provider, title: cleanText(title, 180), url, providerSearchId: searchId, fetchedAt };
}
function searchId(body: JsonRecord): string | null {
  return isRecord(body.search_metadata) ? str(body.search_metadata.id) : null;
}
function sourceEvidence(fields: string[], sourceId: string): Evidence[] {
  return fields.map(field => ({ field, origin: 'source', sourceId, sourceMessageId: null }));
}
function movieTitlesMatch(left: string, right: string): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
  const a = normalize(left), b = normalize(right);
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  return shorter.length >= 4 && longer.startsWith(`${shorter} `);
}
function movieTitleMatches(body: JsonRecord, requestedTitle: string): boolean {
  const possibleTitles: string[] = [];
  if (isRecord(body.knowledge_graph)) {
    for (const key of ['title', 'name']) {
      const value = str(body.knowledge_graph[key]);
      if (value) possibleTitles.push(value);
    }
  }
  const movieResults = Array.isArray(body.movie_results) ? body.movie_results : [body.movie_results];
  for (const result of movieResults) if (isRecord(result)) {
    const value = str(result.title) ?? str(result.name);
    if (value) possibleTitles.push(value);
  }
  for (const group of list(body.showtimes)) if (isRecord(group)) {
    const value = str(group.title) ?? str(group.movie_title);
    if (value) possibleTitles.push(value);
  }
  return possibleTitles.some(value => movieTitlesMatch(value, requestedTitle));
}
function queryUrl(q: string): string { return `https://www.google.com/search?q=${encodeURIComponent(q)}`; }
function localDate(iso: string, timeZone: string): string | null {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
    const get = (type: string) => parts.find(p => p.type === type)?.value;
    const y = get('year'), m = get('month'), d = get('day');
    return y && m && d ? `${y}-${m}-${d}` : null;
  } catch { return null; }
}
function dateRange(window: Interval, zone: string): string[] {
  const start = localDate(window.startAt, zone), end = localDate(window.endAt, zone);
  if (!start || !end || start > end) return [];
  const startDate = new Date(`${start}T12:00:00Z`), endDate = new Date(`${end}T12:00:00Z`);
  const days = Math.ceil((endDate.getTime() - startDate.getTime()) / 86_400_000);
  if (days < 0 || days > 366) return [];
  return Array.from({ length: days + 1 }, (_, i) => {
    const d = new Date(startDate.getTime() + i * 86_400_000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  });
}
const MONTHS: Record<string, number> = Object.fromEntries(['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].map((m, i) => [m, i + 1]));
function resolveDate(label: unknown, window: Interval, zone: string, fetchedAt: string, dayLabel?: unknown): string | null {
  const raw = str(label);
  const dates = dateRange(window, zone);
  if (!dates.length) return null;
  if (raw) {
    const full = raw.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
    if (full) {
      const exact = `${full[1]}-${full[2].padStart(2, '0')}-${full[3].padStart(2, '0')}`;
      return dates.includes(exact) ? exact : null;
    }
    const monthDay = raw.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})\b/) ?? raw.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\.?\b/);
    if (monthDay) {
      const monthText = /^\d+$/.test(monthDay[1]) ? monthDay[2] : monthDay[1];
      const dayText = /^\d+$/.test(monthDay[1]) ? monthDay[1] : monthDay[2];
      const month = MONTHS[monthText.slice(0, 3).toLowerCase()];
      if (month) {
        const matches = dates.filter(d => Number(d.slice(5, 7)) === month && Number(d.slice(8)) === Number(dayText));
        if (matches.length === 1) return matches[0];
      }
    }
    if (/\b(today|tomorrow)\b/i.test(raw) || /\b(today|tomorrow)\b/i.test(str(dayLabel) ?? '')) {
      const base = localDate(fetchedAt, zone);
      if (!base) return null;
      const relative = new Date(`${base}T12:00:00Z`);
      if (/tomorrow/i.test(raw) || /tomorrow/i.test(str(dayLabel) ?? '')) relative.setUTCDate(relative.getUTCDate() + 1);
      const date = `${relative.getUTCFullYear()}-${String(relative.getUTCMonth() + 1).padStart(2, '0')}-${String(relative.getUTCDate()).padStart(2, '0')}`;
      return dates.includes(date) ? date : null;
    }
  }
  return null;
}
function parseTime(value: unknown): { hour: number; minute: number } | null {
  const raw = str(value);
  if (!raw) return null;
  const m = raw.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\b/i);
  if (!m) return null;
  let hour = Number(m[1]), minute = Number(m[2] ?? '0');
  const meridiem = (m[3] ?? '').replaceAll('.', '').toLowerCase();
  if (minute > 59 || hour > 24 || (meridiem && (hour < 1 || hour > 12))) return null;
  if (meridiem === 'pm' && hour !== 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  if (hour === 24 && minute !== 0) return null;
  return { hour, minute };
}
function wallTimeToInstant(date: string, time: unknown, zone: string): string | null {
  const parsed = parseTime(time);
  if (!parsed) return null;
  const [year, month, day] = date.split('-').map(Number);
  const naive = Date.UTC(year, month - 1, day, parsed.hour, parsed.minute);
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  } catch { return null; }
  const localParts = (instant: number) => formatter.formatToParts(new Date(instant));
  const partsAt = (instant: number) => {
    const parts = localParts(instant);
    const get = (type: string) => parts.find(p => p.type === type)?.value;
    return { year: Number(get('year')), month: Number(get('month')), day: Number(get('day')), hour: Number(get('hour')), minute: Number(get('minute')) };
  };
  const offsets = new Set<number>();
  for (const hours of [-48, -12, 12, 48]) {
    const sample = naive + hours * 3_600_000;
    const parts = partsAt(sample);
    offsets.add(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - sample);
  }
  const matches = new Set<number>();
  for (const offset of offsets) {
    const candidate = naive - offset;
    const parts = partsAt(candidate);
    if (parts.year === year && parts.month === month && parts.day === day && parts.hour === parsed.hour && parts.minute === parsed.minute) matches.add(candidate);
  }
  return matches.size === 1 ? new Date([...matches][0]).toISOString() : null;
}
function candidate(input: {
  kind: Candidate['kind']; title: string; venue: string; address?: string | null; city: City; startAt?: string | null;
  format?: string | null; price?: Money | null; rawPriceText?: string | null; rawCurrency?: string | null;
  source: Source; stableKey: string; bookingUrl?: string | null; computedFields?: string[];
}): Candidate {
  const evidence = sourceEvidence(['title', 'venueName', 'address', 'timeZone', 'startAt', 'durationMinutes', 'format', 'price', 'rawPriceText', 'rawCurrency', 'priceKind', 'bookingUrl'], input.source.id);
  const timezoneEvidence = evidence.find(entry => entry.field === 'timeZone');
  if (timezoneEvidence) { timezoneEvidence.origin = 'user'; timezoneEvidence.sourceId = null; }
  const priceKindEvidence = evidence.find(entry => entry.field === 'priceKind');
  if (priceKindEvidence) priceKindEvidence.origin = 'computed';
  for (const field of input.computedFields ?? []) {
    const item = evidence.find(entry => entry.field === field);
    if (item) item.origin = 'computed';
  }
  return {
    id: id('cand', input.stableKey), kind: input.kind, title: cleanText(input.title, 180), venueName: cleanText(input.venue, 180),
    address: input.address ? cleanText(input.address, 300) : null, timeZone: input.city.timeZone,
    startAt: input.startAt ?? null, durationMinutes: null, format: input.format ? cleanText(input.format, 100) : null,
    price: input.price ?? null, rawPriceText: input.rawPriceText ?? null, rawCurrency: input.rawCurrency ?? null,
    priceKind: input.price ? 'listed' : 'unknown', bookingUrl: input.bookingUrl ?? null,
    sourceIds: [input.source.id], evidence,
  };
}

export type DiscoveryOptions = SerpApiClientOptions;
export type DiscoveryDiagnostic = {
  engine: 'google_movie' | 'google_events' | 'google_maps';
  code: string;
  status: number | null;
  message: string;
  occurredAt: string;
};
export type MovieSearchEvidence = { candidates: Candidate[]; sources: Source[]; diagnostics: DiscoveryDiagnostic[] };
export class SerpApiDiscovery {
  readonly client: SerpApiClient;
  readonly research: ResearchPort;
  private readonly options: DiscoveryOptions;
  private readonly sources = new Map<string, Source>();
  private diagnostics: DiscoveryDiagnostic[] = [];
  constructor(options: DiscoveryOptions = {}) { this.options = { ...options }; this.client = new SerpApiClient(options); this.research = new SerpApiResearch(this.client); }

  /** A fresh per-run quota scope. Cache reuse is optional; request limits always remain enforced per run. */
  newSession(): SerpApiDiscovery { return new SerpApiDiscovery(this.options); }

  getSources(): Source[] { return [...this.sources.values()].map(source => ({ ...source })); }
  getDiagnostics(): DiscoveryDiagnostic[] { return this.diagnostics.map(diagnostic => ({ ...diagnostic })); }
  getSource(sourceId: string): Source | null {
    const source = this.sources.get(sourceId);
    return source ? { ...source } : null;
  }
  private addDiagnostic(engine: DiscoveryDiagnostic['engine'], reason: unknown, code?: string): void {
    const error = reason instanceof SerpApiError ? reason : new SerpApiError('SerpApi request failed');
    this.diagnostics.push({ engine, code: code ?? (error.status ? `HTTP_${error.status}` : 'REQUEST_FAILED'), status: error.status ?? null, message: error.message, occurredAt: this.client.timestamp() });
  }

  setAbortSignal(signal: AbortSignal) { this.client.setAbortSignal(signal); }

  async searchMovie(input: { title: string; city: City; window: Interval }): Promise<Candidate[]> {
    return (await this.searchMovieEvidence(input)).candidates;
  }

  async searchMovieEvidence(input: { title: string; city: City; window: Interval }): Promise<MovieSearchEvidence> {
    const title = cleanText(input.title, 120);
    if (!title) throw new TypeError('Movie title is required');
    this.diagnostics = [];
    const query = `${title} showtimes ${input.city.label}`;
    let search: SearchResult;
    try {
      search = await this.client.searchWithMetadata({ engine: 'google', q: query, location: input.city.label, hl: 'en', gl: input.city.countryCode.toLowerCase() });
    } catch (error) {
      this.addDiagnostic('google_movie', error);
      return { candidates: [], sources: [], diagnostics: this.getDiagnostics() };
    }
    const body = search.body;
    const fetchedAt = search.fetchedAt;
    const searchSource = sourceFor('serpapi_google', `Google showtimes for ${title}`, queryUrl(query), searchId(body), fetchedAt);
    this.sources.set(searchSource.id, searchSource);
    const callSources = [searchSource];
    for (const row of list(body.organic_results).slice(0, 10)) {
      if (!isRecord(row)) continue;
      const sourceUrl = safeOrganicSourceUrl(row.link);
      const sourceTitle = str(row.title);
      if (!sourceUrl || !sourceTitle) continue;
      const organicSource = sourceFor('serpapi_google', sourceTitle, sourceUrl, searchId(body), fetchedAt);
      this.sources.set(organicSource.id, organicSource);
      callSources.push(organicSource);
    }
    const results: Candidate[] = [];
    const seen = new Set<string>();
    const showtimeGroups = list(body.showtimes);
    const targetMovieConfirmed = movieTitleMatches(body, title);
    for (const dayGroup of showtimeGroups) {
      if (!isRecord(dayGroup)) continue;
      const date = resolveDate(dayGroup.date, input.window, input.city.timeZone, fetchedAt, dayGroup.day);
      const theaterRows = list(dayGroup.theaters);
      for (const theaterRaw of theaterRows) {
        if (!date || !targetMovieConfirmed || !isRecord(theaterRaw)) continue;
        const theater = theaterRaw;
        for (const showingRaw of list(theater.showing)) {
          if (!isRecord(showingRaw)) continue;
          for (const time of list(showingRaw.time)) {
            const startAt = wallTimeToInstant(date, time, input.city.timeZone);
            if (!startAt || startAt < input.window.startAt || startAt >= input.window.endAt) continue;
            const format = str(showingRaw.type);
            const name = str(theater.name) ?? 'Venue not specified';
            const key = `${title.toLowerCase()}|${name.toLowerCase()}|${startAt}|${format ?? ''}`;
            if (seen.has(key)) continue;
            seen.add(key);
            results.push(candidate({ kind: 'movie_screening', title, venue: name, address: str(theater.address), city: input.city,
              startAt, format, source: searchSource, stableKey: key, computedFields: ['startAt'] }));
          }
        }
      }
      // The documented theater-search shape has movies on a known theater result but no theater identity in each row.
      // Preserve supported time/title data while exposing the venue as unknown instead of borrowing a search label.
      if (date && !theaterRows.length) for (const movieRaw of list(dayGroup.movies)) {
        if (!isRecord(movieRaw)) continue;
        const movieTitle = str(movieRaw.name) ?? title;
        if (!movieTitlesMatch(movieTitle, title)) continue;
        for (const showingRaw of list(movieRaw.showing)) {
          if (!isRecord(showingRaw)) continue;
          for (const time of list(showingRaw.time)) {
            const startAt = wallTimeToInstant(date, time, input.city.timeZone);
            if (!startAt || startAt < input.window.startAt || startAt >= input.window.endAt) continue;
            const format = str(showingRaw.type);
            const key = `${movieTitle.toLowerCase()}|venue-unknown|${startAt}|${format ?? ''}`;
            if (seen.has(key)) continue;
            seen.add(key);
            results.push(candidate({ kind: 'movie_screening', title: movieTitle, venue: 'Venue not specified', city: input.city,
              startAt, format, source: searchSource, stableKey: key, computedFields: ['startAt'] }));
          }
        }
      }
    }
    if (!showtimeGroups.length) this.addDiagnostic('google_movie', new SerpApiError('Google Search returned no structured showtimes'), 'NO_STRUCTURED_SHOWTIMES');
    else if (!targetMovieConfirmed && showtimeGroups.some(group => isRecord(group) && list(group.theaters).length > 0)) {
      this.addDiagnostic('google_movie', new SerpApiError('Showtime results did not explicitly match the requested movie'), 'NO_TITLE_MATCH');
    } else if (!results.length) this.addDiagnostic('google_movie', new SerpApiError('No matching showtimes fell inside the requested window'), 'NO_SCREENINGS_IN_WINDOW');
    return { candidates: results, sources: callSources, diagnostics: this.getDiagnostics() };
  }

  async searchOutings(input: { query: string; city: City; window: Interval }): Promise<Candidate[]> {
    const query = cleanText(input.query, 160);
    if (!query) throw new TypeError('Outing query is required');
    this.diagnostics = [];
    const [eventsSettled, mapsSettled] = await Promise.allSettled([
      this.client.searchWithMetadata({ engine: 'google', q: `${query} events ${input.city.label}`, location: input.city.label, hl: 'en', gl: input.city.countryCode.toLowerCase() }),
      this.client.searchWithMetadata({ engine: 'google_maps', type: 'search', q: `${query} ${input.city.label}`, hl: 'en' }),
    ]);
    const eventsResult = eventsSettled.status === 'fulfilled' ? eventsSettled.value : null;
    const mapsResult = mapsSettled.status === 'fulfilled' ? mapsSettled.value : null;
    if (eventsSettled.status === 'rejected') this.addDiagnostic('google_events', eventsSettled.reason);
    if (mapsSettled.status === 'rejected') this.addDiagnostic('google_maps', mapsSettled.reason);
    const eventsBody = eventsResult?.body ?? {};
    const mapsBody = mapsResult?.body ?? {};
    const eventsSource = eventsResult
      ? sourceFor('serpapi_events', `Google events for ${query}`, queryUrl(`${query} events ${input.city.label}`), searchId(eventsBody), eventsResult.fetchedAt)
      : null;
    const mapsSource = mapsResult
      ? sourceFor('serpapi_maps', `Google Maps places for ${query}`, `https://www.google.com/maps/search/${encodeURIComponent(`${query} ${input.city.label}`)}`, searchId(mapsBody), mapsResult.fetchedAt)
      : null;
    if (eventsSource) this.sources.set(eventsSource.id, eventsSource);
    if (mapsSource) this.sources.set(mapsSource.id, mapsSource);
    const results: Candidate[] = [];
    if (eventsSource && eventsResult) for (const raw of list(eventsBody.events_results)) {
      if (!isRecord(raw)) continue;
      const eventTitle = str(raw.title);
      if (!eventTitle) continue;
      const startDateLabel = isRecord(raw.date) ? raw.date.start_date : raw.date;
      const date = resolveDate(startDateLabel, input.window, input.city.timeZone, eventsResult.fetchedAt);
      const timeLabel = str(raw.time) ?? (isRecord(raw.date) ? str(raw.date.when) : null);
      const startAt = date && timeLabel ? wallTimeToInstant(date, timeLabel, input.city.timeZone) : null;
      if (startAt && (startAt < input.window.startAt || startAt >= input.window.endAt)) continue;
      if (!startAt && !date) continue;
      const addresses = list(raw.address).map(str).filter((v): v is string => v !== null);
      const venue = str(raw.venue) ?? addresses[0] ?? 'Venue not specified';
      const cityPrefix = input.city.label.split(',')[0].trim().toLowerCase();
      const addressParts = addresses.flatMap(part => {
        let remaining = part.trim();
        if (remaining.toLowerCase() === venue.toLowerCase()) return [];
        if (remaining.toLowerCase().startsWith(`${cityPrefix},`)) return [];
        if (!/\d/.test(remaining) && remaining.toLowerCase().includes(cityPrefix)) return [];
        if (remaining.toLowerCase().startsWith(venue.toLowerCase())) {
          remaining = remaining.slice(venue.length).replace(/^[\s,–-]+/, '');
        }
        return remaining ? [remaining] : [];
      });
      const address = addressParts.length ? addressParts.join(', ') : null;
      const rawPriceText = str(raw.price);
      const currency = rawCurrency(rawPriceText, input.city.countryCode);
      const extractedPrice = typeof raw.extracted_price === 'number' && Number.isFinite(raw.extracted_price) ? raw.extracted_price : null;
      const amountMinor = extractedPrice === null ? null : Math.round(extractedPrice * 100);
      const price = currency === 'USD' && amountMinor !== null && Number.isSafeInteger(amountMinor) && amountMinor >= 0
        ? { amountMinor, currency: 'USD' as const } : null;
      const link = safeHttpUrl(raw.link);
      const stable = `${eventTitle}|${venue}|${date ?? ''}|${startAt ?? ''}|${link ?? ''}`.toLowerCase();
      results.push(candidate({ kind: 'event', title: eventTitle, venue, address, city: input.city, startAt,
        price, rawPriceText, rawCurrency: currency, source: eventsSource, stableKey: stable,
        computedFields: [...(startAt ? ['startAt'] : []), ...(price ? ['price'] : [])],
        // SerpApi event links are informational search/ticket pages, not validated merchant checkout URLs.
        bookingUrl: null }));
    }
    const mapRows = [...list(mapsBody.local_results), ...(isRecord(mapsBody.place_results) ? [mapsBody.place_results] : [])];
    if (mapsSource) for (const raw of mapRows) {
      if (!isRecord(raw)) continue;
      const title = str(raw.title);
      if (!title) continue;
      const address = str(raw.address);
      const link = safeHttpUrl(raw.website ?? raw.link);
      const stable = `${title}|${address ?? ''}|${link ?? ''}`.toLowerCase();
      results.push(candidate({ kind: 'venue', title, venue: title, address, city: input.city,
        source: mapsSource, stableKey: stable, bookingUrl: null }));
    }
    const unique = new Map<string, Candidate>();
    for (const item of results) unique.set(item.id, item);
    return [...unique.values()];
  }

  async extractPublicPage(rawUrl: string): Promise<{ source: Source; facts: unknown }> {
    const url = safeHttpUrl(rawUrl);
    if (!url || !isPublicWebUrl(url)) throw new TypeError('A public http or https URL is required');
    const search = await this.client.searchWithMetadata({ engine: 'extract', url, mode: 'scrape', include_markdown: 'true' });
    const body = search.body;
    const fetchedAt = search.fetchedAt;
    const source = sourceFor('serpapi_extract', `Extracted page: ${new URL(url).hostname}`, url, searchId(body), fetchedAt);
    this.sources.set(source.id, source);
    const facts = Object.fromEntries(Object.entries(body).filter(([key]) => !key.startsWith('search_')));
    return { source, facts };
  }
}

export function createSerpApiDiscovery(options: DiscoveryOptions = {}): SerpApiDiscovery { return new SerpApiDiscovery(options); }
