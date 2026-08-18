"use client";

import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithRedirect,
  signOut,
  type UserCredential,
} from "firebase/auth";
import type { AuthIdentity, GoogleSignInInput } from "./auth-provider";
import type { FirebaseClientConfig } from "./firebase-config";
import { AUTH_ERROR_CODES, AuthError } from "./auth-errors";

export type { FirebaseClientConfig } from "./firebase-config";

function firebaseApp(config: FirebaseClientConfig): FirebaseApp {
  return getApps()[0] ?? initializeApp(config);
}

const googleRedirectResults = new Map<string, Promise<UserCredential | null>>();

export interface FirebaseGoogleCredential {
  readonly user: {
    readonly email?: string | null;
    getIdToken(): Promise<string>;
  };
}

const testEmailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isTestEnvironment = () => process.env.NEXT_PUBLIC_FIREBASE_TEST_ADAPTER === "true";
const testToken = (email: string) => `ledgerharbour-test-firebase:${encodeURIComponent(email.trim().toLowerCase())}`;

function deterministicCredential(email: string): FirebaseGoogleCredential {
  const normalized = email.trim().toLowerCase();
  if (!testEmailPattern.test(normalized)) throw new AuthError(AUTH_ERROR_CODES.INVALID_EMAIL);
  return {
    user: {
      email: normalized,
      getIdToken: async () => testToken(normalized),
    },
  };
}

function firebaseConfigKey(config: FirebaseClientConfig): string {
  return `${config.authDomain}:${config.projectId}:${config.appId}`;
}

export async function signInWithFirebaseEmail(config: FirebaseClientConfig, email: string, password: string, register: boolean): Promise<UserCredential> {
  if (isTestEnvironment()) return deterministicCredential(email) as UserCredential;
  const auth = getAuth(firebaseApp(config));
  return register ? createUserWithEmailAndPassword(auth, email, password) : signInWithEmailAndPassword(auth, email, password);
}

export async function startFirebaseGoogleRedirect(config: FirebaseClientConfig): Promise<void> {
  if (isTestEnvironment()) return;
  const auth = getAuth(firebaseApp(config));
  await signInWithRedirect(auth, new GoogleAuthProvider());
}

export async function getFirebaseGoogleRedirectResult(config: FirebaseClientConfig): Promise<UserCredential | null> {
  if (isTestEnvironment()) return null;
  const auth = getAuth(firebaseApp(config));
  const key = firebaseConfigKey(config);
  const existingResult = googleRedirectResults.get(key);
  if (existingResult) return existingResult;

  const result = getRedirectResult(auth).finally(() => googleRedirectResults.delete(key));
  googleRedirectResults.set(key, result);
  return result;
}

export async function signInWithFirebaseCredential(
  credential: FirebaseGoogleCredential,
  signInWithGoogle: (input: GoogleSignInInput) => Promise<AuthIdentity>,
): Promise<AuthIdentity> {
  return signInWithGoogle({ idToken: await credential.user.getIdToken() });
}

export async function signOutFirebaseUser(config?: FirebaseClientConfig): Promise<void> {
  if (isTestEnvironment()) return;
  const app = getApps()[0] ?? (config ? firebaseApp(config) : null);
  if (!app) return;
  await signOut(getAuth(app));
}
