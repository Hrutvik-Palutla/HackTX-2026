import { Pool } from "pg";
import { seal } from "@hacktx/core";
import {
  postgresAccounts,
  type AccountRepository,
  type Actor,
  type AccountDatabase,
  type SqlConnection,
} from "@muse/accounts";
import {
  createAccountAuth,
  type AccountAuth,
  type PrivateOtpSender,
} from "./config";
export type AccountRuntime = {
  auth: AccountAuth;
  repository: AccountRepository;
};
// One registry survives Next's server module bundles and development reloads.
const registry = globalThis as typeof globalThis & {
  sidequestAccounts?: AccountRuntime;
  sidequestOtpSender?: PrivateOtpSender;
  sidequestPool?: Pool;
  sidequestFriendshipAccepted?: (
    tx: SqlConnection,
    users: { inviterId: string; recipientId: string; invitationId: string },
  ) => Promise<void>;
};
export function configureAccounts(value: AccountRuntime) {
  registry.sidequestAccounts = value;
}
export function configurePrivateOtpSender(sender: PrivateOtpSender) {
  registry.sidequestOtpSender = sender;
}
export function configureFriendshipAccepted(
  handler: NonNullable<typeof registry.sidequestFriendshipAccepted>,
) {
  registry.sidequestFriendshipAccepted = handler;
}
export function getAccounts(): AccountRuntime | undefined {
  if (registry.sidequestAccounts) return registry.sidequestAccounts;
  const {
    DATABASE_URL,
    BETTER_AUTH_SECRET,
    APP_ENCRYPTION_KEY,
    PHONE_LOOKUP_HMAC_KEY,
  } = process.env;
  if (
    !DATABASE_URL ||
    !BETTER_AUTH_SECRET ||
    !APP_ENCRYPTION_KEY ||
    !PHONE_LOOKUP_HMAC_KEY
  )
    return undefined;
  const pool = (registry.sidequestPool ??= new Pool({
    connectionString: DATABASE_URL,
    max: 5,
  }));
  const database: AccountDatabase = {
    query: async (sql, values) => pool.query(sql, values),
    async transaction(operation) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await operation(client as SqlConnection);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
  const auth = createAccountAuth(pool, async (message) => {
    if (!registry.sidequestOtpSender)
      throw Error("Private OTP delivery unavailable");
    await registry.sidequestOtpSender(message);
  });
  configureAccounts({
    auth,
    repository: postgresAccounts(
      database,
      {
        encryptionKey: Buffer.from(APP_ENCRYPTION_KEY, "base64"),
        lookupKey: PHONE_LOOKUP_HMAC_KEY,
      },
      async (tx, users) => {
        await registry.sidequestFriendshipAccepted?.(tx, users);
      },
      async (tx, invite) => {
        if (!process.env.CLAW_MESSENGER_API_KEY)
          throw Error("Friend invitation delivery is unavailable.");
        const base = process.env.APP_BASE_URL || process.env.BETTER_AUTH_URL;
        if (!base) throw Error("Friend invitation URL is unavailable.");
        const origin = new URL(base);
        if (
          origin.protocol !== "https:" &&
          !(origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname))
        )
          throw Error("Friend invitation URL is not configured securely.");

        const inviter = await tx.query<{ name: string | null }>(
          'SELECT name FROM "user" WHERE id=$1',
          [invite.inviterId],
        );
        const inviterName = inviter.rows[0]?.name?.trim() || "A friend";
        const inviteUrl = new URL(
          `/invite/${encodeURIComponent(invite.token)}`,
          origin,
        ).href;
        const text = `${inviterName} invited you to connect on SideQuest. Reply YES to accept or NO to decline, or accept privately here: ${inviteUrl}`;
        const effectKey = `invite:${invite.invitationId}`;
        const result = await tx.query<{ id: string }>(
          "INSERT INTO outbox (recipient, effect_key, body, body_enc, expires_at) VALUES ($1,$2,NULL,$3,NOW()+INTERVAL '7 days') ON CONFLICT (effect_key) DO NOTHING RETURNING id",
          [
            JSON.stringify({ kind: "invite", invitationId: invite.invitationId }),
            effectKey,
            seal("outbox", text),
          ],
        );
        if (result.rows[0])
          await tx.query(
            "INSERT INTO jobs (kind, dedupe_key, payload) VALUES ('send_outbox', $1, $2) ON CONFLICT (dedupe_key) DO NOTHING",
            [
              `send_outbox:${effectKey}`,
              JSON.stringify({ outboxId: result.rows[0].id }),
            ],
          );
      },
      async (tx, invite) => {
        const seats = await tx.query<{ plan_id: string; organizer_user_id: string; recipient_name: string | null }>(
          `SELECT DISTINCT p.id AS plan_id, p.organizer_user_id, u.name AS recipient_name
           FROM plan_participants pp JOIN plans p ON p.id=pp.plan_id
           JOIN "user" u ON u.id=$2
           WHERE p.organizer_user_id=$3 AND p.status='waiting_connections'
             AND (pp.invite_id=$1 OR pp.user_id=$2)`,
          [invite.invitationId, invite.recipientId, invite.inviterId],
        );
        const name = seats.rows[0]?.recipient_name?.trim() || "They";
        for (const seat of seats.rows) {
          const effectKey = `frienddecline:${invite.invitationId}:${seat.plan_id}`;
          const result = await tx.query<{ id: string }>(
            "INSERT INTO outbox (recipient, effect_key, plan_id, body, body_enc) VALUES ($1,$2,$3,NULL,$4) ON CONFLICT (effect_key) DO NOTHING RETURNING id",
            [JSON.stringify({ kind: "private", userId: seat.organizer_user_id }), effectKey, seat.plan_id,
              seal("outbox", `${name} isn't connecting right now. Want me to plan without them, or stop this plan?`)],
          );
          if (result.rows[0]) await tx.query(
            "INSERT INTO jobs (kind, dedupe_key, payload) VALUES ('send_outbox',$1,$2) ON CONFLICT (dedupe_key) DO NOTHING",
            [`send_outbox:${effectKey}`, JSON.stringify({ outboxId: result.rows[0].id })],
          );
        }
      },
    ),
  });
  return registry.sidequestAccounts;
}
export async function sessionActor(headers: Headers): Promise<Actor | null> {
  const runtime = getAccounts();
  if (!runtime) return null;
  const session = await runtime.auth.api.getSession({ headers });
  if (!session) return null;
  const user = session.user as typeof session.user & {
    phoneNumber?: string;
    phoneNumberVerified?: boolean;
  };
  if (!user.phoneNumber) return null;
  return {
    userId: user.id,
    phoneE164: user.phoneNumber,
    phoneVerified: user.phoneNumberVerified === true,
  };
}
