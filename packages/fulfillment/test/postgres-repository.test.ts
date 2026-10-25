import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PostgresRepository, type PgClient, type PgPool, type PgQueryResult } from '../src/postgres-repository.ts';
import { emptyState, type RepositoryState } from '../src/repository.ts';

type StoredRow = { [key: string]: unknown; payload: unknown };

class FakeDatabase implements PgPool {
  readonly tables = new Map<string, Map<string, StoredRow>>();
  readonly statements: { sql: string; values?: readonly unknown[] }[] = [];
  releases = 0;
  failOn: string | null = null;

  async query(): Promise<PgQueryResult> { throw new Error('adapter must acquire a client'); }
  async connect(): Promise<PgClient> {
    return {
      query: async (sql: string, values?: readonly unknown[]) => this.execute(sql, values),
      release: () => { this.releases += 1; },
    };
  }

  private async execute(sql: string, values?: readonly unknown[]): Promise<PgQueryResult> {
    this.statements.push({ sql, values });
    if (this.failOn && sql.includes(this.failOn)) throw new Error(`injected failure: ${this.failOn}`);
    if (/^BEGIN\b/i.test(sql) || /^(COMMIT|ROLLBACK)$/i.test(sql) || /pg_advisory_xact_lock/i.test(sql)) return { rows: [] };
    const select = sql.match(/^SELECT (\w+), payload FROM (\w+)$/i);
    if (select) {
      const [, idColumn, table] = select;
      return { rows: [...(this.tables.get(table!)?.values() ?? [])].map((row) => ({ [idColumn!]: row[idColumn!], payload: structuredClone(row.payload) })) };
    }
    const insert = sql.match(/^INSERT INTO (\w+) \(([^)]+)\)/i);
    if (insert) {
      const [, table, columnsText] = insert;
      const columns = columnsText!.split(',').map((column) => column.trim());
      const value = Object.fromEntries(columns.map((column, index) => [column, values?.[index]]));
      if (typeof value.payload === 'string') value.payload = JSON.parse(value.payload);
      const store = this.tables.get(table!) ?? new Map<string, StoredRow>();
      this.tables.set(table!, store);
      const idColumn = table === 'fulfillment_effects' ? 'effect_key' : 'id';
      const collision = table === 'fulfillment_reimbursements'
        ? [...store.entries()].find(([, row]) => row.booking_id === value.booking_id && row.payer_user_id === value.payer_user_id)
        : undefined;
      const id = String(value[idColumn]);
      if (collision && collision[0] !== id) throw new Error('unique booking,payer violation');
      store.set(id, value as StoredRow);
      return { rows: [] };
    }
    const deletion = sql.match(/^DELETE FROM (\w+) WHERE (\w+) = \$1$/i);
    if (deletion) {
      const [, table, idColumn] = deletion;
      this.tables.get(table!)?.delete(String(values?.[0]));
      return { rows: [] };
    }
    throw new Error(`unhandled SQL in fake client: ${sql}`);
  }
}

function assertStateEqual(actual: RepositoryState, expected: RepositoryState): void {
  assert.deepEqual(actual, expected);
}

test('read uses one read-only repeatable-read transaction and always releases the client', async () => {
  const db = new FakeDatabase();
  const repository = new PostgresRepository(db);
  const result = await repository.read((state) => state.schemaVersion);
  assert.equal(result, 1);
  assert.match(db.statements[0]!.sql, /^BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY$/);
  assert.equal(db.statements.at(-1)!.sql, 'COMMIT');
  assert.equal(db.statements.filter((statement) => statement.sql.startsWith('SELECT ') && statement.sql.includes('payload')).length, 7);
  assert.equal(db.releases, 1);
});

test('transaction takes advisory lock before snapshot reads and writes only changed records', async () => {
  const db = new FakeDatabase();
  const repository = new PostgresRepository(db);
  await repository.transact((state) => {
    state.effects['effect-1'] = { key: 'effect-1', planId: 'plan-1', kind: 'booking', state: 'started', createdAt: '2026-10-24T00:00:00Z', resultId: null };
  });
  const lockIndex = db.statements.findIndex((statement) => statement.sql.includes('pg_advisory_xact_lock'));
  const firstReadIndex = db.statements.findIndex((statement) => statement.sql.startsWith('SELECT ') && statement.sql.includes('payload'));
  assert.ok(lockIndex > 0 && lockIndex < firstReadIndex);
  assert.equal(db.statements.filter((statement) => statement.sql.startsWith('INSERT INTO')).length, 1);
  assert.equal(db.statements.at(-1)!.sql, 'COMMIT');

  await repository.transact((state) => { state.effects['effect-1']!.state = 'confirmed'; });
  assert.equal(db.statements.filter((statement) => statement.sql.startsWith('INSERT INTO')).length, 2);
  const loaded = await repository.read((state) => state);
  assert.equal(loaded.effects['effect-1']!.state, 'confirmed');
});

