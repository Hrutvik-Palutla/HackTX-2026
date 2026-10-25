import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accountService,
  normalizePhone,
  AccountError,
  decryptPhone,
  encryptPhone,
  type AccountRepository,
  type Actor,
} from "./index.js";
const actor: Actor = {
  userId: "jordan",
  phoneE164: "+15125550142",
  phoneVerified: true,
};
test("friend phone envelope decrypts with the canonical AAD and rejects tampering", () => {
  const key = Buffer.alloc(32, 23);
  const first = encryptPhone(actor.phoneE164, key);
  const second = encryptPhone(actor.phoneE164, key);
  assert.notEqual(first, second);
  assert.equal(decryptPhone(first, key), actor.phoneE164);
  assert.throws(() => decryptPhone(first, Buffer.alloc(32, 24)));
  const tampered = Buffer.from(first, "base64");
  tampered[12] = tampered[12]! ^ 1;
  assert.throws(() => decryptPhone(tampered.toString("base64"), key));
});
function repository(): AccountRepository {
  return {
    getProfile: async () => null,
    updateProfile: async () => {
      throw Error("not used");
    },
    listFriends: async () => [],
    listRequests: async () => [],
    createRequest: async () => {},
    resolveRequest: async () => false,
    areFriends: async () => false,
  };
}
test("normalizes E.164 and rejects local, empty and malformed numbers", () => {
  assert.equal(normalizePhone("+1 (512) 555-0142"), actor.phoneE164);
  for (const phone of ["5125550142", "", "+0123456789", "+1234"])
    assert.throws(() => normalizePhone(phone), AccountError);
});
test("unverified sessions cannot use account or friendship services", async () => {
  const service = accountService(repository());
  const unverified = { ...actor, phoneVerified: false };
  for (const operation of [
    () => service.me(unverified),
    () => service.invite(unverified, "+15125550143"),
    () => service.respond(unverified, "request", "accepted"),
    () => service.friends(unverified),
  ])
    await assert.rejects(operation, { code: "VERIFICATION_REQUIRED" });
});
test("acceptance is bound to verified recipient and hidden when absent or expired", async () => {
  const repo = repository();
  let received: string | undefined;
  repo.resolveRequest = async (_id, phone) => {
    received = phone;
    return false;
  };
  await assert.rejects(
    () => accountService(repo).respond(actor, "foreign-request", "accepted"),
    { code: "NOT_FOUND" },
  );
  assert.equal(received, actor.phoneE164);
});
test("invites return same generic response regardless of recipient account existence", async () => {
  const repo = repository();
  let received = "";
  repo.createRequest = async (_id, phone) => {
    received = phone;
  };
  assert.deepEqual(
    await accountService(repo).invite(actor, "+1 (512) 555-0143"),
    { requested: true },
  );
  assert.equal(received, "+15125550143");
  await assert.rejects(
    () => accountService(repo).invite(actor, actor.phoneE164),
    { code: "INVALID_RECIPIENT" },
  );
});
test("own actor ID is the only profile lookup key", async () => {
  const repo = repository();
  let lookup = "";
  repo.getProfile = async (id) => {
    lookup = id;
    return null;
  };
  await accountService(repo).me(actor);
  assert.equal(lookup, "jordan");
});
test("profile rejects unknown time zones and interest injection", async () => {
  const service = accountService(repository());
  await assert.rejects(
    () =>
      service.update(actor, {
        name: "Jordan",
        interests: ["Music"],
        city: {
          label: "Austin",
          countryCode: "US",
          timeZone: "imaginary/zone",
        },
      }),
    { code: "INVALID_CITY" },
  );
  await assert.rejects(
    () =>
      service.update(actor, { name: "Jordan", interests: [{ private: true }] }),
    { code: "INVALID_PROFILE" },
  );
});
test("participant resolution rejects strangers and deduplicates accepted friends", async () => {
  const repo = repository();
  repo.areFriends = async (_a, b) => b === "jamie";
  const service = accountService(repo);
  assert.deepEqual(
    await service.participants(actor, ["jamie", "jamie", actor.userId]),
    [actor.userId, "jamie"],
  );
  await assert.rejects(() => service.participants(actor, ["outsider"]), {
    code: "CONNECTION_REQUIRED",
  });
});
test("profile city is resolved server-side and interests are normalized", async () => {
  const repo = repository();
  let written: unknown;
  repo.updateProfile = async (id, patch) => {
    written = patch;
    return {
      id,
      ...patch,
      avatarUrl: null,
      phoneE164: actor.phoneE164,
      phoneVerified: true,
      calendarConnected: false,
    };
  };
  await accountService(repo).update(actor, {
    name: " Jordan ",
    city: {
      label: "Austin, Texas, United States",
      countryCode: "US",
      latitude: 0,
      longitude: 0,
      timeZone: "America/Chicago",
    },
    interests: [" Music ", "Music", ""],
  });
  assert.deepEqual(written, {
    name: "Jordan",
    city: {
      label: "Austin, Texas, United States",
      countryCode: "US",
      latitude: 30.2672,
      longitude: -97.7431,
      timeZone: "America/Chicago",
    },
    interests: ["Music"],
  });
});
