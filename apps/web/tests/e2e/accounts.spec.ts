import { test, expect, type Page } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.route(/\/api\/plans\/[^/]+\/(quest|common-ground)$/, route => route.fulfill({ json: { data: null } }));
});
const city = {
  label: "Austin, Texas, United States",
  countryCode: "US",
  latitude: 30.2672,
  longitude: -97.7431,
  timeZone: "America/Chicago",
};
const initialProfile = {
  id: "own",
  name: "Jordan",
  avatarUrl: null,
  phoneE164: "+15125550101",
  phoneVerified: true,
  city,
  interests: ["Movies"],
  calendarConnected: false,
  onboardingComplete: true,
};
const basePlan = {
  id: "friday",
  request: "Friday movie",
  status: "voting",
  mode: "test",
  revision: 1,
  activeVersionId: "v1",
  participants: [{ id: "own", name: "Jordan", avatarUrl: null }],
  sources: [],
  votes: [],
  options: [
    {
      id: "a",
      versionId: "v1",
      label: "A",
      title: "Movie night",
      startAt: "2026-10-30T23:00:00Z",
      endAt: "2026-10-31T01:00:00Z",
      timeZone: "America/Chicago",
      estimatedPerPerson: { amountMinor: 2200, currency: "USD" },
      priceKind: "estimated",
      publicExplanation: "Friday evening in Austin.",
      uncertainties: ["Sample price"],
      sourceIds: [],
    },
  ],
};
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

