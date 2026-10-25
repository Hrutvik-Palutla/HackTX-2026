// Messaging handle -> account. A phone-number handle from iMessage/SMS is authenticated by the provider, so it
// is the same proof as the phone the user verified by OTP at signup. Link it the first time it is seen, as a
// sender or as a group member; signup and invite acceptance don't create the messaging identity themselves.
// Display names and chat membership never identify an account.
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { messagingIdentities, user, type Db } from '@hacktx/db';

const E164 = /^\+[1-9]\d{6,14}$/;

/** Ensures a verified messaging identity for each phone handle that matches exactly one OTP-verified account. */
export async function linkVerifiedPhones(db: Db, provider: string, handles: string[]) {
  const phones = [...new Set(handles.filter((h) => E164.test(h)))];
  if (!phones.length) return;
  const linked = new Set((await db.select({ handle: messagingIdentities.handle }).from(messagingIdentities).where(and(
    eq(messagingIdentities.provider, provider), inArray(messagingIdentities.handle, phones), isNotNull(messagingIdentities.verifiedAt),
  ))).map((r) => r.handle));
  const pending = phones.filter((p) => !linked.has(p));
  if (!pending.length) return;
  const owners = await db.select({ id: user.id, phone: user.phoneNumber }).from(user)
    .where(and(inArray(user.phoneNumber, pending), eq(user.phoneNumberVerified, true)));
  for (const phone of pending) {
    const matches = owners.filter((o) => o.phone === phone);
    if (matches.length !== 1) continue;
    await db.insert(messagingIdentities).values({ userId: matches[0]!.id, provider, handle: phone, kind: 'phone', verifiedAt: new Date() })
      .onConflictDoUpdate({ target: [messagingIdentities.provider, messagingIdentities.handle], set: { userId: matches[0]!.id, verifiedAt: new Date() } });
  }
}
