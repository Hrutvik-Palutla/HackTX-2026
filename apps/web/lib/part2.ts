// Part 2 wiring for the web app: plan/Studio API handlers from @hacktx/api use this app's Better Auth session,
// and accepted friendships durably enqueue a `resume_connections` job inside Part 1's acceptance transaction.
import { configureApi } from "@hacktx/api";
import { createDb } from "@hacktx/db";
import { configureCalendar } from "@hacktx/integrations/calendar";
import { createOtpSender, linkVerifiedPhone } from "@hacktx/integrations/messaging/otp";
import { configureFriendshipAccepted, configurePrivateOtpSender, sessionActor } from "./auth/runtime";
import { configurePart4 } from './part4';

const registry = globalThis as typeof globalThis & { hacktxPart2Ready?: boolean };
export function ensurePart2() {
  if (registry.hacktxPart2Ready || !process.env.DATABASE_URL) return;
  const { db, pool } = createDb();
  const teamUserIds = (process.env.TEAM_ADMIN_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const teamPhones = new Set((process.env.TEAM_ADMIN_PHONES ?? '').split(',').map(s => s.trim()).filter(Boolean));
  const getUserId = async (req: Request) => {
    const actor = await sessionActor(req.headers);
    if (!actor?.phoneVerified) return null;
    await linkVerifiedPhone(db, actor.userId, actor.phoneE164);
    if (teamPhones.has(actor.phoneE164) && !teamUserIds.includes(actor.userId)) teamUserIds.push(actor.userId);
    return actor.userId;
  };
  configurePrivateOtpSender(async (message) => {
    if (!process.env.CLAW_MESSENGER_API_KEY) {
      throw Error("Private OTP delivery unavailable");
    }
    await createOtpSender(db)(message);
  });
  configureCalendar({ db, getUserId });
  configurePart4(db, pool, getUserId);
  configureApi({
    db,
    appOrigin: process.env.BETTER_AUTH_URL,
    getUserId,
    teamUserIds,
  });
  configureFriendshipAccepted(async (tx, { inviterId, recipientId, invitationId }) => {
    await tx.query(
      "INSERT INTO jobs (kind, dedupe_key, payload) VALUES ('resume_connections', $1, $2) ON CONFLICT (dedupe_key) DO NOTHING",
      [`resume:${invitationId}`, JSON.stringify({ userIds: [inviterId, recipientId] })],
    );
  });
  registry.hacktxPart2Ready = true;
}
