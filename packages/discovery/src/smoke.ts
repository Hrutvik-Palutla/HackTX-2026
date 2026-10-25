import { SerpApiDiscovery } from './index.ts';
import type { City, Interval } from '../../fulfillment/src/types.ts';

function requireEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`Set ${key} to run the SerpApi discovery smoke check`);
  return value;
}

const city: City = {
  label: requireEnv('DISCOVERY_CITY'),
  countryCode: process.env.DISCOVERY_COUNTRY_CODE?.trim() || 'us',
  latitude: null,
  longitude: null,
  timeZone: requireEnv('DISCOVERY_TIME_ZONE'),
};
const window: Interval = { startAt: requireEnv('DISCOVERY_START_AT'), endAt: requireEnv('DISCOVERY_END_AT') };
const discovery = new SerpApiDiscovery();
const mode = process.env.DISCOVERY_SMOKE_MODE ?? 'outing';
const candidates = mode === 'movie'
  ? await discovery.searchMovie({ title: requireEnv('DISCOVERY_MOVIE_TITLE'), city, window })
  : await discovery.searchOutings({ query: process.env.DISCOVERY_QUERY?.trim() || 'live music', city, window });

process.stdout.write(`${JSON.stringify({
  candidateCount: candidates.length,
  candidates: candidates.slice(0, 20).map(({ id, kind, title, venueName, address, timeZone, startAt, format, price, priceKind, sourceIds }) => ({
    id, kind, title, venueName, address, timeZone, startAt, format, price, priceKind, sourceIds,
  })),
  sources: discovery.getSources().slice(0, 10),
  diagnostics: discovery.getDiagnostics(),
}, null, 2)}\n`);
