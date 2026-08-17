"use client";

import { signOutAction } from "@/app/onboarding/actions";
import { firebaseClientConfigFromEnv, signOutFirebaseUser } from "@/modules/auth/firebase-client";

export default function OnboardingSignOut({ label }: { label: string }) {
  const firebaseConfig = firebaseClientConfigFromEnv();

  return (
    <form
      action={signOutAction}
      onSubmit={async (event) => {
        event.preventDefault();
        try {
          await signOutFirebaseUser(firebaseConfig);
        } finally {
          await signOutAction();
        }
      }}
    >
      <button className="sign-out" type="submit">{label}</button>
    </form>
  );
}
