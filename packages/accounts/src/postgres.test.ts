import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decryptPhone,
  phoneDigest,
  postgresAccounts,
  type AccountDatabase,
  type SqlConnection,
} from "./index.js";

type Row = Record<string, unknown>;

function makeDatabase(handle: (sql: string, values: unknown[]) => Row[]) {
  const queries: { sql: string; values: unknown[]; tx: boolean }[] = [];
  let commits = 0;
  let rollbacks = 0;
  const tx: SqlConnection = {
    async query<T extends Row = Row>(sql: string, values: unknown[] = []) {
      queries.push({ sql, values, tx: true });
      return { rows: handle(sql, values) as T[], rowCount: 1 };
    },
  };
  const db: AccountDatabase = {
    async query<T extends Row = Row>(sql: string, values: unknown[] = []) {
      queries.push({ sql, values, tx: false });
      return { rows: handle(sql, values) as T[], rowCount: 1 };
    },
    async transaction<T>(operation: (connection: SqlConnection) => Promise<T>) {
      try {
        const result = await operation(tx);
        commits += 1;
        return result;
      } catch (error) {
        rollbacks += 1;
        throw error;
      }
    },
  };
  return {
    db,
    tx,
    queries,
    get commits() { return commits; },
    get rollbacks() { return rollbacks; },
  };
}

const keys = {
  encryptionKey: Buffer.alloc(32, 7),
  lookupKey: "test-lookup-key-long-enough-for-hmac",
};

test("invite-created callback runs after insert in the same transaction", async () => {
  const harness = makeDatabase((sql) => {
    if (sql.includes("COUNT(*)")) return [{ count: 0 }];
    if (sql.includes('SELECT id FROM "user"')) return [{ id: "organizer" }];
    return [];
  });
  let callbackTx: SqlConnection | undefined;
  let callbackInvite: unknown;
  const repo = postgresAccounts(
    harness.db,
    keys,
    undefined,
    async (tx, invite) => {
      callbackTx = tx;
      callbackInvite = invite;
      await tx.query("QUEUE_INVITATION", [invite.invitationId]);
    },
  );
  const created = await repo.createRequest("organizer", "+15125550143");
  assert.ok(created);
  assert.equal(callbackTx, harness.tx);
  assert.deepEqual(callbackInvite, {
    invitationId: created.id,
    token: created.token,
    phoneE164: "+15125550143",
    inviterId: "organizer",
  });
  const insertIndex = harness.queries.findIndex((row) =>
    row.sql.includes("INSERT INTO friend_invites"),
  );
  const queueIndex = harness.queries.findIndex((row) =>
    row.sql.includes("QUEUE_INVITATION"),
  );
  assert.ok(insertIndex >= 0 && queueIndex > insertIndex);
  const values = harness.queries[insertIndex]!.values;
  assert.notEqual(values[2], "+15125550143");
  assert.equal(decryptPhone(String(values[2]), keys.encryptionKey), "+15125550143");
  assert.equal(values[3], phoneDigest("+15125550143", keys.lookupKey));
  assert.notEqual(values[4], created.token);
  assert.equal(harness.commits, 1);
  assert.equal(harness.rollbacks, 0);
});

test("invite-delivery failure rolls back invite creation", async () => {
  const harness = makeDatabase((sql) =>
    sql.includes("COUNT(*)")
      ? [{ count: 0 }]
      : sql.includes('SELECT id FROM "user"')
        ? [{ id: "organizer" }]
        : [],
  );
  const repo = postgresAccounts(harness.db, keys, undefined, async () => {
    throw Error("outbox unavailable");
  });
  await assert.rejects(
    repo.createRequest("organizer", "+15125550143"),
    /outbox unavailable/,
  );
  assert.equal(harness.commits, 0);
  assert.equal(harness.rollbacks, 1);
});

test("acceptance binds invite seats and calls resume callback with invitation ID", async () => {
  const harness = makeDatabase((sql) => {
    if (sql.includes('SELECT id FROM "user"')) return [{ id: "recipient" }];
    if (sql.includes("UPDATE friend_invites"))
      return [{ id: "invite-1", inviter_id: "organizer" }];
    return [];
  });
  let callbackTx: SqlConnection | undefined;
  let callbackUsers: unknown;
  const repo = postgresAccounts(harness.db, keys, async (tx, users) => {
    callbackTx = tx;
    callbackUsers = users;
    await tx.query("QUEUE_RESUME", [users.invitationId]);
  });
  const accepted = await repo.resolveRequest(
    "invite-token",
    "+15125550143",
    "accepted",
    Date.now(),
    "recipient",
  );
  assert.equal(accepted, true);
  const removeDuplicateIndex = harness.queries.findIndex((row) =>
    row.sql.includes("DELETE FROM plan_participants seat"),
  );
  const bindSeatIndex = harness.queries.findIndex((row) =>
    row.sql.includes("UPDATE plan_participants SET user_id=$2 WHERE invite_id=$1"),
  );
  const resumeIndex = harness.queries.findIndex((row) =>
    row.sql.includes("QUEUE_RESUME"),
  );
  assert.ok(removeDuplicateIndex >= 0 && bindSeatIndex > removeDuplicateIndex);
  assert.ok(resumeIndex > bindSeatIndex);
  assert.deepEqual(harness.queries[bindSeatIndex]!.values, ["invite-1", "recipient"]);
  assert.deepEqual(callbackUsers, {
    inviterId: "organizer",
    recipientId: "recipient",
    invitationId: "invite-1",
  });
  assert.equal(callbackTx, harness.tx);
  assert.equal(harness.commits, 1);
});
