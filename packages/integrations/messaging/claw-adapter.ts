// Claw Messenger <-> Part 2's durable state. Inbound socket messages become `process_inbound` jobs;
// `send_outbox` and `publish_poll` jobs go out through the same socket.
// Claw Messenger has no native polls, so a poll is a text prompt and votes come back as chat replies
// that Part 2's conversation handler records through its vote tool.
import { decryptPhone } from '@muse/accounts';
import { createHash } from 'node:crypto';
import { and, eq, inArray, isNotNull, max, sql } from 'drizzle-orm';
import {
  conversationMembers, conversations, friendInvites, inboundEvents, messages, messagingIdentities, outbox, planConversations, planParticipants,
  plans, user, externalEffects, type Db,
} from '@hacktx/db';
import { AGENT_HANDLE, AppError, configurePlanGroupCreator, enqueue, open, postToConversation, reserveEffect, seal, linkVerifiedPhones, type Job } from '@hacktx/core';
import { OutboundRecipient, type InboundMessage, type MessagingPort } from '@hacktx/contracts';
import { ClawMessengerClient, type ClawInboundMessage, type SendTarget } from './claw-messenger.ts';
import { maybeGreetStranger } from './stranger.ts';

export const CLAW_PROVIDER = 'claw_messenger' as const;

export const clawCapabilities: MessagingPort['capabilities'] = {
  createGroup: true, coldInvite: true, nativePoll: false, identifiedVotes: true, contextualGroupMessages: true,
};

type Sender = Pick<ClawMessengerClient, 'send'>;
type Handler = (ctx: { db: Db; job: Job }) => Promise<void>;

export function toInboundMessage(m: ClawInboundMessage): InboundMessage {
  return {
    provider: CLAW_PROVIDER,
    eventId: m.messageId,
    messageId: m.messageId,
    conversationExternalId: m.chatId,
    conversationKind: m.isGroup ? 'group' : 'private', // private messages omit isGroup
    senderHandle: m.from,
    senderKind: m.from.includes('@') ? 'email' : 'phone',
    text: m.text ?? '',
    occurredAt: m.sentAt ?? new Date().toISOString(),
    replyToMessageId: m.replyTo?.messageId ?? null,
  };
}

/**
 * Store one inbound message durably and queue it, exactly once per provider message ID
 * (Claw replays on reconnect/sync). Returns false for duplicates and our own line.
 */
export async function ingestClawMessage(db: Db, sendingLine: string, m: ClawInboundMessage): Promise<boolean> {
  if (m.from === sendingLine) return false;
  const message = toInboundMessage(m);
  return db.transaction(async (tx) => {
    const rows = await tx.insert(inboundEvents).values({
      provider: CLAW_PROVIDER,
      eventId: m.messageId,
      envelopeHash: createHash('sha256').update(JSON.stringify(m)).digest('hex'),
      // No text or phone numbers here: the message body is stored (encrypted when private) by process_inbound.
      payload: { messageId: m.messageId, chatId: m.chatId, isGroup: !!m.isGroup, service: m.service ?? null, sentAt: m.sentAt ?? null },
    }).onConflictDoNothing().returning({ id: inboundEvents.id });
    if (!rows[0]) return false;
    const joinedGroup = m.isGroup ? await onGroupMessage(tx as unknown as Db, sendingLine, m) : false;
    if (!m.isGroup) await maybeGreetStranger(tx as unknown as Db, sendingLine, m);
    await tx.insert(conversations).values({ provider: CLAW_PROVIDER, sendingLine, externalChatId: m.chatId, kind: m.isGroup ? 'group' : 'private' }).onConflictDoNothing();
    const [conversation] = await tx.select({ id: conversations.id, activePlanId: conversations.activePlanId }).from(conversations).where(and(
      eq(conversations.provider, CLAW_PROVIDER), eq(conversations.sendingLine, sendingLine), eq(conversations.externalChatId, m.chatId)));
    await enqueue(tx as unknown as Db, { kind: 'process_inbound', planId: conversation!.activePlanId, conversationId: conversation!.id, dedupeKey: `${CLAW_PROVIDER}:${m.messageId}`, payload: { encryptedInbound: seal('inbound', JSON.stringify({ sendingLine, message, joinedGroup, replayed: Boolean(m.replay) })) } });
    return true;
  });
}

