import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { messagingIdentities, user, type Db } from '@hacktx/db';
import { linkVerifiedPhones } from '@hacktx/core';
import { seedUsers, testDb } from './helpers';

let db: Db;
let ids: Record<string, string>;
beforeEach(async () => {
  db = await testDb();
  ids = await seedUsers(db, ['Sid', 'Edwin']);
  await db.update(user).set({ phoneNumber: '+12025550100', phoneNumberVerified: true }).where(eq(user.id, ids.Sid!));
  await db.update(user).set({ phoneNumber: '+16265550101', phoneNumberVerified: false }).where(eq(user.id, ids.Edwin!));
});

describe('linkVerifiedPhones', () => {
  it('links a handle to the account whose OTP-verified phone it is, idempotently', async () => {
    await linkVerifiedPhones(db, 'claw_messenger', ['+12025550100', '+12025550100']);
    await linkVerifiedPhones(db, 'claw_messenger', ['+12025550100']);
    const rows = await db.select().from(messagingIdentities);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: ids.Sid, provider: 'claw_messenger', handle: '+12025550100', kind: 'phone' });
    expect(rows[0]!.verifiedAt).not.toBeNull();
  });

  it('never links an unverified phone, an unknown number, or a non-phone handle', async () => {
    await linkVerifiedPhones(db, 'claw_messenger', ['+16265550101', '+15125559999', 'someone@icloud.com']);
    expect(await db.select().from(messagingIdentities)).toHaveLength(0);
  });

  it('upgrades an existing unverified identity for that handle', async () => {
    await db.insert(messagingIdentities).values({ userId: ids.Sid!, provider: 'claw_messenger', handle: '+12025550100', kind: 'phone', verifiedAt: null });
    await linkVerifiedPhones(db, 'claw_messenger', ['+12025550100']);
    const [row] = await db.select().from(messagingIdentities);
    expect(row!.verifiedAt).not.toBeNull();
  });
});
