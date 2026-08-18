import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "corepack pnpm dev --port 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    env: {
      ...process.env,
      NODE_ENV: "test",
      AUTH_MODE: "firebase",
      OCR_PROVIDER: "fake",
      NEXT_PUBLIC_FIREBASE_API_KEY: "playwright-public-api-key",
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "playwright.firebaseapp.com",
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: "playwright-project",
      NEXT_PUBLIC_FIREBASE_APP_ID: "playwright-app-id",
      NEXT_PUBLIC_FIREBASE_TEST_ADAPTER: "true",
      PLATFORM_ADMIN_EMAILS: "platform-admin@example.com,platform-admin-mobile@example.com,platform-admin-panel@example.com,platform-admin-action@example.com",
    },
  },
});