export { GROUP_INTRO } from '@hacktx/agent';

/**
 * Claw has no "added to group" event: the first message from an unseen group chat means we were just added.
 * Greet once (the agent can't see anything sent before it joined) and keep the member list current.
 * Membership is context only; it never proves a friendship or attendance.
 */
async function onGroupMessage(db: Db, sendingLine: string, m: ClawInboundMessage): Promise<boolean> {
  const created = await db.insert(conversations).values({ provider: CLAW_PROVIDER, sendingLine, externalChatId: m.chatId, kind: 'group' })
    .onConflictDoNothing().returning();
  const [conv] = created.length ? created : await db.select().from(conversations).where(and(
    eq(conversations.provider, CLAW_PROVIDER), eq(conversations.sendingLine, sendingLine), eq(conversations.externalChatId, m.chatId),
  ));
  if (!conv) return false;
  await syncMembers(db, conv.id, [...new Set([...(m.participants ?? []), m.from])].filter(h => h !== sendingLine), m.participants !== undefined);
  return created.length > 0;
}

async function syncMembers(db: Db, conversationId: string, handles: string[], complete = true) {
  await db.update(conversations).set({ membershipComplete: complete }).where(eq(conversations.id, conversationId));
  await linkVerifiedPhones(db, CLAW_PROVIDER, handles); // members with verified accounts get named, even before they speak
  const current = await db.select().from(conversationMembers).where(eq(conversationMembers.conversationId, conversationId));
  const idents = handles.length ? await db.select().from(messagingIdentities)
    .where(and(eq(messagingIdentities.provider, CLAW_PROVIDER), inArray(messagingIdentities.handle, handles))) : [];
  for (const h of handles) {
    const identId = idents.find((i) => i.handle === h)?.id ?? null;
    const row = current.find((c) => c.unresolvedHandle === h);
    if (!row) await db.insert(conversationMembers).values({ conversationId, messagingIdentityId: identId, unresolvedHandle: h });
    else if (!row.isCurrent || row.messagingIdentityId !== identId) {
      await db.update(conversationMembers).set({ isCurrent: true, messagingIdentityId: identId }).where(eq(conversationMembers.id, row.id));
    }
  }
  for (const gone of (complete ? current : []).filter((c) => c.isCurrent && c.unresolvedHandle && !handles.includes(c.unresolvedHandle))) {
    await db.update(conversationMembers).set({ isCurrent: false }).where(eq(conversationMembers.id, gone.id));
  }
}

/**
 * Create an iMessage group with the given members (the private-request flow). Claw creates the chat when a
 * message is sent to several numbers; the first message must be plain text without links.
 */
export async function createClawGroup(db: Db, client: Sender, o: { sendingLine: string; memberHandles: string[]; introText: string; planId: string }) {
  if (o.memberHandles.length < 2) throw new AppError('INVALID', 'a group needs at least two other members');
  const res = await client.send({ to: o.memberHandles }, o.introText);
  if (!res.ok || res.status !== 'accepted' || !res.chatId) throw new AppError('PROVIDER', `group creation failed: ${res.errorCode ?? res.status}`, !!res.retryable);
  const [conv] = await db.insert(conversations).values({
    provider: CLAW_PROVIDER, sendingLine: o.sendingLine, externalChatId: res.chatId, kind: 'group', activePlanId: o.planId,
  }).onConflictDoUpdate({ target: [conversations.provider, conversations.sendingLine, conversations.externalChatId], set: { activePlanId: o.planId } }).returning();
  await db.insert(planConversations).values({ planId: o.planId, conversationId: conv!.id, audience: 'group' }).onConflictDoNothing();
  await syncMembers(db, conv!.id, o.memberHandles);
  return { chatId: res.chatId, conversationId: conv!.id };
}

