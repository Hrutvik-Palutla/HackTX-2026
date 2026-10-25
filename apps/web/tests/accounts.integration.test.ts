import { test } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { createDecipheriv, randomUUID } from "node:crypto";
import { createAccountAuth } from "../lib/auth/config";
import {
  postgresAccounts,
  accountService,
  type SqlConnection,
  type AccountDatabase,
  type Actor,
  phoneDigest,
  encryptPhone,
} from "@muse/accounts";
import { configureAccounts } from "../lib/auth/runtime";
import { accountHandler } from "../lib/auth/handlers";

const connectionString = process.env.TEST_DATABASE_URL;
test(
  "Postgres: real OTP sessions, onboarding, invitations, privacy and concurrency",
  { skip: !connectionString },
  async () => {
    const schema = "sq_test_" + randomUUID().replaceAll("-", "");
    const admin = new Pool({ connectionString, max: 1 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const pool = new Pool({
      connectionString,
      max: 6,
      options: `-c search_path=${schema}`,
    });
    process.env.BETTER_AUTH_SECRET =
      "test-only-secret-for-isolated-postgres-123456789";
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    const sent = new Map<string, string>();
    const auth = createAccountAuth(pool, async (message) => {
      sent.set(message.phoneE164, message.code);
    });
    const db: AccountDatabase = {
      query: async (sql, values) => pool.query(sql, values),
      async transaction(operation) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const value = await operation(client as SqlConnection);
          await client.query("COMMIT");
          return value;
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        } finally {
          client.release();
        }
      },
    };
    const keys = {
      encryptionKey: Buffer.alloc(32, 7),
      lookupKey: "lookup-test-key-abcdefghijklmnopqrstuvwxyz",
    };
    const repo = postgresAccounts(db, keys);
    const service = accountService(repo);
    configureAccounts({ auth, repository: repo });
    async function authRequest(path: string, body?: unknown, cookie?: string) {
      return auth.handler(
        new Request("http://localhost:3000/api/auth" + path, {
          method: body ? "POST" : "GET",
          headers: {
            origin: "http://localhost:3000",
            "Content-Type": "application/json",
            "x-forwarded-for": "127.0.0.1",
            ...(cookie ? { cookie } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
      );
    }
    async function signup(phone: string) {
      assert.equal(
        (await authRequest("/phone-number/send-otp", { phoneNumber: phone }))
          .status,
        200,
      );
      const code = sent.get(phone);
      assert.ok(code && /^\d{6}$/.test(code));
      const verified = await authRequest("/phone-number/verify", {
        phoneNumber: phone,
        code,
      });
      assert.equal(verified.status, 200);
      const data = await verified.json();
      const cookies = verified.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ");
      assert.ok(cookies.includes("session_token"));
      const session = await auth.api.getSession({
        headers: new Headers({ cookie: cookies }),
      });
      assert.ok(session?.user.id);
      return {
        actor: {
          userId: data.user.id,
          phoneE164: phone,
          phoneVerified: true,
        } as Actor,
        cookie: cookies,
      };
    }
    try {
      // Friend acceptance resumes waiting plans, so exercise the real shared schema,
      // not a partial auth-only copy. Remap FK qualifications to this disposable schema.
      const migrations = new URL("../../../packages/db/drizzle/", import.meta.url);
      const journal = JSON.parse(readFileSync(new URL("meta/_journal.json", migrations), "utf8")) as { entries: { tag: string }[] };
      for (const entry of journal.entries) {
        const sql = readFileSync(new URL(`${entry.tag}.sql`, migrations), "utf8");
        await pool.query(sql.replaceAll('"public".', `"${schema}".`));
      }
      const jordan = await signup("+15125550101"),
        jamie = await signup("+15125550102"),
        outsider = await signup("+15125550103");
      assert.equal((await service.me(jordan.actor))?.onboardingComplete, false);
      const updated = await service.update(jordan.actor, {
        name: "Jordan",
        city: {
          label: "Austin, Texas, United States",
          countryCode: "US",
          latitude: 30.2672,
          longitude: -97.7431,
          timeZone: "America/Chicago",
        },
        interests: ["Movies", "Music"],
        phoneVerified: false,
      });
      assert.equal(updated.onboardingComplete, true);
      assert.equal(updated.phoneVerified, true);
      assert.equal((await service.me(jordan.actor))?.name, "Jordan");
      const invitation = await service.invite(
        jordan.actor,
        jamie.actor.phoneE164,
      );
      assert.ok(invitation.inviteToken);
      assert.ok(invitation.invitationId);
      const stored = (
        await pool.query("SELECT * FROM friend_invites WHERE id=$1", [
          invitation.invitationId,
        ])
      ).rows[0];
      assert.notEqual(stored.recipient_phone_encrypted, jamie.actor.phoneE164);
      assert.notEqual(stored.token_hash, invitation.inviteToken);
      assert.equal(
        stored.recipient_phone_digest,
        phoneDigest(jamie.actor.phoneE164, keys.lookupKey),
      );
      await assert.rejects(
        () =>
          service.respond(outsider.actor, invitation.inviteToken!, "accepted"),
        { code: "NOT_FOUND" },
      );
      const result = await Promise.allSettled([
        service.respond(jamie.actor, invitation.inviteToken!, "accepted"),
        service.respond(jamie.actor, invitation.invitationId!, "accepted"),
      ]);
      assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(
        (await pool.query("SELECT * FROM friendships")).rows.length,
        1,
      );
      assert.equal(
        await service.connected(jordan.actor, jamie.actor.userId),
        true,
      );
      assert.equal(
        await service.connected(jordan.actor, outsider.actor.userId),
        false,
      );
      const friends = await service.friends(jamie.actor);
      assert.deepEqual(
        friends.friends.map((f) => f.name),
        ["Jordan"],
      );
      assert.equal(
        JSON.stringify(friends).includes(jordan.actor.phoneE164),
        false,
      );
      assert.deepEqual((await service.friends(outsider.actor)).friends, []);
      const expired = await service.invite(
        jordan.actor,
        outsider.actor.phoneE164,
      );
      await pool.query(
        "UPDATE friend_invites SET expires_at=NOW()-INTERVAL '1 minute' WHERE id=$1",
        [expired.invitationId],
      );
      await assert.rejects(
        () => service.respond(outsider.actor, expired.inviteToken!, "accepted"),
        { code: "NOT_FOUND" },
      );
      const declined = await service.invite(
        jamie.actor,
        outsider.actor.phoneE164,
      );
      await service.respond(outsider.actor, declined.inviteToken!, "declined");
      await assert.rejects(
        () =>
          service.respond(outsider.actor, declined.inviteToken!, "accepted"),
        { code: "NOT_FOUND" },
      );
      const pending = await service.invite(
        jordan.actor,
        outsider.actor.phoneE164,
      );
      const requests = await service.friends(outsider.actor);
      assert.equal(requests.requests[0].direction, "incoming");
      assert.ok(!("recipientPhone" in requests.requests[0]));
      assert.ok(!JSON.stringify(requests).includes(pending.inviteToken!));
      const csrf = await accountHandler(
        new Request("http://localhost:3000/api/me", {
          method: "PATCH",
          headers: { origin: "https://evil.example", cookie: jordan.cookie },
          body: "{}",
        }),
        (_, actor) => Promise.resolve(actor),
      );
      assert.equal(csrf.status, 403);
      const ownResponse = await accountHandler(
        new Request("http://localhost:3000/api/me", {
          headers: { cookie: jordan.cookie },
        }),
        (s, a) => s.me(a),
      );
      assert.equal(ownResponse.status, 200);
      assert.equal((await ownResponse.json()).data.id, jordan.actor.userId);
      assert.equal(
        ownResponse.headers.get("cache-control"),
        "private, no-store",
      );
      const anonymous = await accountHandler(
        new Request("http://localhost:3000/api/me"),
        (s, a) => s.me(a),
      );
      assert.equal(anonymous.status, 401);
      const ciphertext = Buffer.from(
        encryptPhone(jamie.actor.phoneE164, keys.encryptionKey),
        "base64",
      );
      const decipher = createDecipheriv(
        "aes-256-gcm",
        keys.encryptionKey,
        ciphertext.subarray(0, 12),
      );
      decipher.setAAD(Buffer.from("sidequest:friend-phone:v1"));
      decipher.setAuthTag(ciphertext.subarray(-16));
      assert.equal(
        Buffer.concat([
          decipher.update(ciphertext.subarray(12, -16)),
          decipher.final(),
        ]).toString(),
        jamie.actor.phoneE164,
      );
      const first = encryptPhone(jamie.actor.phoneE164, keys.encryptionKey),
        second = encryptPhone(jamie.actor.phoneE164, keys.encryptionKey);
      assert.notEqual(first, second);
      const badCode = await authRequest("/phone-number/verify", {
        phoneNumber: "+15125550109",
        code: "000000",
      });
      assert.notEqual(badCode.status, 200);
      const replay = await authRequest("/phone-number/verify", {
        phoneNumber: jordan.actor.phoneE164,
        code: sent.get(jordan.actor.phoneE164),
      });
      assert.notEqual(replay.status, 200);
      const resumeInvite = await service.invite(
        jamie.actor,
        outsider.actor.phoneE164,
      );
      const failing = accountService(
        postgresAccounts(db, keys, async () => {
          throw Error("Queue unavailable");
        }),
      );
      await assert.rejects(
        () =>
          failing.respond(
            outsider.actor,
            resumeInvite.inviteToken!,
            "accepted",
          ),
        /Queue unavailable/,
      );
      assert.equal(
        (
          await pool.query("SELECT state FROM friend_invites WHERE id=$1", [
            resumeInvite.invitationId,
          ])
        ).rows[0].state,
        "pending",
      );
      let resumeUsers: unknown;
      const resumed = accountService(
        postgresAccounts(db, keys, async (_tx, users) => {
          resumeUsers = users;
        }),
      );
      await resumed.respond(
        outsider.actor,
        resumeInvite.inviteToken!,
        "accepted",
      );
      assert.deepEqual(resumeUsers, {
        inviterId: jamie.actor.userId,
        recipientId: outsider.actor.userId,
      });
      for (let index = 0; index < 20; index++) {
        try {
          await service.invite(jordan.actor, "+15125550" + String(200 + index));
        } catch (error) {
          assert.equal((error as { code: string }).code, "RATE_LIMITED");
          break;
        }
      }
      await assert.rejects(() => service.invite(jordan.actor, "+15125550999"), {
        code: "RATE_LIMITED",
      });
      const signedOut = await authRequest("/sign-out", {}, jordan.cookie);
      assert.equal(signedOut.status, 200);
      assert.equal(
        await auth.api.getSession({
          headers: new Headers({ cookie: jordan.cookie }),
        }),
        null,
      );
    } finally {
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  },
);
