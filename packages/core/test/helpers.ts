// Real Postgres (PGlite, in-process) with the generated migrations applied. No Docker needed.
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, migrationsFolder, user, friendships, type Db } from '@hacktx/db';
import type { ActorContext, City } from '@hacktx/contracts';

process.env.APP_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');

export const austin: City = { label: 'Austin, Texas, United States', countryCode: 'US', latitude: 30.27, longitude: -97.74, timeZone: 'America/Chicago' };

export async function testDb(): Promise<Db> {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

export async function seedUsers(db: Db, names: string[]) {
  const ids: Record<string, string> = {};
  for (const name of names) {
    const id = `u_${name.toLowerCase()}`;
    await db.insert(user).values({ id, name, email: `${id}@users.invalid`, city: austin });
    ids[name] = id;
  }
  return ids;
}

export async function befriend(db: Db, a: string, b: string, status = 'accepted') {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  await db.insert(friendships).values({ userLow: lo, userHigh: hi, requestedBy: a, status, acceptedAt: status === 'accepted' ? new Date() : null });
}

export const web = (userId: string): ActorContext => ({ userId, source: 'web' });