/** Where an outbox recipient is reached on Claw Messenger. */
async function resolveTarget(db: Db, r: OutboundRecipient): Promise<SendTarget> {
  if (r.kind === 'otp_phone') return { to: open('phone', r.phoneEnc) };
  if (r.kind === 'group') {
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, r.conversationId));
    if (!conv || conv.provider !== CLAW_PROVIDER) throw new AppError('UNRESOLVED', 'group conversation is not a Claw Messenger chat');
    return { chatId: conv.externalChatId };
  }
  if (r.kind === 'invite') {
    const [inv] = await db.select().from(friendInvites).where(eq(friendInvites.id, r.invitationId));
    if (!inv) throw new AppError('UNRESOLVED', 'invite not found');
    return { to: inv.recipientPhoneEnc.startsWith('v1.') ? open('phone', inv.recipientPhoneEnc) : decryptPhone(inv.recipientPhoneEnc, Buffer.from(process.env.APP_ENCRYPTION_KEY ?? '', 'base64')) };
  }
  // Private: the user's verified iMessage handle, else their verified account phone.
  const [ident] = await db.select({ handle: messagingIdentities.handle }).from(messagingIdentities).where(and(
    eq(messagingIdentities.provider, CLAW_PROVIDER), eq(messagingIdentities.userId, r.userId), isNotNull(messagingIdentities.verifiedAt),
  ));
  if (ident) return { to: ident.handle };
  const [u] = await db.select({ phone: user.phoneNumber, verified: user.phoneNumberVerified }).from(user).where(eq(user.id, r.userId));
  if (u?.phone && u.verified) return { to: u.phone };
  if (r.conversationId) {
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, r.conversationId));
    if (conv?.provider === CLAW_PROVIDER && conv.kind === 'private') return { chatId: conv.externalChatId };
  }
  throw new AppError('UNRESOLVED', 'recipient has no verified iMessage handle');
}

const setEffect = (db: Db, id: string, state: string, providerRequestId?: string) =>
  db.update(externalEffects).set({ state, ...(providerRequestId ? { providerRequestId } : {}), updatedAt: new Date() }).where(eq(externalEffects.id, id));
const setOutbox = (db: Db, id: string, status: string, providerMessageId?: string) =>
  db.update(outbox).set({
    status, ...(providerMessageId ? { providerMessageId } : {}), updatedAt: new Date(),
    // Once a message is final, an expiring body (OTP) is no longer needed: wipe it.
    ...(status !== 'pending' ? { bodyEnc: sql`case when ${outbox.expiresAt} is not null then null else ${outbox.bodyEnc} end` } : {}),
  }).where(eq(outbox.id, id));

/**
 * `send_outbox`: deliver one outbox row. The external effect is marked inflight before the send, so a crash or
 * timeout mid-send leaves it `unknown` and is never blindly resent (no duplicate texts).
 */
