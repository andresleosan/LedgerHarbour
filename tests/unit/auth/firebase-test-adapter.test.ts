import { describe, expect, it, vi } from "vitest";

import { createFirebaseAdminAuth } from "../../../src/modules/auth/firebase-admin";
import { createDeterministicFirebaseAdminAuth } from "../../../src/modules/auth/firebase-test-adapter";

describe("deterministic Firebase test adapter", () => {
  it("verifies deterministic email tokens and session cookies only in test", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const auth = createDeterministicFirebaseAdminAuth();

    await expect(auth.verifyIdToken("ledgerharbour-test-firebase:user%40example.com", true)).resolves.toEqual({
      uid: "test-firebase-user@example.com",
      email: "user@example.com",
      name: "User",
      email_verified: true,
    });
    const session = await auth.createSessionCookie("ledgerharbour-test-firebase:user%40example.com", { expiresIn: 1000 });
    await expect(auth.verifySessionCookie(session, true)).resolves.toEqual({
      uid: "test-firebase-user@example.com",
      email: "user@example.com",
      name: "User",
      email_verified: true,
    });
    vi.unstubAllEnvs();
  });

  it("does not select the deterministic adapter from LEDGERHARBOUR_TEST_MODE", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LEDGERHARBOUR_TEST_MODE", "true");
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_CLIENT_EMAIL;
    delete process.env.FIREBASE_PRIVATE_KEY;

    expect(() => createDeterministicFirebaseAdminAuth()).toThrow("NODE_ENV=test");
    expect(() => createFirebaseAdminAuth()).toThrow("FIREBASE_PROJECT_ID");
    vi.unstubAllEnvs();
  });
});
