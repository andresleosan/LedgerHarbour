process.env.AUTH_MODE ??= "development";
process.env.DEV_SESSION_SECRET ??= "ledgerharbour-vitest-test-only";

// Test-only cookie boundary: production session code must never use process-global identity state.
import { beforeEach, vi } from "vitest";

const testCookieState = new Map<string, string>();
const testCookieStore = {
  get: (name: string) => {
    const value = testCookieState.get(name);
    return value === undefined ? undefined : { name, value };
  },
  set: (name: string, value: string) => {
    testCookieState.set(name, value);
  },
  delete: (name: string) => {
    testCookieState.delete(name);
  },
};

vi.mock("next/headers", () => ({
  cookies: () => testCookieStore,
}));

beforeEach(() => {
  testCookieState.clear();
});
