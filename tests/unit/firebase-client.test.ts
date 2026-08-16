import { beforeEach, describe, expect, it, vi } from "vitest";

const signInWithRedirect = vi.hoisted(() => vi.fn());
const getRedirectResult = vi.hoisted(() => vi.fn());
const getAuth = vi.hoisted(() => vi.fn(() => "auth"));
const signOut = vi.hoisted(() => vi.fn());

vi.mock("firebase/app", () => ({
  getApps: vi.fn(() => [{ name: "app" }]),
  initializeApp: vi.fn(),
}));

vi.mock("firebase/auth", () => ({
  createUserWithEmailAndPassword: vi.fn(),
  getAuth,
  getRedirectResult,
  GoogleAuthProvider: class GoogleAuthProvider {},
  signInWithEmailAndPassword: vi.fn(),
  signInWithPopup: vi.fn(),
  signInWithRedirect,
  signOut,
}));

import {
  getFirebaseGoogleRedirectResult,
  signInWithFirebaseCredential,
  signInWithFirebaseGoogle,
  signOutFirebaseUser,
} from "../../src/modules/auth/firebase-client";

const config = {
  apiKey: "api-key",
  authDomain: "example.firebaseapp.com",
  projectId: "example",
  appId: "app-id",
};

describe("Firebase Google authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts authentication with a redirect instead of a popup", async () => {
    await signInWithFirebaseGoogle(config);

    expect(signInWithRedirect).toHaveBeenCalledOnce();
    expect(signInWithRedirect.mock.calls[0]?.[0]).toBe("auth");
  });

  it("reads the Google result after returning from the redirect", async () => {
    const credential = { user: { email: "user@example.com" } };
    getRedirectResult.mockResolvedValue(credential);

    await expect(Promise.all([
      getFirebaseGoogleRedirectResult(config),
      getFirebaseGoogleRedirectResult(config),
    ])).resolves.toEqual([credential, credential]);
    expect(getRedirectResult).toHaveBeenCalledOnce();
    expect(getRedirectResult).toHaveBeenCalledWith("auth");

    await getFirebaseGoogleRedirectResult(config);
    expect(getRedirectResult).toHaveBeenCalledTimes(2);
  });

  it("passes the redirected ID token through the application provider", async () => {
    const getIdToken = vi.fn().mockResolvedValue("id-token");
    const signInWithGoogle = vi.fn().mockResolvedValue({ email: "user@example.com" });

    await signInWithFirebaseCredential({ user: { getIdToken } }, signInWithGoogle);

    expect(signInWithGoogle).toHaveBeenCalledWith({ idToken: "id-token" });
  });

  it("clears the Firebase client session after a registration", async () => {
    await signOutFirebaseUser(config);

    expect(signOut).toHaveBeenCalledWith("auth");
  });
});
