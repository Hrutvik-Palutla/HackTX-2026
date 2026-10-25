// Claw Messenger <-> Part 2's durable state. Inbound socket messages become `process_inbound` jobs;
// `send_outbox` and `publish_poll` jobs go out through the same socket.
// Claw Messenger has no native polls, so a poll is a text prompt and votes come back as chat replies
// that Part 2's conversation handler records through its vote tool.
import { createHash } from 'node:crypto';
import { and, eq, isNotNull, max, sql } from 'drizzle-orm';
import {
  conversations, friendInvites, inboundEvents, messagingIdentities, outbox, plans, user, externalEffects, type Db,
} from '@hacktx/db';
import { AppError, enqueue, open, postToConversation, reserveEffect, type Job } from '@hacktx/core';
import { OutboundRecipient, type InboundMessage, type MessagingPort } from '@hacktx/contracts';
import { ClawMessengerClient, type ClawInboundMessage, type SendTarget } from './claw-messenger.ts';

export const CLAW_PROVIDER = 'claw_messenger';

export const clawCapabilities: MessagingPort['capabilities'] = {
  createGroup: true, coldInvite: true, nativePoll: false, identifiedVotes: true, contextualGroupMessages: true,
};

type Sender = Pick<ClawMessengerClient, 'send'>;
type Handler = (ctx: { db: Db; job: Job }) => Promise<void>;

export function toInboundMessage(m: ClawInboundMessage): InboundMessage {
  return {
    // Cast until CONTRACTS.md adds 'claw_messenger' to InboundMessage.provider (requested from Part 2).
    provider: CLAW_PROVIDER as InboundMessage['provider'],
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
    await enqueue(tx as unknown as Db, { kind: 'process_inbound', dedupeKey: `${CLAW_PROVIDER}:${m.messageId}`, payload: { sendingLine, message } });
    return true;
  });
}

type StoredRecipient = OutboundRecipient | { kind: 'otp_phone'; phoneEnc: string };
const parseRecipient = (raw: unknown): StoredRecipient =>
  (raw as { kind?: string })?.kind === 'otp_phone' ? raw as StoredRecipient : OutboundRecipient.parse(raw);

/** Where an outbox recipient is reached on Claw Messenger. */
async function resolveTarget(db: Db, r: StoredRecipient): Promise<SendTarget> {
  if (r.kind === 'otp_phone') return { to: open('phone', r.phoneEnc) };
  if (r.kind === 'group') {
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, r.conversationId));
    if (!conv || conv.provider !== CLAW_PROVIDER) throw new AppError('UNRESOLVED', 'group conversation is not a Claw Messenger chat');
    return { chatId: conv.externalChatId };
  }
  if (r.kind === 'invite') {
    const [inv] = await db.select().from(friendInvites).where(eq(friendInvites.id, r.invitationId));
    if (!inv) throw new AppError('UNRESOLVED', 'invite not found');
    return { to: open('phone', inv.recipientPhoneEnc) };
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

    const { effect } = await reserveEffect(db, { operationKey: `send:${row.effectKey}`, kind: 'message_send', planId: row.planId });
    if (effect.state === 'confirmed') { await setOutbox(db, row.id, 'sent', effect.providerRequestId ?? undefined); return; }
    if (effect.state !== 'reserved') {
      await setOutbox(db, row.id, 'unknown');
      throw new AppError('PROVIDER', `send ${row.effectKey} outcome unknown after an interrupted attempt; not resending`);
    }

    const target = await resolveTarget(db, parseRecipient(row.recipient));
    const text = row.body ?? open('outbox', row.bodyEnc!);
    await setEffect(db, effect.id, 'inflight');
    let res;
    try {
      res = await client.send(target, text, { id: row.id });
    } catch (e) {
      await setEffect(db, effect.id, 'unknown');
      await setOutbox(db, row.id, 'unknown');
      throw new AppError('PROVIDER', `send ${row.effectKey}: ${e instanceof Error ? e.message : e}`);
    }
    if (res.ok) {
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
    throw new AppError('PROVIDER', `send ${row.effectKey} failed: ${res.errorCode ?? res.error ?? res.status}`);
  };
}

export function formatTextPoll(labels: string[]) {
  return [
    'Poll: reply with every option that works for you (e.g. "A C"), add "favorite C" for your top pick, or reply "none".',
    ...labels,
  ].join('\n');
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
  // Claw chooses the provider's sender. This is a local routing namespace, not an outbound `from` field.
  const sendingLine = env.CLAW_MESSENGER_FROM_PHONE || 'claw-default';
  if (!apiKey) return null;
  const log = opts.log ?? ((m: string) => console.log(m));

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
  return {
    client,
    handlers: { send_outbox: createSendOutboxHandler(client), publish_poll: createPublishPollHandler() },
    stop: () => client.stop(),
  };
}
