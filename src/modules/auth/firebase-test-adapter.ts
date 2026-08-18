import type { FirebaseAdminAuth, FirebaseDecodedToken } from "./firebase-auth-provider";
import { isTestEnvironment } from "./runtime-mode";

const TOKEN_PREFIX = "ledgerharbour-test-firebase:";
const SESSION_PREFIX = "ledgerharbour-test-session:";
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function decodeToken(value: string, prefix: string): FirebaseDecodedToken {
  if (!value.startsWith(prefix)) throw new Error("Invalid deterministic Firebase token");
  const encodedEmail = value.slice(prefix.length);
  const decodedPayload = decodeURIComponent(encodedEmail);
  const separator = decodedPayload.indexOf("|");
  const email = (separator === -1 ? decodedPayload : decodedPayload.slice(0, separator)).trim().toLowerCase();
  const providerUserId = separator === -1 ? `test-firebase-${email}` : decodedPayload.slice(separator + 1).trim();
  if (!emailPattern.test(email)) throw new Error("Invalid deterministic Firebase email");
  if (!providerUserId) throw new Error("Invalid deterministic Firebase user");
  return {
    uid: providerUserId,
    email,
    name: email.split("@", 1)[0].replace(/^./, (character) => character.toUpperCase()),
    email_verified: true,
  };
}

function sessionFor(token: string): string {
  return `${SESSION_PREFIX}${token}`;
}

export function deterministicFirebaseToken(email: string, providerUserId?: string): string {
  const normalizedEmail = email.trim().toLowerCase();
  const suffix = providerUserId ? `|${providerUserId.trim()}` : "";
  return `${TOKEN_PREFIX}${encodeURIComponent(`${normalizedEmail}${suffix}`)}`;
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
