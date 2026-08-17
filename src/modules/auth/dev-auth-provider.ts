import { AUTH_ERROR_CODES, AuthError } from "./auth-errors";
import type { AuthIdentity, AuthProvider, EmailSignInInput } from "./auth-provider";
import { isDeterministicTestRuntime } from "./runtime-mode";
import {
  clearCurrentIdentity,
  getCurrentIdentitySync,
  setCurrentIdentity,
} from "./session";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hashEmail(email: string): string {
  let hash = 2166136261;

  for (const character of email) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function displayNameFor(email: string): string {
  return email
    .split("@", 1)[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function validateEmail(input: EmailSignInInput): string {
  const email = typeof input?.email === "string" ? input.email.trim().toLowerCase() : "";

  if (!email || !emailPattern.test(email)) {
    throw new AuthError(AUTH_ERROR_CODES.INVALID_EMAIL);
  }

  return email;
}

class InMemoryDevAuthProvider implements AuthProvider {
  async signInWithEmail(input: EmailSignInInput): Promise<AuthIdentity> {
    const email = validateEmail(input);

    if (email === "missing@development.ledgerharbour.local") {
      throw new AuthError(AUTH_ERROR_CODES.MISSING_IDENTITY);
    }

    if (email === "failure@development.ledgerharbour.local") {
      throw new AuthError(AUTH_ERROR_CODES.PROVIDER_FAILURE);
    }

    const identity: AuthIdentity = {
      provider: "development",
      providerUserId: `dev-${hashEmail(email)}`,
      email,
      displayName: displayNameFor(email),
      emailVerified: true,
    };

    await setCurrentIdentity(identity);
    return identity;
  }

  async signInWithGoogle(): Promise<AuthIdentity> {
    const identity: AuthIdentity = {
      provider: "development",
      providerUserId: "dev-google-user",
      email: "google-user@development.ledgerharbour.local",
      displayName: "Development Google User",
      emailVerified: true,
    };

    await setCurrentIdentity(identity);
    return identity;
  }

  async signOut(): Promise<void> {
    await clearCurrentIdentity();
  }

  async getCurrentIdentity(): Promise<AuthIdentity | null> {
    return getCurrentIdentitySync();
  }
}

export class DevAuthProvider extends InMemoryDevAuthProvider {
  constructor() {
    super();

    if (process.env.AUTH_MODE !== "development" || !isDeterministicTestRuntime()) {
      throw new AuthError(AUTH_ERROR_CODES.DEVELOPMENT_MODE_REQUIRED);
    }
  }
}

export function createAuthProvider(): AuthProvider | null {
  if (process.env.AUTH_MODE !== "development" || !isDeterministicTestRuntime()) {
    return null;
  }

  try {
    return new DevAuthProvider();
  } catch {
    return null;
  }
}
