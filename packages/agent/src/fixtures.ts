// LABELED FIXTURE discovery for local development and tests only. Every title says FIXTURE so it can never
// be mistaken for a SerpApi result. Replace with Part 4's adapter.
import type { Candidate, DiscoveryPort, Interval } from '@hacktx/contracts';

const at = (window: Interval, hoursFromStart: number) => new Date(Date.parse(window.startAt) + hoursFromStart * 3_600_000).toISOString();

function fixture(id: string, title: string, venue: string, startAt: string | null, cents: number | null, kind: Candidate['kind']): Candidate {
  return {
    id, kind, title: `FIXTURE: ${title}`, venueName: venue, address: null, timeZone: 'America/Chicago', startAt,
    durationMinutes: kind === 'movie_screening' ? 150 : null, format: null,
    price: cents === null ? null : { amountMinor: cents, currency: 'USD' }, rawPriceText: null, rawCurrency: null,
    priceKind: cents === null ? 'unknown' : 'listed', bookingUrl: null, sourceIds: [], evidence: [],
  };
}

export const fixtureDiscovery: DiscoveryPort = {
  async searchMovie({ title, window }) {
    return [
      fixture('fx-m1', `${title} (standard)`, 'Fixture Cinema North', at(window, 26), 1250, 'movie_screening'),
      fixture('fx-m2', `${title} (IMAX)`, 'Fixture Cinema South', at(window, 29), 1900, 'movie_screening'),
      fixture('fx-m3', `${title} (matinee)`, 'Fixture Cinema North', at(window, 20), 900, 'movie_screening'),
      fixture('fx-m4', `${title} (late)`, 'Fixture Cinema East', at(window, 32), null, 'movie_screening'),
    ];
  },
  async searchOutings({ query, window }) {
    return [
      fixture('fx-o1', `${query}: park picnic`, 'Fixture Park', null, 0, 'venue'),
      fixture('fx-o2', `${query}: bowling`, 'Fixture Lanes', at(window, 27), 2200, 'event'),
      fixture('fx-o3', `${query}: food hall`, 'Fixture Market', null, null, 'venue'),
    ];
  },
  async extractPublicPage() {
    throw new Error('fixture discovery has no extract');
  },
};
