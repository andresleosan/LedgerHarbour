import AuthForm from "@/ui/auth/AuthForm";
import { AuthError, AUTH_ERROR_CODES } from "@/modules/auth/auth-errors";
import type { EmailSignInInput } from "@/modules/auth/auth-provider";
import type { AuthIdentity, GoogleSignInInput, AuthProvider } from "@/modules/auth/auth-provider";
import { createAuthProvider } from "@/modules/auth/dev-auth-provider";
import { FirebaseAuthProvider } from "@/modules/auth/firebase-auth-provider";

function requireProvider(): AuthProvider {
  if (process.env.AUTH_MODE === "firebase") {
    try { return new FirebaseAuthProvider(); } catch { throw new AuthError(AUTH_ERROR_CODES.PROVIDER_FAILURE); }
  }
  const provider = createAuthProvider();

  if (provider === null) {
    throw new AuthError(AUTH_ERROR_CODES.DEVELOPMENT_MODE_REQUIRED);
  }

  return provider;
}

async function signInWithEmail(input: EmailSignInInput): Promise<AuthIdentity> {
  "use server";
  return requireProvider().signInWithEmail(input);
}

async function signInWithGoogle(input?: GoogleSignInInput): Promise<AuthIdentity> {
  "use server";
  return requireProvider().signInWithGoogle(input);
}

async function signOut(): Promise<void> {
  "use server";
  return requireProvider().signOut();
}

async function getCurrentIdentity(): Promise<AuthIdentity | null> {
  "use server";
  return requireProvider().getCurrentIdentity();
}

function firebaseConfig() {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;
  return apiKey && authDomain && projectId && appId ? { apiKey, authDomain, projectId, appId } : undefined;
}

export default function RegisterPage() {
  return (
    <AuthForm
      mode="register"
      authMode={process.env.AUTH_MODE === "firebase" ? "firebase" : "development"}
      firebaseConfig={firebaseConfig()}
      providerActions={{ signInWithEmail, signInWithGoogle, signOut, getCurrentIdentity }}
    />
  );
}
