import { randomUUID } from "node:crypto";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { phoneNumber } from "better-auth/plugins";
import { normalizePhone } from "@muse/accounts";
export type PrivateOtpSender = (message: {
  phoneE164: string;
  code: string;
  expiresInSeconds: number;
  purpose: "account_verification";
}) => Promise<void>;
// Part 2 passes its generated-schema adapter; Part 3 passes its private outbox sender.
export function createAccountAuth(
  database: NonNullable<BetterAuthOptions["database"]>,
  sendPrivateOtp: PrivateOtpSender,
) {
  if (
    !process.env.BETTER_AUTH_SECRET ||
    process.env.BETTER_AUTH_SECRET.length < 32
  )
    throw new Error("BETTER_AUTH_SECRET must have at least 32 characters");
  return betterAuth({
    database,
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL,
    advanced: { database: { generateId: () => randomUUID() } },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 30 },
    user: {
      additionalFields: {
        city: { type: "string", required: false, input: false },
        interests: { type: "string[]", required: false, input: false },
        onboardingComplete: {
          type: "boolean",
          required: false,
          defaultValue: false,
          input: false,
        },
      },
    },
    plugins: [
      phoneNumber({
        otpLength: 6,
        expiresIn: 300,
        allowedAttempts: 3,
        phoneNumberValidator: (phone) => {
          try {
            return normalizePhone(phone) === phone;
          } catch {
            return false;
          }
        },
        sendOTP: async ({ phoneNumber: phone, code }) => {
          await sendPrivateOtp({
            phoneE164: normalizePhone(phone),
            code,
            expiresInSeconds: 300,
            purpose: "account_verification",
          });
        },
        signUpOnVerification: {
          getTempEmail: () => `${randomUUID()}@accounts.invalid`,
          getTempName: () => "New friend",
        },
      }),
    ],
  });
}
export type AccountAuth = ReturnType<typeof createAccountAuth>;