test('callback failures and asynchronous callbacks roll back and release reliably', async () => {
  const db = new FakeDatabase();
  const repository = new PostgresRepository(db);
  await assert.rejects(repository.transact(() => { throw new Error('callback failed'); }), /callback failed/);
  assert.equal(db.statements.at(-1)!.sql, 'ROLLBACK');
  assert.equal(db.releases, 1);

  await assert.rejects(repository.transact((async (_state: RepositoryState) => undefined) as unknown as (state: RepositoryState) => unknown), /callbacks must be synchronous/);
  assert.equal(db.statements.at(-1)!.sql, 'ROLLBACK');
  assert.equal(db.releases, 2);

  db.failOn = 'INSERT INTO';
  await assert.rejects(repository.transact((state) => {
    state.effects['write-fails'] = { key: 'write-fails', planId: 'plan-1', kind: 'quote', state: 'started', createdAt: '2026-10-24T00:00:00Z', resultId: null };
  }), /injected failure/);
  assert.equal(db.statements.at(-1)!.sql, 'ROLLBACK');
  assert.equal(db.releases, 3);
});

test('reimbursement uniqueness is enforced by the owned migration', async () => {
  const sql = await readFile(new URL('../sql/001_part4.sql', import.meta.url), 'utf8');
  assert.match(sql, /UNIQUE \(booking_id, payer_user_id\)/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS fulfillment_reimbursements_plan_id_idx/);
  assert.doesNotMatch(sql, /\bREFERENCES\b/i);
});

test('transaction state starts from an empty contract state', async () => {
  const db = new FakeDatabase();
  const repository = new PostgresRepository(db);
  assertStateEqual(await repository.read((state) => state), emptyState());
});

test('round-trips all owned records and derives indexed plan IDs from quote/booking records', async () => {
  const db = new FakeDatabase();
  const repository = new PostgresRepository(db);
  const state = emptyState();
  const quote = {
    id: 'quote-1', planId: 'plan-1', versionId: 'v1', optionId: 'o1', attendeeUserIds: ['buyer'], buyerUserId: 'buyer',
    merchantHost: 'tickets.example', merchantUrl: 'https://tickets.example/checkout', performanceRef: null,
    seatRefs: ['A1'], lineItems: [{ attendeeUserId: 'buyer', label: 'ticket', amount: { amountMinor: 1000, currency: 'USD' as const } }],
    sharedFees: { amountMinor: 0, currency: 'USD' as const }, sharedDiscount: { amountMinor: 0, currency: 'USD' as const },
    total: { amountMinor: 1000, currency: 'USD' as const }, expiresAt: '2026-10-25T00:00:00Z', bindingHash: 'hash', mode: 'test' as const,
  };
  state.quotes[quote.id] = { quote, inputRevision: 3, effectKey: 'effect-quote' };
  state.authorizations.auth1 = { id: 'auth1', quoteId: quote.id, buyerUserId: 'buyer', walletRequestId: 'wallet1', status: 'approved', approvedBindingHash: 'hash', checkedAt: '2026-10-24T00:00:00Z', mode: 'test' };
  state.bookings.booking1 = { id: 'booking1', planId: 'plan-1', versionId: 'v1', quoteId: quote.id, authorizationId: 'auth1', status: 'test_confirmed', merchantOrderRef: null, confirmationUrl: null, actualTotal: { amountMinor: 1000, currency: 'USD' }, mode: 'test' };
  state.reimbursements.reimb1 = { id: 'reimb1', bookingId: 'booking1', payerUserId: 'friend', recipientUserId: 'buyer', amount: { amountMinor: 500, currency: 'USD' }, paymentUrl: null, status: 'draft', confirmationSource: 'none', mode: 'test' };
  state.effects.effect1 = { key: 'effect1', planId: 'plan-1', kind: 'booking', state: 'confirmed', createdAt: '2026-10-24T00:00:00Z', resultId: 'booking1' };
  state.deliveries.delivery1 = { id: 'delivery1', planId: 'plan-1', bookingId: 'booking1', recipientUserId: 'friend', text: 'Your share is $5.00', mode: 'test', status: 'pending' };
  state.changes.change1 = { id: 'change1', planId: 'plan-1', requestedBy: 'buyer', text: 'Need an earlier show', createdAt: '2026-10-24T00:00:00Z', status: 'requested' };
  await repository.transact((next) => Object.assign(next, state));
  const loaded = await repository.read((snapshot) => snapshot);
  assertStateEqual(loaded, state);
  assert.equal(db.tables.get('fulfillment_reimbursements')!.get('reimb1')!.plan_id, 'plan-1');
  assert.equal(db.tables.get('fulfillment_authorizations')!.get('auth1')!.plan_id, 'plan-1');
});