export function createSendOutboxHandler(client: Sender): Handler {
  return async ({ db, job }) => {
    const { outboxId } = job.payload as { outboxId: string };
    const [row] = await db.select().from(outbox).where(eq(outbox.id, outboxId));
    if (!row || row.status === 'sent' || row.status === 'failed' || row.status === 'unknown') return;
    if (row.expiresAt && row.expiresAt < new Date()) { await setOutbox(db, row.id, 'failed'); return; } // e.g. stale OTP
    const recipient = OutboundRecipient.parse(row.recipient);
    if (row.effectKey.startsWith('web-group:')) {
      if (recipient.kind !== 'group') { await setOutbox(db, row.id, 'failed'); return; }
      const [conv] = await db.select({ planId: conversations.activePlanId }).from(conversations).where(eq(conversations.id, recipient.conversationId));
      if (!conv || conv.planId !== row.planId) { await setOutbox(db, row.id, 'failed'); return; }
    }

    const { effect } = await reserveEffect(db, { operationKey: `send:${row.effectKey}`, kind: 'message_send', planId: row.planId });
    if (effect.state === 'confirmed') { await setOutbox(db, row.id, 'sent', effect.providerRequestId ?? undefined); return; }
    if (effect.state !== 'reserved') {
      await setOutbox(db, row.id, 'unknown');
      throw new AppError('PROVIDER', `send ${row.effectKey} outcome unknown after an interrupted attempt; not resending`);
    }

    const target = await resolveTarget(db, recipient);
    const text = row.body ?? open('outbox', row.bodyEnc!);
    await setEffect(db, effect.id, 'inflight');
    let res;
    try {
      res = await client.send(target, text, { id: row.id });
    } catch (e) {
      await setEffect(db, effect.id, 'unknown');
      await setOutbox(db, row.id, 'unknown');
      throw new AppError('PROVIDER', `send ${row.effectKey}: delivery uncertain; not resending`);
    }
    if (res.status === 'not_confirmed') {
      await setEffect(db, effect.id, 'unknown');
      await setOutbox(db, row.id, 'unknown');
      throw new AppError('PROVIDER', 'Message delivery is uncertain; not resending.');
    }
    if (res.ok && res.status === 'accepted') {
      await setEffect(db, effect.id, 'confirmed', res.messageId);
      await setOutbox(db, row.id, 'sent', res.messageId);
      return;
    }
    if (res.retryable) {
      await setEffect(db, effect.id, 'reserved'); // provider said it did not send; safe to try again
      throw new AppError('PROVIDER', `send ${row.effectKey} rejected (${res.errorCode ?? res.status}); will retry`, true);
    }
    await setEffect(db, effect.id, 'failed');
    await setOutbox(db, row.id, 'failed');
    throw new AppError('PROVIDER', `send ${row.effectKey} failed: ${res.errorCode ?? res.status}`);
  };
}

/** The options are posted right above, so the poll only names the letters. */
export function formatTextPoll(labels: string[]) {
  const letters = labels.map((l) => l.split(')')[0]!.trim()).join(', ');
  return `🗳 Vote: reply with every option that works for you (${letters}), plus "favorite" for your top pick, e.g. "A C, favorite C". Reply "none" if nothing works.`;
}

/**
 * `publish_poll`: no native polls on Claw Messenger, so post the voting prompt into the group. It goes through
 * the transcript + outbox like any agent message, so retries never double-post. Obsolete versions are skipped.
 */
export function createPublishPollHandler(): Handler {
  return async ({ db, job }) => {
    const p = job.payload as { planId: string; versionId: string; conversationId: string; labels: string[] };
    const [plan] = await db.select({ activeVersionId: plans.activeVersionId }).from(plans).where(eq(plans.id, p.planId));
    if (plan?.activeVersionId !== p.versionId) return;
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, p.conversationId));
    if (!conv || conv.provider !== CLAW_PROVIDER) return;
    await postToConversation(db, conv, formatTextPoll(p.labels), {
      effectKey: `poll:${p.versionId}:${conv.id}`, planId: p.planId, versionId: p.versionId,
    });
  };
}

/**
 * Worker entry point: connects to Claw Messenger, ingests inbound messages, and returns the job handlers to register.
 * Returns null when CLAW_MESSENGER_API_KEY / CLAW_MESSENGER_FROM_PHONE are not configured.
 */
