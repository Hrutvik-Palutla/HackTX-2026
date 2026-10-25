import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import { schema, migrationsFolder, jobs, messagingIdentities, outbox, user, type Db } from '@hacktx/db';
import type { Job } from '@hacktx/core';
import { CLAW_PROVIDER, createSendOutboxHandler } from './claw-adapter.ts';
import { createOtpSender, linkVerifiedPhone, otpText } from './otp.ts';
import type { ClawSendResult, SendTarget } from './claw-messenger.ts';

process.env.APP_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');

let db: Db;
beforeEach(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder });
});

const sent: { target: SendTarget; text: string }[] = [];
const client = {
  async send(target: SendTarget, text: string): Promise<ClawSendResult> {
    sent.push({ target, text });
    return { type: 'send.result', id: 'x', ok: true, status: 'accepted', messageId: 'pm' };
  },
};
const sendJob = async () => (await db.select().from(jobs).where(eq(jobs.kind, 'send_outbox')))[0]! as Job;
const otp = { phoneE164: '+15125550123', code: '482913', expiresInSeconds: 300, purpose: 'account_verification' as const };

describe('OTP sender', () => {
  beforeEach(() => { sent.length = 0; });

  it('queues the code encrypted, sends it privately, then wipes it', async () => {
    await createOtpSender(db)(otp);
    const [row] = await db.select().from(outbox);
    const stored = JSON.stringify(row);
    expect(stored).not.toContain('482913');
    expect(stored).not.toContain('5550123');
    expect(row!.body).toBeNull();
    expect(row!.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 290_000);

    await createSendOutboxHandler(client)({ db, job: await sendJob() });
    expect(sent).toEqual([{ target: { to: '+15125550123' }, text: otpText('482913', 300) }]);
    const [after] = await db.select().from(outbox);
    expect(after).toMatchObject({ status: 'sent', bodyEnc: null });
  });

  it('queues a repeated call for the same code once', async () => {
    const send = createOtpSender(db);
    await send(otp);
    await send(otp);
    expect(await db.select().from(outbox)).toHaveLength(1);
    expect(await db.select().from(jobs)).toHaveLength(1);
  });

  it('never sends an expired code', async () => {
    await createOtpSender(db)({ ...otp, expiresInSeconds: 300 });
    await db.update(outbox).set({ expiresAt: new Date(Date.now() - 1000) });
    await createSendOutboxHandler(client)({ db, job: await sendJob() });
    expect(sent).toHaveLength(0);
    expect((await db.select().from(outbox))[0]).toMatchObject({ status: 'failed', bodyEnc: null });
  });

  it('rejects a non-E.164 phone so Better Auth fails the request', async () => {
    await expect(createOtpSender(db)({ ...otp, phoneE164: '5125550123' })).rejects.toThrow();
    expect(await db.select().from(outbox)).toHaveLength(0);
  });

  it('links the verified phone as the iMessage handle', async () => {
    await db.insert(user).values({ id: 'u1', name: 'A', email: 'u1@users.invalid' });
    await linkVerifiedPhone(db, 'u1', '+15125550123');
    await linkVerifiedPhone(db, 'u1', '+15125550123');
    const ids = await db.select().from(messagingIdentities);
    expect(ids).toHaveLength(1);
    expect(ids[0]).toMatchObject({ provider: CLAW_PROVIDER, handle: '+15125550123', kind: 'phone' });
    expect(ids[0]!.verifiedAt).not.toBeNull();
  });
});
