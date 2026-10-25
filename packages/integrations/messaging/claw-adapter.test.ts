import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import {
  schema, migrationsFolder, conversationMembers, conversations, planConversations, externalEffects, inboundEvents, jobs, messages, messagingIdentities, outbox, plans,
  planVersions, user, type Db,
} from '@hacktx/db';
import { enqueueMessage, type Job } from '@hacktx/core';
import {
  CLAW_PROVIDER, createClawGroup, createPublishPollHandler, createSendOutboxHandler, formatTextPoll, ingestClawMessage, toInboundMessage,
} from './claw-adapter.ts';
import type { ClawInboundMessage, ClawSendResult, SendTarget } from './claw-messenger.ts';

process.env.APP_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');

const LINE = '+12053690702';
const austin = { label: 'Austin, Texas, United States', countryCode: 'US', latitude: 30.27, longitude: -97.74, timeZone: 'America/Chicago' };

let db: Db;
beforeEach(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder });
  await db.insert(user).values({ id: 'u_alex', name: 'Alex', email: 'u_alex@users.invalid', city: austin, phoneNumber: '+15125550100', phoneNumberVerified: true });
});

const inbound = (over: Partial<ClawInboundMessage> = {}): ClawInboundMessage => ({
  type: 'message', messageId: 'm1', chatId: 'chat-1', from: '+15125550100', text: 'lets do friday', sentAt: '2026-10-24T23:00:00.000Z', ...over,
});

class FakeClient {
  sent: { target: SendTarget; text: string }[] = [];
  next: (() => Promise<ClawSendResult>) | null = null;
  async send(target: SendTarget, text: string, opts: { id?: string } = {}) {
    this.sent.push({ target, text });
    if (this.next) { const n = this.next; this.next = null; return n(); }
    return { type: 'send.result' as const, id: opts.id ?? 'x', ok: true, status: 'accepted' as const, messageId: `pm-${this.sent.length}` };
  }
}

const jobFor = async (kind: string): Promise<Job> => {
  const [j] = await db.select().from(jobs).where(eq(jobs.kind, kind));
  return j!;
};

async function clawGroup() {
  const [c] = await db.insert(conversations).values({ provider: CLAW_PROVIDER, sendingLine: LINE, externalChatId: 'chat-g', kind: 'group' }).returning();
  return c!;
}

describe('inbound', () => {
  it('normalizes private and group messages', () => {
    expect(toInboundMessage(inbound()).conversationKind).toBe('private');
    const g = toInboundMessage(inbound({ isGroup: true, replyTo: { messageId: 'm0' } }));
    expect(g).toMatchObject({ conversationKind: 'group', conversationExternalId: 'chat-1', senderKind: 'phone', replyToMessageId: 'm0' });
  });

  it('queues each provider message once and keeps text out of inbound_events', async () => {
    expect(await ingestClawMessage(db, LINE, inbound())).toBe(true);
    expect(await ingestClawMessage(db, LINE, inbound({ replay: true }))).toBe(false); // sync replay
    const evs = await db.select().from(inboundEvents);
    expect(evs).toHaveLength(1);
    expect(JSON.stringify(evs[0]!.payload)).not.toContain('friday');
    expect(JSON.stringify(evs[0]!.payload)).not.toContain('5550100');
    const queued = await db.select().from(jobs).where(eq(jobs.kind, 'process_inbound'));
    expect(queued).toHaveLength(1);
    expect(queued[0]!.dedupeKey).toBe(`${CLAW_PROVIDER}:m1`);
    expect(queued[0]!.payload).toMatchObject({ sendingLine: LINE, message: { provider: CLAW_PROVIDER, text: 'lets do friday' } });
  });

  it('ignores messages from our own line', async () => {
    expect(await ingestClawMessage(db, LINE, inbound({ from: LINE }))).toBe(false);
    expect(await db.select().from(jobs)).toHaveLength(0);
  });
});

