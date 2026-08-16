import { cookies, type UnsafeUnwrappedCookies } from "next/headers";
import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";
import { createHmac, timingSafeEqual } from "node:crypto";

import type { AuthIdentity } from "./auth-provider";
import { FirebaseAuthProvider } from "./firebase-auth-provider";

export const DEV_SESSION_COOKIE = "ledgerharbour_dev_session";
export const DEV_SESSION_MAX_AGE = 5 * 60;

interface StoredSession {
  readonly identity: AuthIdentity;
  readonly expiresAt: number;
}

const isDevelopmentMode = () => process.env.AUTH_MODE === "development" && process.env.NODE_ENV !== "production";
const sessionSecret = () => process.env.DEV_SESSION_SECRET;

function getRequestCookies(): UnsafeUnwrappedCookies | null {
  const requestStore = workUnitAsyncStorage.getStore();
  if (requestStore?.type === "request") {
    return requestStore.cookies as UnsafeUnwrappedCookies;
  }

  try {
    return cookies() as unknown as UnsafeUnwrappedCookies;
  } catch {
    return null;
  }
}

async function getRequestCookiesAsync(): Promise<UnsafeUnwrappedCookies | null> {
  try {
    return (await cookies()) as unknown as UnsafeUnwrappedCookies;
  } catch {
    return null;
  }
}

function encodeSession(session: StoredSession): string {
  const payload = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  const secret = sessionSecret();
  if (!secret) return "";
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function decodeSession(value: string): StoredSession | null {
  try {
    const [payload, signature] = value.split(".");
    const secret = sessionSecret();
    if (!secret || !payload || !signature || value.split(".").length !== 2) return null;
    const expectedSignature = createHmac("sha256", secret).update(payload).digest("base64url");
    const actual = Buffer.from(signature, "base64url");
    const expected = Buffer.from(expectedSignature, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      identity?: Partial<AuthIdentity>;
      expiresAt?: unknown;
    };
    const identity = parsed.identity;

    if (
      !identity ||
      typeof identity.providerUserId !== "string" ||
      typeof identity.email !== "string" ||
      typeof identity.displayName !== "string" ||
      typeof identity.emailVerified !== "boolean" ||
      typeof parsed.expiresAt !== "number" ||
      !Number.isFinite(parsed.expiresAt)
    ) {
      return null;
    }

    return {
      identity: identity as AuthIdentity,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

export async function setCurrentIdentity(identity: AuthIdentity): Promise<void> {
  if (!isDevelopmentMode()) {
    return;
  }

  if (!sessionSecret()) {
    return;
  }

  const session = {
    identity: { ...identity },
    expiresAt: Date.now() + DEV_SESSION_MAX_AGE * 1000,
  } satisfies StoredSession;
  const encodedSession = encodeSession(session);
  if (!encodedSession) {
    return;
  }

  (await getRequestCookiesAsync())?.set(DEV_SESSION_COOKIE, encodedSession, {
    httpOnly: true,
    maxAge: DEV_SESSION_MAX_AGE,
    path: "/",
    sameSite: "lax",
  });
}

export function getCurrentIdentitySync(): AuthIdentity | null {
  if (!isDevelopmentMode()) {
    return null;
  }

  if (!sessionSecret()) {
    return null;
  }

  const requestCookies = getRequestCookies();
  if (requestCookies === null) {
    return null;
  }

  const sessionValue = requestCookies.get(DEV_SESSION_COOKIE)?.value;
  if (!sessionValue) {
    return null;
  }

  const session = decodeSession(sessionValue);
  if (!session || session.expiresAt <= Date.now()) {
    return null;
  }

  return { ...session.identity };
}

export async function getCurrentIdentity(): Promise<AuthIdentity | null> {
  if (process.env.AUTH_MODE === "firebase") {
    try {
      return await new FirebaseAuthProvider().getCurrentIdentity();
    } catch {
      return null;
    }
  }
  if (!isDevelopmentMode()) return null;
  return getCurrentIdentitySync();
}

export async function clearCurrentIdentity(): Promise<void> {
  if (process.env.AUTH_MODE === "firebase") {
    try { await new FirebaseAuthProvider().signOut(); } catch { /* cookie cleanup is best effort */ }
    return;
  }
  if (!isDevelopmentMode()) {
    return;
  }

  const requestCookies = await getRequestCookiesAsync();
  requestCookies?.delete(DEV_SESSION_COOKIE);
}