test("OTP signup completes onboarding and persists profile through navigation", async ({
  page,
}) => {
  let signedIn = false;
  let profile = {
    ...initialProfile,
    onboardingComplete: false,
    name: "New friend",
  };
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({
      json: signedIn
        ? { user: { id: "own", name: profile.name }, session: { id: "s" } }
        : null,
    }),
  );
  await page.route("**/api/auth/phone-number/send-otp", (route) =>
    route.fulfill({ json: { status: true } }),
  );
  await page.route("**/api/auth/phone-number/verify", (route) => {
    signedIn = true;
    return route.fulfill({ json: { status: true } });
  });
  await page.route("**/api/me", async (route) => {
    if (route.request().method() === "PATCH")
      profile = {
        ...profile,
        ...route.request().postDataJSON(),
        onboardingComplete: true,
      };
    await route.fulfill({ json: { data: profile } });
  });
  await page.goto("/signup?next=/settings");
  await page.getByLabel("Phone number").fill("+15125550101");
  await page.getByRole("button", { name: "Send code", exact: true }).click();
  await page.getByLabel("Six-digit verification code").fill("123456");
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(
    page.getByRole("heading", { name: "Finish your account" }),
  ).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill("Jordan Davis");
  await page.getByLabel("Interests (comma separated)").fill("Movies, Music");
  await page.getByRole("button", { name: "Save account" }).click();
  await expect(
    page.getByRole("heading", { name: "Account", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Jordan Davis",
  );
  await noOverflow(page);
});

test("real account UI accepts a request, creates a private link and preserves state on reload", async ({
  page,
}) => {
  let accepted = false;
  let invited = false;
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({
      json: { user: { id: "own", name: "Jordan" }, session: { id: "s" } },
    }),
  );
  await page.route("**/api/me", (route) =>
    route.fulfill({ json: { data: initialProfile } }),
  );
  await page.route("**/api/friends", (route) =>
    route.fulfill({
      json: {
        data: {
          friends: accepted
            ? [{ id: "jamie", name: "Jamie", avatarUrl: null }]
            : [],
          requests: [
            ...(!accepted
              ? [
                  {
                    id: "incoming",
                    inviterId: "jamie",
                    inviterName: "Jamie",
                    direction: "incoming",
                    state: "pending",
                    expiresAt: Date.now() + 86400000,
                  },
                ]
              : []),
            ...(invited
              ? [
                  {
                    id: "outgoing",
                    inviterId: "own",
                    inviterName: "Jordan",
                    direction: "outgoing",
                    state: "pending",
                    expiresAt: Date.now() + 86400000,
                  },
                ]
              : []),
          ],
        },
      },
    }),
  );
  await page.route("**/api/friend-requests/incoming/accept", (route) => {
    accepted = true;
    return route.fulfill({ json: { data: { state: "accepted" } } });
  });
  await page.route("**/api/friend-requests", (route) => {
    invited = true;
    return route.fulfill({
      json: {
        data: {
          requested: true,
          invitationId: "outgoing",
          inviteToken: "private-token",
        },
      },
    });
  });
  await page.goto("/friends");
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(
    page.getByText("Friend request accepted.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText("Jamie", { exact: true })).toBeVisible();
  await page.getByLabel("Phone number").fill("+15125550103");
  await page.getByRole("button", { name: "Create invitation" }).click();
  await expect(page.getByLabel("Private invitation link")).toHaveValue(
    /\/invite\/private-token$/,
  );
  await noOverflow(page);
});

test("votes include current version and stale revisions require review", async ({
  page,
}) => {
  let revision = 1;
  let voted = false;
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({
      json: { user: { id: "own", name: "Jordan" }, session: { id: "s" } },
    }),
  );
  await page.route("**/api/me", (route) =>
    route.fulfill({ json: { data: initialProfile } }),
  );
  await page.route("**/api/plans/friday", (route) =>
    route.fulfill({
      json: {
        data: {
          ...basePlan,
          revision,
          activeVersionId: revision === 1 ? "v1" : "v2",
          options: basePlan.options.map((o) => ({
            ...o,
            versionId: revision === 1 ? "v1" : "v2",
          })),
        },
      },
    }),
  );
  await page.route("**/api/plans/friday/vote", (route) => {
    const body = route.request().postDataJSON();
    expect(body.acceptableOptionIds).toEqual(["a"]);
    expect(body.favoriteOptionId).toBe("a");
    expect(body.noneAcceptable).toBe(false);
    voted = true;
    revision = 2;
    return route.fulfill({
      status: 409,
      json: {
        error: {
          code: "STALE_PLAN",
          message: "Plan changed",
          retryable: false,
        },
        requestId: "conflict",
      },
    });
  });
  await page.goto("/plans/friday");
  await page.getByLabel("A. Movie night").check();
  await page.getByLabel("My favorite").check();
  await page.getByRole("button", { name: "Save vote" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Review the latest options",
  );
  await expect(page.getByLabel("A. Movie night")).not.toBeChecked();
  expect(voted).toBe(true);
  await noOverflow(page);
});

test("private details stay on private route, send privately, and hide a foreign projection", async ({
  page,
}) => {
  let foreign = false;
  let received: unknown;
  let reads = 0;
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({
      json: { user: { id: "own", name: "Jordan" }, session: { id: "s" } },
    }),
  );
  await page.route("**/api/me", (route) =>
    route.fulfill({ json: { data: initialProfile } }),
  );
  await page.route("**/api/plans/friday", (route) =>
    route.fulfill({ json: { data: basePlan } }),
  );
  await page.route("**/api/plans/friday/private", (route) => {
    reads++;
    return route.fulfill({
      json: {
        data: {
          ownerUserId: foreign ? "other" : "own",
          facts: [],
          messages: [
            {
              id: "private",
              text: foreign ? "Someone else secret" : "My private constraint",
            },
          ],
        },
      },
    });
  });
  await page.route("**/api/plans/friday/messages", (route) => {
    received = route.request().postDataJSON();
    return route.fulfill({ json: { data: { saved: true } } });
  });
  await page.goto("/plans/friday");
  await expect(page.getByRole("button", { name: "Save vote" })).toBeVisible();
  expect(reads).toBe(0);
  await page.getByRole("link", { name: "My private details" }).click();
  await expect(
    page.getByText("My private constraint", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Private note for the planner").fill("Home by ten");
  await page.getByRole("button", { name: "Send privately" }).click();
  await expect(page.getByRole("status")).toContainText("Private message saved");
  expect(received).toEqual({
    text: "Home by ten",
    scope: "private",
    expectedRevision: 1,
  });
  foreign = true;
  await page.reload();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "not available for this account",
  );
  await expect(page.getByText("Someone else secret")).toHaveCount(0);
  await noOverflow(page);
});

test("nonbuyer sees own share and manual labels, not buyer ledger", async ({
  page,
}) => {
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({
      json: { user: { id: "own", name: "Jordan" }, session: { id: "s" } },
    }),
  );
  await page.route("**/api/me", (route) =>
    route.fulfill({ json: { data: initialProfile } }),
  );
  await page.route("**/api/plans/friday", (route) =>
    route.fulfill({ json: { data: basePlan } }),
  );
  await page.route("**/api/plans/friday/payment", (route) =>
    route.fulfill({
      json: {
        data: {
          viewerUserId: "own",
          buyerUserId: "jamie",
          ownShare: {
            id: "share",
            payerUserId: "own",
            recipientUserId: "jamie",
            amount: { amountMinor: 2200, currency: "USD" },
            paymentUrl: null,
            status: "payer_reported_sent",
            confirmationSource: "none",
            mode: "test",
          },
          buyerLedger: [
            {
              id: "hidden",
              payerUserId: "secret-payer",
              amount: { amountMinor: 4400, currency: "USD" },
              status: "requested",
            },
          ],
          booking: {
            status: "test_confirmed",
            mode: "test",
            actualTotal: null,
          },
        },
      },
    }),
  );
  await page.goto("/plans/friday/payment");
  await expect(
    page.getByRole("heading", { name: "Test payment — no live purchase" }),
  ).toBeVisible();
  await expect(
    page.getByText("Not provider verified", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Buyer ledger" })).toHaveCount(
    0,
  );
  await expect(page.getByText("secret-payer")).toHaveCount(0);
  await noOverflow(page);
});

test("Studio uses canonical templates and shows only the redacted execution record", async ({
  page,
}) => {
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({
      json: { user: { id: "own", name: "Jordan" }, session: { id: "s" } },
    }),
  );
  await page.route("**/api/me", (route) =>
    route.fulfill({ json: { data: initialProfile } }),
  );
  await page.route("**/api/studio/templates", (route) =>
    route.fulfill({
      json: {
        data: [
          {
            id: "movie-night",
            version: 1,
            model: "muse",
            systemInstruction: "Editable recipe instructions",
            allowedTools: ["search"],
            limits: { maxTurns: 4, maxTools: 8, maxSearches: 3 },
            outputSchemaVersion: 1,
          },
        ],
      },
    }),
  );
  await page.route("**/api/studio/runs", (route) =>
    route.fulfill({
      json: {
        data: [
          {
            id: "run-one",
            status: "waiting",
            startedAt: "2026-10-24T12:00:00Z",
            summary: "Waiting for votes.",
            mode: "test",
            steps: [
              {
                index: 0,
                kind: "validation",
                name: "Validate options",
                durationMs: 12,
                inputRevision: 1,
                outcome: "ok",
                redactedSummary: "Three public options passed validation.",
                inputTokens: 10,
                outputTokens: 20,
                estimatedCostUsd: 0.001,
                rawInput: "private-input-must-not-be-shown",
              },
            ],
          },
        ],
      },
    }),
  );
  await page.goto("/studio");
  await expect(
    page.locator('summary').filter({ hasText: 'movie-night · version 1' }),
  ).toBeVisible();
  await page.getByText("Execution record (1 steps)").click();
  await expect(
    page.getByText("Three public options passed validation."),
  ).toBeVisible();
  await page.locator('summary').filter({ hasText: 'movie-night · version 1' }).click();
  await expect(page.getByRole('textbox', { name: 'Instructions', exact: true })).toHaveValue('Editable recipe instructions');
  await expect(page.getByText("private-input-must-not-be-shown")).toHaveCount(
    0,
  );
  await noOverflow(page);
});