export async function startClawMessenger(opts: { db: Db; env?: NodeJS.ProcessEnv; log?: (m: string) => void }) {
  const env = opts.env ?? process.env;
  const apiKey = env.CLAW_MESSENGER_API_KEY;
  const log = opts.log ?? ((m: string) => console.log(m));
  // Claw allows several WebSocket consumers per account. Never let a local worker that
  // happens to have production credentials compete with the designated hosted listener.
  if (env.CLAW_LISTENER_ENABLED !== 'true') {
    if (apiKey) log('[claw] listener disabled; set CLAW_LISTENER_ENABLED=true only for the designated listener');
    return null;
  }
  // Claw chooses the provider's sender. This is a local routing namespace, not an outbound `from` field.
  const sendingLine = env.CLAW_MESSENGER_FROM_PHONE || 'claw-default';
  if (!apiKey) return null;

  // Replay anything received while we were offline; ingestion dedupes by message ID.
  const [last] = await opts.db.select({ at: max(inboundEvents.receivedAt) }).from(inboundEvents).where(eq(inboundEvents.provider, CLAW_PROVIDER));
  let lastAt: Date | null = last?.at ?? null;
  const since = () => (lastAt ? new Date(lastAt.getTime() - 60_000).toISOString() : null); // 1 min overlap for clock skew

  const client = new ClawMessengerClient({
    apiKey,
    url: env.CLAW_MESSENGER_URL || undefined,
    service: 'iMessage',
    log,
    syncSince: since,
    onMessage: async (m) => {
      const fresh = await ingestClawMessage(opts.db, sendingLine, m);
      if (fresh) log(`[claw] queued inbound ${m.messageId}${m.isGroup ? ' (group)' : ''}`);
      lastAt = new Date();
    },
  });
  client.start();
  configurePlanGroupCreator(createClawGroupCreator(client, sendingLine));
  return {
    client,
    handlers: { send_outbox: createSendOutboxHandler(client), publish_poll: createPublishPollHandler() },
    stop: () => client.stop(),
  };
}

/**
 * Group creator for core's ensurePlanGroup: an iMessage group with the organizer and every resolved participant.
 * Reserved as an external effect so a retried plan job never creates a second group.
 */
export function createClawGroupCreator(client: Sender, sendingLine: string) {
  return async (db: Db, planId: string, expectedRevision?: number) => {
    const [plan] = await db.select().from(plans).where(eq(plans.id, planId));
    if (!plan || !['planning', 'voting'].includes(plan.status) || (expectedRevision !== undefined && plan.inputRevision !== expectedRevision)) return;
    const parts = await db.select({ userId: planParticipants.userId }).from(planParticipants).where(eq(planParticipants.planId, planId));
    const userIds = [...new Set([plan.organizerUserId, ...parts.map((p) => p.userId).filter((u): u is string => !!u)])];
    const people = await db.select({ id: user.id, name: user.name, phone: user.phoneNumber, verified: user.phoneNumberVerified }).from(user).where(inArray(user.id, userIds));
    const identities = await db.select().from(messagingIdentities).where(and(inArray(messagingIdentities.userId, userIds), eq(messagingIdentities.provider, CLAW_PROVIDER), isNotNull(messagingIdentities.verifiedAt)));
    const handles = people.map(person => identities.find(identity => identity.userId === person.id)?.handle ?? (person.verified ? person.phone : null));
    if (handles.length !== userIds.length || handles.some(handle => !handle) || handles.length < 2) return;
    const memberHandles = [...new Set(handles as string[])];
    if (memberHandles.length !== userIds.length) return;

    const { effect } = await reserveEffect(db, { operationKey: `create_group:${planId}`, kind: 'group_create', planId });
    if (effect.state !== 'reserved') return; // already created, or an earlier attempt's outcome is unknown
    await setEffect(db, effect.id, 'inflight');
    const organizer = people.find((p) => p.id === plan.organizerUserId)?.name ?? 'Your friend';
    const others = people.filter((p) => p.id !== plan.organizerUserId).map((p) => p.name.split(/\s+/)[0]);
    const greeting = others.length > 1 ? `${others.slice(0, -1).join(', ')} and ${others.at(-1)}` : others[0];
    // First message in a new chat: plain text, no links.
    const intro = `Hi ${greeting}! ${organizer} asked me to help plan this: "${plan.request.slice(0, 200)}". I'm finding real options and will post them here.`;
    try {
      const r = await createClawGroup(db, client, { sendingLine, memberHandles, introText: intro, planId });
      await setEffect(db, effect.id, 'confirmed', r.chatId);
      await db.insert(messages).values({
        conversationId: r.conversationId, planId, providerMessageId: `agent:intro:${planId}`, senderUserId: null, senderHandle: AGENT_HANDLE,
        isPrivate: false, body: intro, occurredAt: new Date(),
      }).onConflictDoNothing();
    } catch (e) {
      await setEffect(db, effect.id, e instanceof AppError && e.retryable ? 'failed' : 'unknown');
      throw e;
    }
  };
}
