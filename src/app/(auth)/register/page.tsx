import AuthForm from "@/ui/auth/AuthForm";
import { AuthError, AUTH_ERROR_CODES } from "@/modules/auth/auth-errors";
import type { EmailSignInInput } from "@/modules/auth/auth-provider";
import type { AuthIdentity } from "@/modules/auth/auth-provider";
import { createAuthProvider } from "@/modules/auth/dev-auth-provider";

function requireDevelopmentProvider() {
  const provider = createAuthProvider();

  if (provider === null) {
    throw new AuthError(AUTH_ERROR_CODES.DEVELOPMENT_MODE_REQUIRED);
  }

  return provider;
}

async function signInWithEmail(input: EmailSignInInput): Promise<AuthIdentity> {
  "use server";
  return requireDevelopmentProvider().signInWithEmail(input);
}

async function signInWithGoogle(): Promise<AuthIdentity> {
  "use server";
  return requireDevelopmentProvider().signInWithGoogle();
}

async function signOut(): Promise<void> {
  "use server";
  return requireDevelopmentProvider().signOut();
}

async function getCurrentIdentity(): Promise<AuthIdentity | null> {
  "use server";
  return requireDevelopmentProvider().getCurrentIdentity();
}

export default function RegisterPage() {
  return (
    <AuthForm
      mode="register"
      providerActions={{ signInWithEmail, signInWithGoogle, signOut, getCurrentIdentity }}
    />
  );
}
