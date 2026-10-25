import { Pool } from 'pg';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  if (!process.env.DATABASE_URL) return Response.json({ status: 'unconfigured' }, { status: 503 });
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000, query_timeout: 5000, statement_timeout: 5000 });
  try {
    await pool.query('SELECT "emailVerified", "phoneNumberVerified" FROM "user" LIMIT 0');
    return Response.json({ status: 'ready', revision: process.env.SOURCE_REVISION ?? 'local', phoneDeliveryConfigured: Boolean(process.env.CLAW_MESSENGER_API_KEY), calendarConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ status: 'database_unavailable' }, { status: 503 }); }
  finally { await pool.end(); }
}
