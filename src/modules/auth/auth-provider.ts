export interface AuthIdentity {
  readonly providerUserId: string;
  readonly email: string;
  readonly displayName: string;
  readonly emailVerified: boolean;
}

export interface EmailSignInInput {
  readonly email: string;
}

export interface AuthProvider {
  signInWithEmail(input: EmailSignInInput): Promise<AuthIdentity>;
  signInWithGoogle(): Promise<AuthIdentity>;
  signOut(): Promise<void>;
  getCurrentIdentity(): Promise<AuthIdentity | null>;
}

export interface AuthProviderActions {
  signInWithEmail(input: EmailSignInInput): Promise<AuthIdentity>;
  signInWithGoogle(): Promise<AuthIdentity>;
  signOut(): Promise<void>;
  getCurrentIdentity(): Promise<AuthIdentity | null>;
}

export function createAuthProviderFromActions(actions: AuthProviderActions): AuthProvider {
  return actions;
}
