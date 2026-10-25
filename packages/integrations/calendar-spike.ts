// Manual Google Calendar check with a real account. Not used by the app.
//   pnpm exec tsx --env-file=.env packages/integrations/calendar-spike.ts
// Serves the real connect/callback handlers on localhost:3000 against an in-memory database, then prints how many
// busy blocks your primary calendar has over the next 7 days (counts and times only; no event titles exist in free/busy).
import { createServer } from 'node:http';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, migrationsFolder, user, type Db } from '@hacktx/db';
import { GoogleCalendar, connectionStatus, googleConfig } from './google-calendar.ts';
import { calendarCallback, configureCalendar, connectCalendar } from './calendar-http.ts';

const USER = 'spike-user';
const db = drizzle(new PGlite(), { schema }) as unknown as Db;
await migrate(db as never, { migrationsFolder });
await db.insert(user).values({ id: USER, name: 'Spike', email: 'spike@users.invalid' });
configureCalendar({ db, getUserId: async () => USER, env: { ...process.env, BETTER_AUTH_URL: 'http://localhost:3000' } });
const cfg = googleConfig();

const server = createServer(async (req, res) => {
  const url = `http://localhost:3000${req.url}`;
  const request = new Request(url, { headers: req.headers as Record<string, string> });
  const path = new URL(url).pathname;
  const response = path === '/api/calendar/connect' ? await connectCalendar(request)
    : path === '/api/calendar/callback' ? await calendarCallback(request)
    : path === '/settings' ? new Response('Calendar step finished. Check the terminal, then close this tab.')
    : new Response('not found', { status: 404 });
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(await response.text());
  if (path === '/settings') await report(new URL(url).searchParams.get('calendar'));
});

async function report(result: string | null) {
  console.log(`callback result: ${result}`);
  if (result === 'connected') {
    console.log('granted:', await connectionStatus(db, USER));
    const now = new Date();
    const window = { startAt: now.toISOString(), endAt: new Date(now.getTime() + 7 * 86_400_000).toISOString() };
    const busy = await new GoogleCalendar(db, cfg).getBusy(USER, window);
    console.log(`free/busy status: ${busy.status}; ${busy.busy.length} busy block(s) in the next 7 days`);
    for (const b of busy.busy.slice(0, 5)) console.log(`  busy ${b.startAt} -> ${b.endAt}`);
  }
  server.close();
  process.exit(0);
}

server.listen(3000, () => console.log('Open http://localhost:3000/api/calendar/connect?write=1 in your browser'));
