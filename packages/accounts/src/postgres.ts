import {
  createCipheriv,
  createHmac,
  randomBytes,
  randomUUID,
  createHash,
} from "node:crypto";
import type { AccountRepository, Profile, FriendRequest } from "./index";

export interface SqlConnection {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}
export interface AccountDatabase extends SqlConnection {
  transaction<T>(operation: (tx: SqlConnection) => Promise<T>): Promise<T>;
}
export type AccountKeys = { encryptionKey: Buffer; lookupKey: string };
export function phoneDigest(phone: string, key: string) {
  return createHmac("sha256", key)
    .update("sidequest:friend-phone:v1\0" + phone)
    .digest("hex");
}
export function tokenDigest(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
export function encryptPhone(phone: string, key: Buffer) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from("sidequest:friend-phone:v1"));
  return Buffer.concat([
    nonce,
    cipher.update(phone, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString("base64");
}
// Part 2 owns DDL. Required column names and constraints are in docs/APP_ACCOUNTS_HANDOFF.md.
export function postgresAccounts(
  db: AccountDatabase,
  keys: AccountKeys,
  onAccepted?: (
    tx: SqlConnection,
    users: { inviterId: string; recipientId: string },
  ) => Promise<void>,
): AccountRepository {
  if (keys.encryptionKey.length !== 32 || keys.lookupKey.length < 32)
    throw Error(
      "Account encryption and lookup keys must be at least 32 bytes.",
    );
  const profile = async (id: string): Promise<Profile | null> => {
    const result = await db.query(
      'SELECT id, name, image, "phoneNumber", "phoneNumberVerified", city, interests, "onboardingComplete" FROM "user" WHERE id=$1',
      [id],
    );
    const row = result.rows[0];
    if (!row) return null;
    let city = null;
    try {
      city = typeof row.city === "string" ? JSON.parse(row.city) : row.city;
    } catch {}
    return {
      id: String(row.id),
      name: String(row.name),
      avatarUrl: row.image as string | null,
      phoneE164: String(row.phoneNumber),
      phoneVerified: row.phoneNumberVerified === true,
      city,
      interests: Array.isArray(row.interests)
        ? (row.interests as string[])
        : [],
      calendarConnected: false,
      onboardingComplete: row.onboardingComplete === true,
    };
  };
  return {
    getProfile: profile,
    async updateProfile(id, patch) {
      await db.query(
        'UPDATE "user" SET name=$2, city=$3, interests=$4, "onboardingComplete"=true, "updatedAt"=NOW() WHERE id=$1',
        [
          id,
          patch.name,
          JSON.stringify(patch.city),
          JSON.stringify(patch.interests),
        ],
      );
      const result = await profile(id);
      if (!result) throw Error("Profile missing");
      return result;
    },
    async listFriends(id) {
      const result = await db.query(
        'SELECT u.id, u.name, u.image AS "avatarUrl" FROM friendships f JOIN "user" u ON u.id=CASE WHEN f.user_low_id=$1 THEN f.user_high_id ELSE f.user_low_id END WHERE (f.user_low_id=$1 OR f.user_high_id=$1) AND f.status=\'accepted\' ORDER BY u.name',
        [id],
      );
      return result.rows as {
        id: string;
        name: string;
        avatarUrl: string | null;
      }[];
    },
    async listRequests(id, phone) {
      const result = await db.query(
        'SELECT i.id, i.inviter_id AS "inviterId", u.name AS "inviterName", i.state, i.expires_at AS "expiresAt", CASE WHEN i.inviter_id=$1 THEN \'outgoing\' ELSE \'incoming\' END AS direction FROM friend_invites i JOIN "user" u ON u.id=i.inviter_id WHERE (i.inviter_id=$1 OR i.recipient_phone_digest=$2) AND i.state=\'pending\' AND i.expires_at>NOW() ORDER BY i.created_at DESC',
        [id, phoneDigest(phone, keys.lookupKey)],
      );
      return result.rows.map((row) => ({
        ...row,
        expiresAt: new Date(row.expiresAt as string).getTime(),
      })) as unknown as FriendRequest[];
    },
    async createRequest(inviterId, phone) {
      const id = randomUUID(),
        token = randomBytes(32).toString("base64url");
      // Serializing an inviter prevents duplicate requests and bounds abuse across replicas.
      await db.transaction(async (tx) => {
        await tx.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE', [
          inviterId,
        ]);
        const count = await tx.query(
          "SELECT COUNT(*)::int AS count FROM friend_invites WHERE inviter_id=$1 AND created_at>NOW()-INTERVAL '1 hour'",
          [inviterId],
        );
        if (Number(count.rows[0]?.count) >= 20)
          throw new AccountError(
            "RATE_LIMITED",
            429,
            "Too many invitations. Try again later.",
          );
        await tx.query(
          "INSERT INTO friend_invites (id,inviter_id,recipient_phone_encrypted,recipient_phone_digest,token_hash,state,expires_at,created_at) VALUES ($1,$2,$3,$4,$5,'pending',NOW()+INTERVAL '7 days',NOW())",
          [
            id,
            inviterId,
            encryptPhone(phone, keys.encryptionKey),
            phoneDigest(phone, keys.lookupKey),
            tokenDigest(token),
          ],
        );
      });
      return { id, token };
    },
    async resolveRequest(reference, phone, state, now, recipientUserId) {
      if (!recipientUserId) return false;
      return db.transaction(async (tx) => {
        const account = await tx.query(
          'SELECT id FROM "user" WHERE id=$1 AND "phoneNumber"=$2 AND "phoneNumberVerified"=true',
          [recipientUserId, phone],
        );
        if (!account.rows.length) return false;
        const result = await tx.query(
          "UPDATE friend_invites SET state=$3 WHERE (id::text=$1 OR token_hash=$5) AND recipient_phone_digest=$2 AND state='pending' AND expires_at>$4 RETURNING inviter_id",
          [
            reference,
            phoneDigest(phone, keys.lookupKey),
            state,
            new Date(now),
            tokenDigest(reference),
          ],
        );
        if (!result.rows.length) return false;
        if (state === "accepted") {
          const inviter = String(result.rows[0].inviter_id);
          if (inviter === recipientUserId) throw Error("Invalid friendship");
          const [low, high] = [inviter, recipientUserId].sort();
          await tx.query(
            "INSERT INTO friendships (user_low_id,user_high_id,requested_by,status,accepted_at) VALUES ($1,$2,$3,'accepted',NOW()) ON CONFLICT (user_low_id,user_high_id) DO UPDATE SET status='accepted', accepted_at=NOW()",
            [low, high, inviter],
          );
          if (onAccepted)
            await onAccepted(tx, {
              inviterId: inviter,
              recipientId: recipientUserId,
            });
        }
        return true;
      });
    },
    async areFriends(a, b) {
      const [low, high] = [a, b].sort();
      const result = await db.query(
        "SELECT 1 FROM friendships WHERE user_low_id=$1 AND user_high_id=$2 AND status='accepted'",
        [low, high],
      );
      return result.rows.length > 0;
    },
  };
}
import { AccountError } from "./index";
