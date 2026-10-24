import { emptyState } from './repository.ts';
import type { RepositoryState, FulfillmentRepository } from './repository.ts';
import type { BookingResult, BookingQuote, BuyerAuthorization, Reimbursement } from './types.ts';
import type { ChangeRequest, Effect, PrivateDelivery, QuoteRecord } from './repository.ts';

/** Minimal subset of node-postgres accepted by this adapter; no pg dependency is imported. */
export type PgQueryResult = { rows: Record<string, unknown>[] };
export interface PgQueryable {
  query(sql: string, values?: readonly unknown[]): Promise<PgQueryResult>;
}
export interface PgClient extends PgQueryable {
  release(): void;
}
export interface PgPool extends PgQueryable {
  connect(): Promise<PgClient>;
}

const ADVISORY_LOCK_ID = '73194206731841';

type Bucket = Exclude<keyof RepositoryState, 'schemaVersion'>;
type StateRow = { id: string; planId: string; payload: unknown };
type TableSpec = {
  bucket: Bucket;
  table: string;
  idColumn: string;
  row: (id: string, value: unknown, state: RepositoryState) => StateRow;
};

const specs: readonly TableSpec[] = [
  { bucket: 'quotes', table: 'fulfillment_quotes', idColumn: 'id', row: (id, value) => ({ id, planId: (value as QuoteRecord).quote.planId, payload: value }) },
  { bucket: 'authorizations', table: 'fulfillment_authorizations', idColumn: 'id', row: (id, value, state) => {
    const authorization = value as BuyerAuthorization;
    const quote = state.quotes[authorization.quoteId];
    if (!quote) throw new Error(`authorization ${id} references a quote missing from repository state`);
    return { id, planId: quote.quote.planId, payload: value };
  } },
  { bucket: 'bookings', table: 'fulfillment_bookings', idColumn: 'id', row: (id, value) => ({ id, planId: (value as BookingResult).planId, payload: value }) },
  { bucket: 'reimbursements', table: 'fulfillment_reimbursements', idColumn: 'id', row: (id, value, state) => {
    const reimbursement = value as Reimbursement;
    const booking = state.bookings[reimbursement.bookingId];
    if (!booking) throw new Error(`reimbursement ${id} references a booking missing from repository state`);
    return { id, planId: booking.planId, payload: value };
  } },
  { bucket: 'effects', table: 'fulfillment_effects', idColumn: 'effect_key', row: (id, value) => ({ id, planId: (value as Effect).planId, payload: value }) },
  { bucket: 'deliveries', table: 'fulfillment_private_deliveries', idColumn: 'id', row: (id, value) => ({ id, planId: (value as PrivateDelivery).planId, payload: value }) },
  { bucket: 'changes', table: 'fulfillment_changes', idColumn: 'id', row: (id, value) => ({ id, planId: (value as ChangeRequest).planId, payload: value }) },
];

const deleteOrder: readonly Bucket[] = ['reimbursements', 'bookings', 'authorizations', 'quotes', 'effects', 'deliveries', 'changes'];

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (typeof value === 'object' && value !== null || typeof value === 'function')
    && typeof (value as { then?: unknown }).then === 'function';
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? String(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
}

function bucketRecords(state: RepositoryState, bucket: Bucket): Record<string, unknown> {
  return state[bucket] as Record<string, unknown>;
}

function parsePayload(row: Record<string, unknown>, table: string): unknown {
  const payload = row.payload;
  if (typeof payload === 'string') {
    try { return JSON.parse(payload) as unknown; }
    catch { throw new Error(`invalid JSON payload in ${table}`); }
  }
  if (payload === null || typeof payload !== 'object') throw new Error(`invalid JSON payload in ${table}`);
  return payload;
}

async function loadState(client: PgQueryable): Promise<RepositoryState> {
  const state = emptyState();
  for (const spec of specs) {
    const result = await client.query(`SELECT ${spec.idColumn}, payload FROM ${spec.table}`);
    const records = bucketRecords(state, spec.bucket);
    for (const row of result.rows) {
      const id = row[spec.idColumn];
      if (typeof id !== 'string' || id.length === 0) throw new Error(`invalid ID in ${spec.table}`);
      if (Object.hasOwn(records, id)) throw new Error(`duplicate ID in ${spec.table}`);
      records[id] = parsePayload(row, spec.table);
    }
  }
  return state;
}

