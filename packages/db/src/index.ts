import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema';

export { schema };
export * from './schema';

/** Any drizzle Postgres handle or transaction (node-postgres in prod, PGlite in tests). */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export function createDb(url = process.env.DATABASE_URL): { db: Db; pool: pg.Pool } {
  if (!url) throw new Error('DATABASE_URL is not set');
  // Small pool: web + worker share one Tiger/Postgres instance.
  const pool = new pg.Pool({ connectionString: url, max: 5 });
  return { db: drizzle(pool, { schema }), pool };
}

// Plain path math (not `new URL('../x', import.meta.url)`) so bundlers like Next's webpack don't try to bundle the folder.
export const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');
