// Durable Postgres job queue: FOR UPDATE SKIP LOCKED claims with leases. No Redis.
import { sql, eq, and } from 'drizzle-orm';
import { jobs, outbox, externalEffects, type Db } from '@hacktx/db';
import type { JobKind, OutboundRecipient } from '@hacktx/contracts';
import { seal } from './crypto';

export type Job = typeof jobs.$inferSelect;

// Kinds that mutate plan state run one at a time per plan (revision CAS is still the real guard).
const SERIAL_KINDS = ['process_inbound', 'plan', 'repair', 'handle_change'];

/** Insert a job; a repeated dedupeKey is a no-op (webhook retries, double clicks). Returns true if new. */
export async function enqueue(
  db: Db,
  job: { kind: JobKind; dedupeKey: string; payload?: unknown; planId?: string | null; runAfter?: Date; maxAttempts?: number },
): Promise<boolean> {
  const rows = await db
    .insert(jobs)
    .values({
      kind: job.kind,
      dedupeKey: job.dedupeKey,
      payload: job.payload ?? {},
      planId: job.planId ?? null,
      runAfter: job.runAfter ?? new Date(),
      maxAttempts: job.maxAttempts ?? 5,
    })
    .onConflictDoNothing({ target: jobs.dedupeKey })
    .returning({ id: jobs.id });
  return rows.length > 0;
}

/** Claim one runnable job (queued, or running with an expired lease). */
export async function claim(db: Db, workerId: string, leaseMs = 90_000, kinds?: JobKind[]): Promise<Job | null> {
  const kindFilter = kinds?.length ? sql`and j.kind in ${kinds}` : sql``;
  const res = await db.execute(sql`
    update jobs set state = 'running', leased_by = ${workerId}, attempts = attempts + 1,
      lease_until = now() + (${leaseMs} * interval '1 millisecond'), updated_at = now()
    where id = (
      select j.id from jobs j
      where ((j.state = 'queued' and j.run_after <= now())
          or (j.state = 'running' and j.lease_until < now() and j.attempts < j.max_attempts))
        ${kindFilter}
        and not (j.kind in ${SERIAL_KINDS} and j.plan_id is not null and exists (
          select 1 from jobs r where r.plan_id = j.plan_id and r.id <> j.id and r.state = 'running'
            and r.lease_until >= now() and r.kind in ${SERIAL_KINDS}))
      order by j.run_after
      limit 1
      for update skip locked
    )
    returning id`);
  const id = (res as unknown as { rows: { id: string }[] }).rows[0]?.id;
  if (!id) return null;
  const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
  return job ?? null;
}

export async function heartbeat(db: Db, job: Job, leaseMs = 90_000) {
  await db.execute(sql`update jobs set lease_until = now() + (${leaseMs} * interval '1 millisecond')
    where id = ${job.id} and leased_by = ${job.leasedBy} and state = 'running'`);
}

export async function complete(db: Db, job: Job) {
  await db.update(jobs).set({ state: 'done', leaseUntil: null, updatedAt: new Date() })
    .where(and(eq(jobs.id, job.id), eq(jobs.leasedBy, job.leasedBy!)));
}

/** Retry with exponential backoff, or mark failed once attempts are exhausted / error is permanent. */
export async function fail(db: Db, job: Job, err: unknown, retryable = true) {
  const message = err instanceof Error ? err.message : String(err);
  const done = !retryable || job.attempts >= job.maxAttempts;
  const backoffMs = Math.min(60_000, 1000 * 2 ** job.attempts);
  await db.update(jobs).set({
    state: done ? 'failed' : 'queued',
    lastError: message.slice(0, 500),
    leaseUntil: null,
    runAfter: new Date(Date.now() + backoffMs),
    updatedAt: new Date(),
  }).where(and(eq(jobs.id, job.id), eq(jobs.leasedBy, job.leasedBy!)));
}

/**
 * Queue a recipient-scoped message plus its send job (call inside the same transaction as the state change).
 * Private/invite bodies are encrypted at rest; group bodies are public by definition.
 */
export async function enqueueMessage(
  db: Db,
  msg: { recipient: OutboundRecipient; text: string; effectKey: string; planId?: string | null; versionId?: string | null; expiresAt?: Date },
) {
  const isGroup = msg.recipient.kind === 'group';
  const rows = await db.insert(outbox).values({
    recipient: msg.recipient,
    planId: msg.planId ?? null,
    versionId: msg.versionId ?? null,
    effectKey: msg.effectKey,
    body: isGroup ? msg.text : null,
    bodyEnc: isGroup ? null : seal('outbox', msg.text),
    expiresAt: msg.expiresAt ?? null,
  }).onConflictDoNothing({ target: outbox.effectKey }).returning({ id: outbox.id });
  if (rows[0]) {
    await enqueue(db, { kind: 'send_outbox', dedupeKey: `send_outbox:${msg.effectKey}`, payload: { outboxId: rows[0].id }, planId: msg.planId ?? null });
  }
  return rows[0]?.id ?? null;
}

/** Reserve a unique external side effect before performing it. `fresh=false` means someone already did/is doing it. */
export async function reserveEffect(db: Db, e: { operationKey: string; kind: string; planId?: string | null; quoteId?: string | null }) {
  const rows = await db.insert(externalEffects).values({
    operationKey: e.operationKey, kind: e.kind, planId: e.planId ?? null, quoteId: e.quoteId ?? null,
  }).onConflictDoNothing({ target: externalEffects.operationKey }).returning();
  if (rows[0]) return { fresh: true as const, effect: rows[0] };
  const [existing] = await db.select().from(externalEffects).where(eq(externalEffects.operationKey, e.operationKey));
  return { fresh: false as const, effect: existing! };
}
