"use client";

import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type UserCredential,
} from "firebase/auth";
import type { AuthIdentity, GoogleSignInInput } from "./auth-provider";

export interface FirebaseClientConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

export function firebaseClientConfigFromEnv(env: NodeJS.ProcessEnv = process.env): FirebaseClientConfig | undefined {
  const apiKey = env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const authDomain = env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const projectId = env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const appId = env.NEXT_PUBLIC_FIREBASE_APP_ID;
  return apiKey && authDomain && projectId && appId ? { apiKey, authDomain, projectId, appId } : undefined;
}

function firebaseApp(config: FirebaseClientConfig): FirebaseApp {
  return getApps()[0] ?? initializeApp(config);
}

const googleRedirectResults = new Map<string, Promise<UserCredential | null>>();

export interface FirebaseGoogleCredential {
  readonly user: {
    getIdToken(): Promise<string>;
  };
}

function firebaseConfigKey(config: FirebaseClientConfig): string {
  return `${config.authDomain}:${config.projectId}:${config.appId}`;
}

export async function signInWithFirebaseEmail(config: FirebaseClientConfig, email: string, password: string, register: boolean): Promise<UserCredential> {
  const auth = getAuth(firebaseApp(config));
  return register ? createUserWithEmailAndPassword(auth, email, password) : signInWithEmailAndPassword(auth, email, password);
}

export async function signInWithFirebaseGoogle(config: FirebaseClientConfig): Promise<UserCredential> {
  const auth = getAuth(firebaseApp(config));
  return signInWithPopup(auth, new GoogleAuthProvider());
}

export async function getFirebaseGoogleRedirectResult(config: FirebaseClientConfig): Promise<UserCredential | null> {
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
  const app = getApps()[0] ?? (config ? firebaseApp(config) : null);
  if (!app) return;
  await signOut(getAuth(app));
}
