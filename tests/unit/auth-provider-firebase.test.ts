import { describe, expect, it } from "vitest";

import {
  FirebaseAuthProvider,
  type FirebaseAdminAuth,
  type FirebaseSessionStore,
} from "../../src/modules/auth/firebase-auth-provider";

const decoded = {
  uid: "firebase-user-1",
  email: "user@example.com",
  name: "Example User",
  email_verified: true,
};

function setup() {
  let session: string | null = null;
  const verificationCalls: Array<[string, boolean | undefined]> = [];
  const sessionCookieCalls: Array<{ idToken: string; expiresIn: number }> = [];
  const auth: FirebaseAdminAuth = {
    verifyIdToken: async (idToken, checkRevoked) => {
      verificationCalls.push([idToken, checkRevoked]);
      return decoded;
    },
    createSessionCookie: async (idToken, options) => {
      sessionCookieCalls.push({ idToken, expiresIn: options.expiresIn });
      return "signed-session-cookie";
    },
    verifySessionCookie: async () => decoded,
  };
  const sessions: FirebaseSessionStore = {
    set: async (value) => { session = value; },
    get: async () => session,
    clear: async () => { session = null; },
  };
  return { auth, sessions, verificationCalls, sessionCookieCalls };
}

describe("FirebaseAuthProvider", () => {
  it("verifies an email token and stores an HttpOnly session through the boundary", async () => {
    const { auth, sessions, verificationCalls, sessionCookieCalls } = setup();
    const provider = new FirebaseAuthProvider({ auth, sessions });

    await expect(provider.signInWithEmail({ email: "user@example.com", idToken: "id-token" })).resolves.toEqual({
      provider: "firebase",
      providerUserId: "firebase-user-1",
      email: "user@example.com",
      displayName: "Example User",
      emailVerified: true,
    });
    await expect(sessions.get()).resolves.toBe("signed-session-cookie");
    expect(verificationCalls).toEqual([["id-token", true]]);
    expect(sessionCookieCalls).toEqual([{ idToken: "id-token", expiresIn: 432000000 }]);
  });

  it("rejects a missing token or an email mismatch", async () => {
    const { auth, sessions } = setup();
    const provider = new FirebaseAuthProvider({ auth, sessions });

    await expect(provider.signInWithEmail({ email: "user@example.com" })).rejects.toMatchObject({ code: "AUTH_PROVIDER_FAILURE" });
    await expect(provider.signInWithEmail({ email: "other@example.com", idToken: "id-token" })).rejects.toMatchObject({ code: "AUTH_PROVIDER_FAILURE" });
  });

  it("loads and clears the Firebase session without using the development cookie", async () => {
    const { auth, sessions } = setup();
    const provider = new FirebaseAuthProvider({ auth, sessions });
    await provider.signInWithGoogle({ idToken: "id-token" });

    await expect(provider.getCurrentIdentity()).resolves.toMatchObject({ providerUserId: "firebase-user-1" });
    await provider.signOut();
    await expect(provider.getCurrentIdentity()).resolves.toBeNull();
  });
});
