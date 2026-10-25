import { Pool } from "pg";
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
    users: { inviterId: string; recipientId: string },
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
