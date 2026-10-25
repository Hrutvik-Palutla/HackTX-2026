import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, migrationsFolder, messagingIdentities, outbox, user, type Db } from '@hacktx/db';
import { open } from '@hacktx/core';
import { CLAW_PROVIDER } from './claw-adapter.ts';
import { maybeGreetStranger } from './stranger.ts';
import type { ClawInboundMessage } from './claw-messenger.ts';

process.env.APP_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
process.env.APP_BASE_URL ??= 'https://sidequest.test';

const LINE = '+12053690702';
const STRANGER = '+15125550177';
let db: Db;
beforeEach(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder });
  await db.insert(user).values({ id: 'u_alex', name: 'Alex', email: 'u_alex@users.invalid', emailVerified: false, phoneNumber: '+15125550100', phoneNumberVerified: true });
  await db.insert(user).values({ id: 'u_mel', name: 'Mel', email: 'u_mel@users.invalid', emailVerified: false });
  await db.insert(messagingIdentities).values({ userId: 'u_mel', provider: CLAW_PROVIDER, handle: 'mel@icloud.test', kind: 'email', verifiedAt: new Date() });
});

const msg = (over: Partial<ClawInboundMessage> = {}): ClawInboundMessage => ({
  type: 'message', messageId: `m-${Math.random()}`, chatId: 'chat-1', from: STRANGER, text: 'hey who is this', ...over,
});

describe('maybeGreetStranger', () => {
  it('greets an unknown private sender once per day, keeping the phone sealed', async () => {
    expect(await maybeGreetStranger(db, LINE, msg())).toBe(true);
    expect(await maybeGreetStranger(db, LINE, msg())).toBe(false);
    const rows = await db.select().from(outbox);
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(JSON.stringify(r)).not.toContain('5550177');
    expect(r.body).toBeNull();
    const rec = r.recipient as { kind: string; phoneEnc: string };
    expect(rec.kind).toBe('otp_phone');
    expect(open('phone', rec.phoneEnc)).toBe(STRANGER);
    expect(open('outbox', r.bodyEnc!)).toContain('https://sidequest.test/signup');
  });

  it('greets again on a new UTC day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-25T23:59:00Z'));
      expect(await maybeGreetStranger(db, LINE, msg())).toBe(true);
      vi.setSystemTime(new Date('2026-10-26T00:01:00Z'));
      expect(await maybeGreetStranger(db, LINE, msg())).toBe(true);
    } finally { vi.useRealTimers(); }
    expect(await db.select().from(outbox)).toHaveLength(2);
  });

  it('never greets group messages, known users, or our own line', async () => {
    expect(await maybeGreetStranger(db, LINE, msg({ isGroup: true }))).toBe(false);
    expect(await maybeGreetStranger(db, LINE, msg({ from: '+15125550100' }))).toBe(false); // verified account phone
    expect(await maybeGreetStranger(db, LINE, msg({ from: 'mel@icloud.test' }))).toBe(false); // verified identity
    expect(await maybeGreetStranger(db, LINE, msg({ from: LINE }))).toBe(false);
    expect(await db.select().from(outbox)).toHaveLength(0);
  });
});
