export type City = {
  label: string;
  countryCode: string;
  latitude: number | null;
  longitude: number | null;
  timeZone: string;
};
export type Profile = {
  id: string;
  name: string;
  avatarUrl: string | null;
  phoneE164: string;
  phoneVerified: boolean;
  city: City | null;
  interests: string[];
  calendarConnected: boolean;
  onboardingComplete?: boolean;
};
export type Actor = {
  userId: string;
  phoneE164: string;
  phoneVerified: boolean;
};
export type FriendRequest = {
  id: string;
  inviterId: string;
  direction: "incoming" | "outgoing";
  inviterName: string;
  state: "pending" | "accepted" | "declined";
  expiresAt: number;
};
export class AccountError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function normalizePhone(value: string) {
  const phone = value.replace(/[\s().-]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(phone))
    throw new AccountError(
      "INVALID_PHONE",
      400,
      "Use an international phone number, such as +15125550123.",
    );
  return phone;
}
// Part 2 supplies this repository using its schema. No competing user table or in-memory production store.
export interface AccountRepository {
  getProfile(id: string): Promise<Profile | null>;
  updateProfile(
    id: string,
    patch: Pick<Profile, "name" | "city" | "interests">,
  ): Promise<Profile>;
  listFriends(
    id: string,
  ): Promise<{ id: string; name: string; avatarUrl: string | null }[]>;
  listRequests(id: string, phone: string): Promise<FriendRequest[]>;
  createRequest(
    inviterId: string,
    recipientPhone: string,
  ): Promise<void | { id: string; token: string }>;
  resolveRequest(
    id: string,
    recipientPhone: string,
    state: "accepted" | "declined",
    now: number,
    recipientUserId?: string,
  ): Promise<boolean>;
  areFriends(a: string, b: string): Promise<boolean>;
}
export const supportedCities: City[] = [
  {
    label: "Austin, Texas, United States",
    countryCode: "US",
    latitude: 30.2672,
    longitude: -97.7431,
    timeZone: "America/Chicago",
  },
];
export function accountService(repo: AccountRepository) {
  function verified(actor: Actor) {
    if (!actor.phoneVerified)
      throw new AccountError(
        "VERIFICATION_REQUIRED",
        403,
        "Verify your phone first.",
      );
  }
  return {
    async me(actor: Actor) {
      verified(actor);
      return repo.getProfile(actor.userId);
    },
    async update(actor: Actor, input: unknown) {
      verified(actor);
      const p = input as Record<string, unknown>;
      if (
        !p ||
        typeof p.name !== "string" ||
        !p.name.trim() ||
        p.name.length > 80 ||
        !Array.isArray(p.interests) ||
        p.interests.length > 12 ||
        p.interests.some((i) => typeof i !== "string" || i.length > 40)
      )
        throw new AccountError(
          "INVALID_PROFILE",
          400,
          "Check your name and interests.",
        );
      const city = p.city as City;
      if (
        !city ||
        typeof city.label !== "string" ||
        !city.label.trim() ||
        city.label.length > 120 ||
        typeof city.countryCode !== "string" ||
        !/^[A-Z]{2}$/.test(city.countryCode) ||
        ![city.latitude, city.longitude].every(
          (v) => v === null || (typeof v === "number" && Number.isFinite(v)),
        ) ||
        (city.latitude !== null && Math.abs(city.latitude) > 90) ||
        (city.longitude !== null && Math.abs(city.longitude) > 180) ||
        typeof city.timeZone !== "string"
      )
        throw new AccountError("INVALID_CITY", 400, "Choose a resolved city.");
      try {
        new Intl.DateTimeFormat("en", { timeZone: city.timeZone });
      } catch {
        throw new AccountError(
          "INVALID_CITY",
          400,
          "Choose a valid time zone.",
        );
      }
      const resolved = supportedCities.find(
        (c) =>
          c.label === city.label &&
          c.countryCode === city.countryCode &&
          c.timeZone === city.timeZone,
      );
      if (!resolved)
        throw new AccountError(
          "INVALID_CITY",
          400,
          "Choose a supported, resolved city.",
        );
      return repo.updateProfile(actor.userId, {
        name: p.name.trim(),
        city: resolved,
        interests: [
          ...new Set(
            (p.interests as string[])
              .map((value) => value.trim())
              .filter(Boolean),
          ),
        ],
      });
    },
    async friends(actor: Actor) {
      verified(actor);
      return {
        friends: await repo.listFriends(actor.userId),
        requests: await repo.listRequests(actor.userId, actor.phoneE164),
      };
    },
    async invite(actor: Actor, phone: string) {
      verified(actor);
      const normalized = normalizePhone(phone);
      if (normalized === actor.phoneE164)
        throw new AccountError(
          "INVALID_RECIPIENT",
          400,
          "Choose another person.",
        );
      const invitation = await repo.createRequest(actor.userId, normalized);
      return {
        requested: true,
        ...(invitation
          ? { invitationId: invitation.id, inviteToken: invitation.token }
          : {}),
      };
    },
    async respond(actor: Actor, id: string, state: "accepted" | "declined") {
      verified(actor);
      if (
        !(await repo.resolveRequest(
          id,
          actor.phoneE164,
          state,
          Date.now(),
          actor.userId,
        ))
      )
        throw new AccountError("NOT_FOUND", 404, "Request unavailable.");
      return { state };
    },
    async participants(actor: Actor, ids: string[]) {
      verified(actor);
      if (
        !Array.isArray(ids) ||
        ids.length > 50 ||
        ids.some((id) => typeof id !== "string" || !id || id.length > 128)
      )
        throw new AccountError(
          "INVALID_PARTICIPANTS",
          400,
          "Choose valid friends.",
        );
      const unique = [...new Set(ids)].filter((id) => id !== actor.userId);
      for (const id of unique)
        if (!(await repo.areFriends(actor.userId, id)))
          throw new AccountError(
            "CONNECTION_REQUIRED",
            422,
            "Connect with each friend before planning.",
          );
      return [actor.userId, ...unique];
    },
    async connected(actor: Actor, other: string) {
      verified(actor);
      return repo.areFriends(actor.userId, other);
    },
  };
}

export {
  postgresAccounts,
  decryptPhone,
  phoneDigest,
  tokenDigest,
  encryptPhone,
  type AccountDatabase,
  type SqlConnection,
} from "./postgres";
