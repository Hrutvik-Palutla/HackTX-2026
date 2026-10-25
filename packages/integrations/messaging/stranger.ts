// Someone without an account texts the agent privately: point them at signup, at most once per handle per UTC day.
// Group messages from strangers get nothing (membership is not identity). The phone is kept only sealed.
import { createHash } from 'node:crypto';
import { and, eq, isNotNull } from 'drizzle-orm';
import { messagingIdentities, user, type Db } from '@hacktx/db';
import { appBaseUrl, enqueueMessage, seal } from '@hacktx/core';
import type { ClawInboundMessage } from './claw-messenger.ts';
import { CLAW_PROVIDER } from './claw-adapter.ts';

export const strangerText = () =>
  `Hi! I'm SideQuest's planning agent. I help friends plan outings together over iMessage. Sign up at ${appBaseUrl()}/signup to plan with your friends.`;

/** Returns true if a greeting was queued. Call from ingest for every new inbound message. */
export async function maybeGreetStranger(db: Db, sendingLine: string, m: ClawInboundMessage): Promise<boolean> {
  if (m.isGroup || m.from === sendingLine) return false;
  const [ident] = await db.select({ id: messagingIdentities.id }).from(messagingIdentities).where(and(
    eq(messagingIdentities.provider, CLAW_PROVIDER), eq(messagingIdentities.handle, m.from), isNotNull(messagingIdentities.verifiedAt),
  ));
  if (ident) return false;
  const [known] = await db.select({ id: user.id }).from(user).where(and(eq(user.phoneNumber, m.from), eq(user.phoneNumberVerified, true)));
  if (known) return false;
  const handleHash = createHash('sha256').update(`${sendingLine}:${m.from}`).digest('hex').slice(0, 32);
  const id = await enqueueMessage(db, {
    recipient: { kind: 'otp_phone', phoneEnc: seal('phone', m.from) },
    text: strangerText(),
    effectKey: `stranger:${handleHash}:${new Date().toISOString().slice(0, 10)}`,
  });
  return !!id;
}
