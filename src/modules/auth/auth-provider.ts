export type AuthProviderKind = "firebase" | "development";

export interface AuthIdentity {
  readonly provider?: AuthProviderKind;
  readonly providerUserId: string;
  readonly email: string;
  readonly displayName: string;
  readonly emailVerified: boolean;
}

export interface EmailSignInInput {
  readonly email: string;
  readonly idToken?: string;
}

export interface GoogleSignInInput {
  readonly idToken?: string;
}

export interface AuthProvider {
  signInWithEmail(input: EmailSignInInput): Promise<AuthIdentity>;
  signInWithGoogle(input?: GoogleSignInInput): Promise<AuthIdentity>;
  signOut(): Promise<void>;
  getCurrentIdentity(): Promise<AuthIdentity | null>;
}

export interface AuthProviderActions {
  signInWithEmail(input: EmailSignInInput): Promise<AuthIdentity>;
  signInWithGoogle(input?: GoogleSignInInput): Promise<AuthIdentity>;
  signOut(): Promise<void>;
  getCurrentIdentity(): Promise<AuthIdentity | null>;
}

export function createAuthProviderFromActions(actions: AuthProviderActions): AuthProvider {
  return actions;
}
