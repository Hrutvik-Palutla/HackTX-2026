import { describe, expect, it } from 'vitest';
import type { PlanOption, Source } from '@hacktx/contracts';
import { formatOptions, tidyTitle } from '../src/planner';

const base = { timeZone: 'America/Chicago', timeline: [], estimatedPerPerson: null, priceKind: 'unknown', fit: 'needs_clarification', uncertainties: ['Showtime not confirmed; check source page'], publicExplanation: 'Venue is AMC unlike the other listed sources.', candidateIds: [] } as const;
const opt = (label: 'A' | 'B' | 'C', title: string, sourceIds: string[], startAt: string | null = null) =>
  ({ ...base, id: label, label, title, startAt, endAt: null, sourceIds }) as unknown as PlanOption;
const src = (id: string, url: string) => ({ id, url, title: id }) as unknown as Source;

describe('formatOptions', () => {
  it('cleans scraped titles', () => {
    expect(tidyTitle('Extracted page: www.fandango.com')).toBe('www.fandango.com');
    expect(tidyTitle('Clayface - Showtimes & tickets')).toBe('Clayface');
    expect(tidyTitle('Clayface at AMC DINE-IN Tech Ridge 10 in Austin, TX')).toBe('Clayface at AMC DINE-IN Tech Ridge 10');
  });

  it('writes one line per option, one question and at most two links, without explanation or warning noise', () => {
    const text = formatOptions(
      [opt('A', 'Clayface at AMC Tech Ridge 10 in Austin, TX', ['s1']), opt('B', 'Clayface - Showtimes & tickets', ['s2']), opt('C', 'Clayface at Alamo', ['s3'])],
      undefined, [src('s1', 'https://a.example/1'), src('s2', 'https://b.example/2'), src('s3', 'https://c.example/3')], 'movie');
    expect(text).toContain('A) Clayface at AMC Tech Ridge 10, time to confirm');
    expect(text).toContain('B) Clayface, time to confirm');
    expect(text).not.toMatch(/⚠|Venue is|unlike|price unknown|Vote in the poll/);
    expect(text.match(/https?:\/\//g)).toHaveLength(2);
    expect(text.match(/\?/g)).toHaveLength(1);
    expect(text.trimEnd().split('\n').at(-1)).toMatch(/^https:/);
  });

  it('says "Updated" after a repair and shows the time when it is known', () => {
    const text = formatOptions([opt('A', 'Clayface at AMC', [], '2026-10-25T00:00:00.000Z')], 'private constraint changed');
    expect(text.startsWith('Updated:')).toBe(true);
    expect(text).toMatch(/A\) Clayface at AMC, .*7:00 PM/);
    expect(text).not.toContain('What time works best');
  });
});
