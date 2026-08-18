import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

const testEnvironment: Record<string, string> = {
  NODE_ENV: "test",
  AUTH_MODE: "firebase",
  OCR_PROVIDER: "fake",
  PERSISTENCE_MODE: "memory",
  STORAGE_MODE: "local",
  RATE_LIMIT_MODE: "memory",
  LEDGERHARBOUR_PLAYWRIGHT_HARNESS: "true",
  NEXT_PUBLIC_FIREBASE_API_KEY: "playwright-public-api-key",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "playwright.firebaseapp.com",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "playwright-project",
  NEXT_PUBLIC_FIREBASE_APP_ID: "1:1234567890:web:playwrightapp",
  NEXT_PUBLIC_FIREBASE_TEST_ADAPTER: "true",
  PLATFORM_ADMIN_EMAILS: "platform-admin@example.com,platform-admin-mobile@example.com,platform-admin-panel@example.com,platform-admin-action@example.com,platform-admin-switcher@example.com,platform-admin-onboarding-workflow@example.com,platform-admin-onboarding-mobile@example.com,platform-admin-membership@example.com,platform-admin-membership-lifecycle@example.com",
};

export function createPlaywrightServerEnv(environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const path = environment.PATH ?? environment.Path;
  return (path ? { PATH: path, ...testEnvironment } : { ...testEnvironment }) as NodeJS.ProcessEnv;
}

export function spawnPlaywrightServer(environment: NodeJS.ProcessEnv = process.env): ChildProcess {
  const command = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "corepack";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", "corepack pnpm dev --port 3100"]
    : ["pnpm", "dev", "--port", "3100"];
  return spawn(command, args, {
    env: createPlaywrightServerEnv(environment),
    stdio: "inherit",
  });
}

function isEntrypoint(): boolean {
  return process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
}

if (isEntrypoint()) {
  const server = spawnPlaywrightServer();
  server.on("exit", (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}
