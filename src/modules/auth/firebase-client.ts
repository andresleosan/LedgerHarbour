"use client";

import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  type UserCredential,
} from "firebase/auth";

export interface FirebaseClientConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

function firebaseApp(config: FirebaseClientConfig): FirebaseApp {
  return getApps()[0] ?? initializeApp(config);
}

export async function signInWithFirebaseEmail(config: FirebaseClientConfig, email: string, password: string, register: boolean): Promise<UserCredential> {
  const auth = getAuth(firebaseApp(config));
  return register ? createUserWithEmailAndPassword(auth, email, password) : signInWithEmailAndPassword(auth, email, password);
}

export async function signInWithFirebaseGoogle(config: FirebaseClientConfig): Promise<UserCredential> {
  const auth = getAuth(firebaseApp(config));
  return signInWithPopup(auth, new GoogleAuthProvider());
}
