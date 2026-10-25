import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./apps/web/tests/e2e",
  fullyParallel: true,
  use: {
    channel: "chromium",
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "pnpm --filter @muse/web start",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 30000,
      },
  reporter: "list",
});
