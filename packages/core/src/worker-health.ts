import { and, eq, gt } from 'drizzle-orm';
import { workerHeartbeats, type Db } from '@hacktx/db';

export async function recordWorkerHeartbeat(db: Db, input: { id: string; role: 'work' | 'delivery'; revision: string; connected: boolean }) {
  await db.insert(workerHeartbeats).values({ ...input, updatedAt: new Date() })
    .onConflictDoUpdate({ target: workerHeartbeats.id, set: { ...input, updatedAt: new Date() } });
}

export async function workerReadiness(db: Db, revision: string, now = new Date()) {
  const rows = await db.select().from(workerHeartbeats).where(and(eq(workerHeartbeats.revision, revision), gt(workerHeartbeats.updatedAt, new Date(now.getTime() - 45_000))));
  const work = rows.some(row => row.role === 'work');
  const delivery = rows.some(row => row.role === 'delivery' && row.connected);
  return { ready: work && delivery, work, delivery };
}
