import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { signOutAction } from "@/app/onboarding/actions";
import { getCurrentIdentity } from "@/modules/auth/session";
import { getFirebaseClientConfig } from "@/modules/auth/firebase-config";
import { PlatformError } from "@/modules/platform/platform-service";
import { requirePlatformMember } from "@/modules/platform/platform-service";
import { getPersistenceContext } from "@/modules/persistence/repository-factory";
import PlatformShell from "@/ui/platform/PlatformShell";

export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const identity = await getCurrentIdentity();
  if (!identity) redirect("/login");

  const persistence = getPersistenceContext();
  try {
    await requirePlatformMember(identity, persistence.tenancyRepository, persistence.platformRepository);
  } catch (error) {
    if (error instanceof PlatformError) redirect("/portfolio");
    throw error;
  }

  const firebaseConfig = process.env.AUTH_MODE === "firebase" ? getFirebaseClientConfig() : undefined;
  return <PlatformShell identity={identity} locale="en" firebaseConfig={firebaseConfig} signOutAction={signOutAction}>{children}</PlatformShell>;
}
