// Private OTP delivery for Better Auth (Part 1 calls configurePrivateOtpSender(createOtpSender(db)) at startup).
// The web process only queues: phone + code are encrypted into the outbox and the worker sends over iMessage.
// The code never reaches logs, prompts, or a group. The body is wiped after delivery or expiry.
import { createHash } from 'node:crypto';
import { messagingIdentities, outbox, type Db } from '@hacktx/db';
import { enqueue, seal } from '@hacktx/core';
import type { OutboundRecipient } from '@hacktx/contracts';
import { CLAW_PROVIDER } from './claw-adapter.ts';

export type PrivateOtpMessage = { phoneE164: string; code: string; expiresInSeconds: number; purpose: 'account_verification' };


const E164 = /^\+[1-9]\d{6,14}$/;

export const otpText = (code: string, expiresInSeconds: number) =>
  `Your SideQuest code is ${code}. It expires in ${Math.round(expiresInSeconds / 60)} minutes. Don't share it with anyone.`;

/** Durably queues the code before resolving; rejects if it could not be queued (Better Auth then fails the request). */
export function createOtpSender(db: Db) {
  return async (m: PrivateOtpMessage): Promise<void> => {
    if (!E164.test(m.phoneE164)) throw new Error('OTP phone must be E.164');
    const effectKey = `otp:${createHash('sha256').update(`${m.phoneE164}:${m.code}:${m.purpose}`).digest('hex').slice(0, 32)}`;
    const recipient: OutboundRecipient = { kind: 'otp_phone', phoneEnc: seal('phone', m.phoneE164) };
    await db.transaction(async (tx) => {
      const rows = await tx.insert(outbox).values({
        recipient, effectKey, body: null, bodyEnc: seal('outbox', otpText(m.code, m.expiresInSeconds)),
        expiresAt: new Date(Date.now() + m.expiresInSeconds * 1000),
      }).onConflictDoNothing({ target: outbox.effectKey }).returning({ id: outbox.id });
      if (rows[0]) await enqueue(tx as unknown as Db, { kind: 'send_outbox', dedupeKey: `send_outbox:${effectKey}`, payload: { outboxId: rows[0].id }, maxAttempts: 3 });
    });
  };
}

/**
 * Call after Better Auth verifies the phone: the verified number is the person's iMessage handle, so inbound
 * messages from it resolve to their account. Idempotent.
 */
export async function linkVerifiedPhone(db: Db, userId: string, phoneE164: string) {
  await db.insert(messagingIdentities).values({ userId, provider: CLAW_PROVIDER, handle: phoneE164, kind: 'phone', verifiedAt: new Date() })
    .onConflictDoNothing();
}