function assertSchema(state: RepositoryState): void {
  if (!state || state.schemaVersion !== 1) throw new Error('Unsupported fulfillment repository state schema.');
  for (const spec of specs) {
    const bucket = bucketRecords(state, spec.bucket);
    if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) {
      throw new TypeError(`repository state bucket ${spec.bucket} must be an object`);
    }
  }
}

async function deleteRow(client: PgQueryable, bucket: Bucket, id: string): Promise<void> {
  const spec = specs.find((item) => item.bucket === bucket)!;
  await client.query(`DELETE FROM ${spec.table} WHERE ${spec.idColumn} = $1`, [id]);
}

async function upsertRow(client: PgQueryable, spec: TableSpec, row: StateRow): Promise<void> {
  if (!row.id || !row.planId) throw new TypeError(`${spec.bucket} rows require an ID and plan ID`);
  if (spec.bucket === 'reimbursements') {
    const reimbursement = row.payload as Reimbursement;
    if (!reimbursement.bookingId || !reimbursement.payerUserId) throw new TypeError('reimbursement rows require booking and payer IDs');
    await client.query(
      `INSERT INTO ${spec.table} (id, plan_id, booking_id, payer_user_id, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (id) DO UPDATE SET plan_id = EXCLUDED.plan_id, booking_id = EXCLUDED.booking_id,
         payer_user_id = EXCLUDED.payer_user_id, payload = EXCLUDED.payload`,
      [row.id, row.planId, reimbursement.bookingId, reimbursement.payerUserId, JSON.stringify(row.payload)],
    );
    return;
  }
  const idColumn = spec.idColumn;
  await client.query(
    `INSERT INTO ${spec.table} (${idColumn}, plan_id, payload) VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (${idColumn}) DO UPDATE SET plan_id = EXCLUDED.plan_id, payload = EXCLUDED.payload`,
    [row.id, row.planId, JSON.stringify(row.payload)],
  );
}

async function syncState(client: PgQueryable, before: RepositoryState, after: RepositoryState): Promise<void> {
  assertSchema(after);
  for (const bucket of deleteOrder) {
    const prior = bucketRecords(before, bucket);
    const next = bucketRecords(after, bucket);
    for (const id of Object.keys(prior)) if (!Object.hasOwn(next, id)) await deleteRow(client, bucket, id);
  }
  for (const spec of specs) {
    const prior = bucketRecords(before, spec.bucket);
    const next = bucketRecords(after, spec.bucket);
    for (const [id, value] of Object.entries(next)) {
      if (Object.hasOwn(prior, id) && canonicalJson(prior[id]) === canonicalJson(value)) continue;
      await upsertRow(client, spec, spec.row(id, value, after));
    }
  }
}

async function finish<T>(client: PgClient, work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  finally { client.release(); }
}

export class PostgresRepository implements FulfillmentRepository {
  private readonly pool: PgPool;
  constructor(pool: PgPool) { this.pool = pool; }

  async read<T>(fn: (state: Readonly<RepositoryState>) => T): Promise<T> {
    const client = await this.pool.connect();
    return finish(client, async () => {
      let inTransaction = false;
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        inTransaction = true;
        const state = await loadState(client);
        const result = fn(structuredClone(state));
        if (isThenable(result)) throw new Error('Repository callbacks must be synchronous.');
        const snapshot = structuredClone(result);
        await client.query('COMMIT');
        inTransaction = false;
        return snapshot;
      } catch (error) {
        if (inTransaction) {
          try { await client.query('ROLLBACK'); } catch { /* retain the original failure */ }
        }
        throw error;
      }
    });
  }

  async transact<T>(fn: (state: RepositoryState) => T): Promise<T> {
    const client = await this.pool.connect();
    return finish(client, async () => {
      let inTransaction = false;
      try {
        await client.query('BEGIN');
        inTransaction = true;
        await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [ADVISORY_LOCK_ID]);
        const before = await loadState(client);
        const after = structuredClone(before);
        const result = fn(after);
        if (isThenable(result)) throw new Error('Repository callbacks must be synchronous.');
        await syncState(client, before, after);
        const snapshot = structuredClone(result);
        await client.query('COMMIT');
        inTransaction = false;
        return snapshot;
      } catch (error) {
        if (inTransaction) {
          try { await client.query('ROLLBACK'); } catch { /* retain the original failure */ }
        }
        throw error;
      }
    });
  }
}
