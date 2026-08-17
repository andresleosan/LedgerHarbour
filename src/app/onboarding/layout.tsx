import type { ReactNode } from "react";

import { getFirebaseClientConfig } from "@/modules/auth/firebase-config";
import OnboardingFirebaseConfigProvider from "@/ui/OnboardingFirebaseConfigProvider";

export const dynamic = "force-dynamic";

export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return (
    <OnboardingFirebaseConfigProvider config={getFirebaseClientConfig()}>
      {children}
    </OnboardingFirebaseConfigProvider>
  );
}
