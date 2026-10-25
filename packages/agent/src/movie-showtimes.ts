import { createHash } from 'node:crypto';
import type { Candidate, City, Source } from '@hacktx/contracts';

type PageExtraction = { source: Source; facts: unknown };

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function pageText(facts: unknown): string {
  const root = record(facts);
  const content = record(root?.text_content);
  const values = [root?.markdown, root?.text, content?.markdown, content?.text, root?.content]
    .filter((value): value is string => typeof value === 'string');
  return [...new Set(values)].join('\n');
}

function norm(value: string): string { return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' '); }

/** Accept only a date with an explicit year and a clock value found on the same page line as the exact title. */
export function movieTimesOnPage(title: string, facts: unknown): Array<{ date: string; time: string }> {
  const date = String.raw`(?:\b\d{4}-\d{2}-\d{2}\b|\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}\b)`;
  const clock = String.raw`\b(?:1[0-2]|0?[1-9]):[0-5]\d\s*(?:a\.?m\.?|p\.?m\.?)\b`;
  const out: Array<{ date: string; time: string }> = [];
  const wanted = norm(title);
  for (const line of pageText(facts).split(/\n+/)) {
    if (!(` ${norm(line)} `).includes(` ${wanted} `)) continue;
    const d = line.match(new RegExp(date, 'i'))?.[0];
    const t = line.match(new RegExp(clock, 'i'))?.[0];
    if (d && t) out.push({ date: d, time: t.replace(/\s+/g, ' ').trim() });
  }
  return out;
}

function toUtc(dateText: string, timeText: string, timeZone: string): string | null {
  const isoDate = dateText.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const namedDate = dateText.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  let parsedDate: string | null = null;
  if (isoDate) {
    const [, year, month, day] = isoDate;
    const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (parsed.getUTCFullYear() === Number(year) && parsed.getUTCMonth() + 1 === Number(month) && parsed.getUTCDate() === Number(day)) parsedDate = dateText;
  } else if (namedDate) {
    const monthIndex = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(namedDate[1]!.slice(0, 3).toLowerCase());
    const day = Number(namedDate[2]); const year = Number(namedDate[3]);
    const parsed = new Date(Date.UTC(year, monthIndex, day));
    if (monthIndex >= 0 && parsed.getUTCFullYear() === year && parsed.getUTCMonth() === monthIndex && parsed.getUTCDate() === day) {
      parsedDate = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  if (!parsedDate) return null;
  const time = timeText.match(/^(\d{1,2}):(\d{2})\s*([ap])\.?m\.?$/i);
  if (!time) return null;
  let hour = Number(time[1]) % 12;
  if (time[3]!.toLowerCase() === 'p') hour += 12;
  const minute = Number(time[2]);
  // Resolve a page's local wall time against the city's IANA zone without guessing its offset.
  const target = `${parsedDate}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
  let guess = Date.parse(`${target}Z`);
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(guess));
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    const represented = Date.parse(`${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:00Z`);
    const wanted = Date.parse(`${target}Z`);
    guess += wanted - represented;
  }
  const result = new Date(guess).toISOString();
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(guess));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  if (`${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}` !== `${target.slice(0, 10)}T${target.slice(11, 16)}`) return null;
  for (const alternate of [guess - 3_600_000, guess + 3_600_000]) {
    const alt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(alternate));
    const altValues = Object.fromEntries(alt.map(part => [part.type, part.value]));
    if (`${altValues.year}-${altValues.month}-${altValues.day}T${altValues.hour}:${altValues.minute}` === `${target.slice(0, 10)}T${target.slice(11, 16)}`) return null;
  }
  return result;
}

export function candidateFromMoviePage(input: { title: string; city: City; page: PageExtraction; time: { date: string; time: string } | null }): Candidate {
  const { title, city, page, time } = input;
  const foundTitle = page.source.title || title;
  const startAt = time ? toUtc(time.date, time.time, city.timeZone) : null;
  const id = `movie_page_${createHash('sha256').update(`${page.source.id}|${startAt ?? 'unknown'}`).digest('hex').slice(0, 24)}`;
  const fields = ['title', 'venueName', 'timeZone', ...(startAt ? ['startAt'] : [])];
  return {
    id, kind: 'movie_screening', title, venueName: foundTitle, address: null, timeZone: city.timeZone,
    startAt, durationMinutes: null, format: null, price: null, rawPriceText: null, rawCurrency: null,
    priceKind: 'unknown', bookingUrl: null, sourceIds: [page.source.id],
    evidence: fields.map(field => ({ field, origin: field === 'timeZone' ? 'user' as const : 'source' as const, sourceId: field === 'timeZone' ? null : page.source.id, sourceMessageId: null })),
  };
}