describe('send_outbox', () => {
  it('sends a group message by chat ID exactly once', async () => {
    const conv = await clawGroup();
    await enqueueMessage(db, { recipient: { kind: 'group', conversationId: conv.id }, text: 'Here are 3 options', effectKey: 'k1' });
    const client = new FakeClient();
    const send = createSendOutboxHandler(client);
    const job = await jobFor('send_outbox');
    await send({ db, job });
    await send({ db, job }); // redelivered job
    expect(client.sent).toEqual([{ target: { chatId: 'chat-g' }, text: 'Here are 3 options' }]);
    const [row] = await db.select().from(outbox);
    expect(row).toMatchObject({ status: 'sent', providerMessageId: 'pm-1' });
    const [eff] = await db.select().from(externalEffects);
    expect(eff!.state).toBe('confirmed');
  });

  it('sends private messages to the verified handle, decrypting the body', async () => {
    await db.insert(messagingIdentities).values({ userId: 'u_alex', provider: CLAW_PROVIDER, handle: '+15125550199', kind: 'phone', verifiedAt: new Date() });
    await enqueueMessage(db, { recipient: { kind: 'private', userId: 'u_alex' }, text: 'When does your appointment end?', effectKey: 'k2' });
    const client = new FakeClient();
    await createSendOutboxHandler(client)({ db, job: await jobFor('send_outbox') });
    expect(client.sent[0]).toEqual({ target: { to: '+15125550199' }, text: 'When does your appointment end?' });
  });

  it('falls back to the verified account phone, and refuses unverified recipients', async () => {
    await enqueueMessage(db, { recipient: { kind: 'private', userId: 'u_alex' }, text: 'hi', effectKey: 'k3' });
    const client = new FakeClient();
    await createSendOutboxHandler(client)({ db, job: await jobFor('send_outbox') });
    expect(client.sent[0]!.target).toEqual({ to: '+15125550100' });

    await db.insert(user).values({ id: 'u_new', name: 'New', email: 'u_new@users.invalid', city: austin, phoneNumber: '+15125550111' });
    await db.delete(jobs);
    await enqueueMessage(db, { recipient: { kind: 'private', userId: 'u_new' }, text: 'hi', effectKey: 'k4' });
    await expect(createSendOutboxHandler(client)({ db, job: await jobFor('send_outbox') })).rejects.toMatchObject({ code: 'UNRESOLVED' });
  });

  it('never resends after an ambiguous timeout', async () => {
    const conv = await clawGroup();
    await enqueueMessage(db, { recipient: { kind: 'group', conversationId: conv.id }, text: 'x', effectKey: 'k5' });
    const client = new FakeClient();
    client.next = () => Promise.reject(new Error('timed out'));
    const send = createSendOutboxHandler(client);
    const job = await jobFor('send_outbox');
    await expect(send({ db, job })).rejects.toMatchObject({ code: 'PROVIDER', retryable: false });
    await send({ db, job }); // a retry must not send again
    expect(client.sent).toHaveLength(1);
    expect((await db.select().from(outbox))[0]!.status).toBe('unknown');
  });

  it('retries when the provider says it did not send', async () => {
    const conv = await clawGroup();
    await enqueueMessage(db, { recipient: { kind: 'group', conversationId: conv.id }, text: 'x', effectKey: 'k6' });
    const client = new FakeClient();
    client.next = async () => ({ type: 'send.result', id: 'x', ok: false, status: 'failed', retryable: true, errorCode: 'busy' });
    const send = createSendOutboxHandler(client);
    const job = await jobFor('send_outbox');
    await expect(send({ db, job })).rejects.toMatchObject({ retryable: true });
    await send({ db, job });
    expect(client.sent).toHaveLength(2);
    expect((await db.select().from(outbox))[0]!.status).toBe('sent');
  });

  it('drops expired messages without sending', async () => {
    const conv = await clawGroup();
    await enqueueMessage(db, { recipient: { kind: 'group', conversationId: conv.id }, text: 'code 123456', effectKey: 'k7', expiresAt: new Date(Date.now() - 1000) });
    const client = new FakeClient();
    await createSendOutboxHandler(client)({ db, job: await jobFor('send_outbox') });
    expect(client.sent).toHaveLength(0);
    expect((await db.select().from(outbox))[0]!.status).toBe('failed');
  });
});

