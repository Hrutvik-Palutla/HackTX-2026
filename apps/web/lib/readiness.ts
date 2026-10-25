type Connection = {
  query(text: string, values?: unknown[]): Promise<{ rows: Array<{ role?: string; connected?: boolean }> }>;
  end(): Promise<unknown>;
};

export function createReadinessHandler(connect: () => Connection, env = process.env) {
  return async () => {
    const headers = { 'Cache-Control': 'no-store' };
    if (!env.DATABASE_URL) return Response.json({ status: 'unconfigured' }, { status: 503, headers });
    const pool = connect();
    try {
      await pool.query('SELECT "emailVerified", "phoneNumberVerified" FROM "user" LIMIT 0');
      if (env.REQUIRE_WORKER_READY === 'true') {
        const result = await pool.query("SELECT role, bool_or(connected) AS connected FROM worker_heartbeats WHERE revision=$1 AND updated_at > now()-interval '45 seconds' GROUP BY role", [env.SOURCE_REVISION ?? 'local']);
        const work = result.rows.some(row => row.role === 'work');
        const delivery = result.rows.some(row => row.role === 'delivery' && row.connected);
        if (!work || !delivery) return Response.json({ status: 'worker_unavailable', worker: { work, delivery } }, { status: 503, headers });
      }
      return Response.json({ status: 'ready', revision: env.SOURCE_REVISION ?? 'local', phoneDeliveryConfigured: !!env.CLAW_MESSENGER_API_KEY,
        calendarConfigured: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) }, { headers });
    } catch { return Response.json({ status: 'database_unavailable' }, { status: 503, headers }); }
    finally { await pool.end(); }
  };
}
