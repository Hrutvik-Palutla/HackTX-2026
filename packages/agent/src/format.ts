// Text helpers shared by the planner's option summary and the voting status the agent reads.
export const localTime = (iso: string, tz: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

/** Scraped page titles ("Extracted page: www.fandango.com", "... - Showtimes & tickets") read badly in a text thread. */
export function tidyTitle(title: string) {
  return title.replace(/Extracted page:\s*/i, '').replace(/\s*[-–|]\s*(showtimes|tickets)\b.*$/i, '')
    .replace(/\s+in\s+[A-Z][\w .'-]+,\s*[A-Z]{2}$/, '').replace(/\s{2,}/g, ' ').trim();
}