describe('publish_poll', () => {
  async function planWithVersion() {
    const [p] = await db.insert(plans).values({ organizerUserId: 'u_alex', request: 'movie', templateId: 'movie-night', city: austin, timeZone: 'America/Chicago', status: 'voting' }).returning();
    const [v] = await db.insert(planVersions).values({ planId: p!.id, versionNumber: 1, inputRevision: 0 }).returning();
    await db.update(plans).set({ activeVersionId: v!.id }).where(eq(plans.id, p!.id));
    return { planId: p!.id, versionId: v!.id };
  }

  it('posts a text poll to the group through the transcript and outbox', async () => {
    const conv = await clawGroup();
    const { planId, versionId } = await planWithVersion();
    const labels = ['A) Avengers 7pm', 'B) Avengers 9pm'];
    const job = { payload: { planId, versionId, conversationId: conv.id, labels } } as unknown as Job;
    await createPublishPollHandler()({ db, job });
    await createPublishPollHandler()({ db, job }); // retried job
    const rows = await db.select().from(outbox);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.body).toBe(formatTextPoll(labels));
    expect(rows[0]!.recipient).toEqual({ kind: 'group', conversationId: conv.id });
    expect(await db.select().from(messages)).toHaveLength(1); // agent message kept in the transcript
  });

  it('skips a poll for a superseded version', async () => {
    const conv = await clawGroup();
    const { planId } = await planWithVersion();
    const job = { payload: { planId, versionId: '00000000-0000-0000-0000-000000000000', conversationId: conv.id, labels: ['A) x'] } } as unknown as Job;
    await createPublishPollHandler()({ db, job });
    expect(await db.select().from(outbox)).toHaveLength(0);
  });
});


describe('added to a group', () => {
  it('flags only the first message from a new group as joinedGroup and posts nothing itself', async () => {
    const g = (id: string) => inbound({ messageId: id, chatId: 'chat-new', isGroup: true, participants: ['+15125550100', '+15125550101', LINE] });
    await ingestClawMessage(db, LINE, g('g1'));
    await ingestClawMessage(db, LINE, g('g2'));
    const queued = await db.select().from(jobs).where(eq(jobs.kind, 'process_inbound'));
    expect(queued.map((j) => (j.payload as { joinedGroup: boolean }).joinedGroup)).toEqual([true, false]);
    expect(await db.select().from(outbox)).toHaveLength(0);
  });

  it('does not greet private chats', async () => {
    await ingestClawMessage(db, LINE, inbound());
    expect(await db.select().from(outbox)).toHaveLength(0);
  });

  it('tracks members (excluding the agent) and who left', async () => {
    await db.insert(messagingIdentities).values({ userId: 'u_alex', provider: CLAW_PROVIDER, handle: '+15125550100', kind: 'phone', verifiedAt: new Date() });
    await ingestClawMessage(db, LINE, inbound({ messageId: 'a', chatId: 'c', isGroup: true, participants: ['+15125550100', '+15125550101', LINE] }));
    await ingestClawMessage(db, LINE, inbound({ messageId: 'b', chatId: 'c', isGroup: true, participants: ['+15125550100', LINE] }));
    const members = await db.select().from(conversationMembers);
    expect(members.map((m) => [m.unresolvedHandle, m.isCurrent, !!m.messagingIdentityId]).sort()).toEqual([
      ['+15125550100', true, true], ['+15125550101', false, false],
    ]);
  });
});

describe('createClawGroup', () => {
  it('creates the chat by sending to every member and links it to the plan', async () => {
    const [p] = await db.insert(plans).values({ organizerUserId: 'u_alex', request: 'movie', templateId: 'movie-night', city: austin, timeZone: 'America/Chicago', status: 'voting' }).returning();
    const client = new FakeClient();
    client.next = async () => ({ type: 'send.result', id: 'x', ok: true, status: 'accepted', messageId: 'pm', chatId: 'chat-made' });
    const r = await createClawGroup(db, client, { sendingLine: LINE, memberHandles: ['+15125550100', '+15125550101'], introText: 'Hi all', planId: p!.id });
    expect(client.sent[0]).toEqual({ target: { to: ['+15125550100', '+15125550101'] }, text: 'Hi all' });
    const [link] = await db.select().from(planConversations);
    expect(link).toMatchObject({ planId: p!.id, conversationId: r.conversationId, audience: 'group' });
  });
});
