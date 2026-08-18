import { beforeEach, describe, expect, it, vi } from "vitest";

const signInWithRedirect = vi.hoisted(() => vi.fn());
const getRedirectResult = vi.hoisted(() => vi.fn());
const getApps = vi.hoisted(() => vi.fn(() => [{ name: "app" }]));
const getAuth = vi.hoisted(() => vi.fn(() => "auth"));
const signOut = vi.hoisted(() => vi.fn());

vi.mock("firebase/app", () => ({
  getApps,
  initializeApp: vi.fn(),
}));

vi.mock("firebase/auth", () => ({
  createUserWithEmailAndPassword: vi.fn(),
  getAuth,
  getRedirectResult,
  GoogleAuthProvider: class GoogleAuthProvider {},
  signInWithEmailAndPassword: vi.fn(),
  signInWithRedirect,
  signOut,
}));

import {
  getFirebaseGoogleRedirectResult,
  signInWithFirebaseCredential,
  startFirebaseGoogleRedirect,
  signOutFirebaseUser,
} from "../../src/modules/auth/firebase-client";
import { getFirebaseClientConfig } from "../../src/modules/auth/firebase-config";

const config = {
  apiKey: "api-key",
  authDomain: "example.firebaseapp.com",
  projectId: "example",
  appId: "app-id",
};

const runtimeEnv = (values: Record<string, string>) => values as NodeJS.ProcessEnv;

describe("Firebase Google authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts authentication with a redirect without opening a popup", async () => {
    signInWithRedirect.mockResolvedValue(undefined);

    await expect(startFirebaseGoogleRedirect(config)).resolves.toBeUndefined();
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

  it("does not try to clear Firebase when no client app or config exists", async () => {
    getApps.mockReturnValueOnce([]);

    await expect(signOutFirebaseUser()).resolves.toBeUndefined();

    expect(signOut).not.toHaveBeenCalled();
  });

  it("derives a complete Firebase client config from server-provided public values", () => {
    expect(getFirebaseClientConfig(runtimeEnv({
      AUTH_MODE: "firebase",
      NEXT_PUBLIC_FIREBASE_API_KEY: config.apiKey,
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: config.authDomain,
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: config.projectId,
      NEXT_PUBLIC_FIREBASE_APP_ID: config.appId,
    }))).toEqual(config);
  });

  it("returns no Firebase client config when a public value is missing", () => {
    expect(getFirebaseClientConfig(runtimeEnv({
      AUTH_MODE: "firebase",
      NEXT_PUBLIC_FIREBASE_API_KEY: config.apiKey,
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: config.authDomain,
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: config.projectId,
    }))).toBeUndefined();
  });
});
