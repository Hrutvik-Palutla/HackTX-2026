import { Pool } from 'pg';
import { createReadinessHandler } from '../../../lib/readiness';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = createReadinessHandler(() => new Pool({ connectionString: process.env.DATABASE_URL, max: 1,
  connectionTimeoutMillis: 5000, query_timeout: 5000, statement_timeout: 5000 }));
