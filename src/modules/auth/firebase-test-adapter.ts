import type { FirebaseAdminAuth, FirebaseDecodedToken } from "./firebase-auth-provider";
import { isTestEnvironment } from "./runtime-mode";

const TOKEN_PREFIX = "ledgerharbour-test-firebase:";
const SESSION_PREFIX = "ledgerharbour-test-session:";
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function decodeToken(value: string, prefix: string): FirebaseDecodedToken {
  if (!value.startsWith(prefix)) throw new Error("Invalid deterministic Firebase token");
  const encodedEmail = value.slice(prefix.length);
  const email = decodeURIComponent(encodedEmail).trim().toLowerCase();
  if (!emailPattern.test(email)) throw new Error("Invalid deterministic Firebase email");
  return {
    uid: `test-firebase-${email}`,
    email,
    name: email.split("@", 1)[0].replace(/^./, (character) => character.toUpperCase()),
    email_verified: true,
  };
}

function sessionFor(token: string): string {
  return `${SESSION_PREFIX}${token}`;
}

export function deterministicFirebaseToken(email: string): string {
  return `${TOKEN_PREFIX}${encodeURIComponent(email.trim().toLowerCase())}`;
}

export function createDeterministicFirebaseAdminAuth(): FirebaseAdminAuth {
  if (!isTestEnvironment()) throw new Error("Deterministic Firebase auth requires NODE_ENV=test");

  return {
    async verifyIdToken(idToken) {
      return decodeToken(idToken, TOKEN_PREFIX);
    },
    async createSessionCookie(idToken) {
      decodeToken(idToken, TOKEN_PREFIX);
      return sessionFor(idToken);
    },
    async verifySessionCookie(cookie) {
      if (!cookie.startsWith(SESSION_PREFIX)) throw new Error("Invalid deterministic Firebase session");
      return decodeToken(cookie.slice(SESSION_PREFIX.length), TOKEN_PREFIX);
    },
  };
}
