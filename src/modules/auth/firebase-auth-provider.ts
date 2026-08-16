import { AUTH_ERROR_CODES, AuthError } from "./auth-errors";
import type { AuthIdentity, AuthProvider, EmailSignInInput, GoogleSignInInput } from "./auth-provider";
import { FIREBASE_SESSION_MAX_AGE, firebaseSessionStore, type FirebaseSessionStore } from "./firebase-session";
import { createFirebaseAdminAuth } from "./firebase-admin";

export interface FirebaseDecodedToken {
  readonly uid: string;
  readonly email?: string;
  readonly name?: string;
  readonly email_verified?: boolean;
}

export interface FirebaseAdminAuth {
  verifyIdToken(idToken: string, checkRevoked?: boolean): Promise<FirebaseDecodedToken>;
  createSessionCookie(idToken: string, options: { expiresIn: number }): Promise<string>;
  verifySessionCookie(cookie: string, checkRevoked?: boolean): Promise<FirebaseDecodedToken>;
}

export { type FirebaseSessionStore } from "./firebase-session";

function identityFromToken(token: FirebaseDecodedToken): AuthIdentity {
  if (typeof token.uid !== "string" || !token.uid || typeof token.email !== "string" || !token.email) {
    throw new AuthError(AUTH_ERROR_CODES.MISSING_IDENTITY);
  }
  return {
    providerUserId: token.uid,
    email: token.email.toLowerCase(),
    displayName: token.name?.trim() || token.email.split("@", 1)[0],
    emailVerified: token.email_verified === true,
  };
}

export interface FirebaseAuthProviderOptions {
  auth?: FirebaseAdminAuth;
  sessions?: FirebaseSessionStore;
}

export class FirebaseAuthProvider implements AuthProvider {
  private readonly auth: FirebaseAdminAuth;
  private readonly sessions: FirebaseSessionStore;

  constructor(options: FirebaseAuthProviderOptions = {}) {
    this.auth = options.auth ?? createFirebaseAdminAuth();
    this.sessions = options.sessions ?? firebaseSessionStore;
  }

  async signInWithEmail(input: EmailSignInInput): Promise<AuthIdentity> {
    const email = typeof input?.email === "string" ? input.email : undefined;
    const idToken = typeof input?.idToken === "string" ? input.idToken : undefined;
    return this.signInWithToken(idToken, email);
  }

  async signInWithGoogle(input: GoogleSignInInput = {}): Promise<AuthIdentity> {
    return this.signInWithToken(typeof input?.idToken === "string" ? input.idToken : undefined);
  }

  private async signInWithToken(idToken: string | undefined, expectedEmail?: string): Promise<AuthIdentity> {
    try {
      if (typeof idToken !== "string" || !idToken.trim() || idToken.length > 8192) throw new Error("Invalid Firebase token");
      const decoded = await this.auth.verifyIdToken(idToken, true);
      if (expectedEmail && decoded.email?.toLowerCase() !== expectedEmail.trim().toLowerCase()) {
        throw new Error("Firebase email mismatch");
      }
      const identity = identityFromToken(decoded);
      const session = await this.auth.createSessionCookie(idToken, { expiresIn: FIREBASE_SESSION_MAX_AGE * 1000 });
      await this.sessions.set(session);
      return identity;
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError(AUTH_ERROR_CODES.PROVIDER_FAILURE, error);
    }
  }

  async signOut(): Promise<void> {
    await this.sessions.clear();
  }

  async getCurrentIdentity(): Promise<AuthIdentity | null> {
    const session = await this.sessions.get();
    if (!session) return null;
    try {
      return identityFromToken(await this.auth.verifySessionCookie(session, true));
    } catch {
      await this.sessions.clear();
      return null;
    }
  }
}
