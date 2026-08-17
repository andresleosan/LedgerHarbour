import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getCurrentIdentity } from "@/modules/auth/session";
import { getFirebaseClientConfig } from "@/modules/auth/firebase-config";
import { listUserBusinesses } from "@/modules/tenancy/portfolio-service";
import { getPersistenceContext } from "@/modules/persistence/repository-factory";
import { signOutAction } from "@/app/onboarding/actions";
import AppShell from "@/ui/AppShell";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const identity = await getCurrentIdentity();
  if (!identity) redirect("/login");

  const persistence = getPersistenceContext();
  const businesses = await listUserBusinesses(identity, {
    tenancyRepository: persistence.tenancyRepository,
    documentRepository: persistence.documentRepository,
    invoiceRepository: persistence.invoiceRepository,
  });
  const locale = "en" as const;
  const firebaseConfig = process.env.AUTH_MODE === "firebase"
    ? getFirebaseClientConfig()
    : undefined;

  return <AppShell identity={identity} businesses={businesses} locale={locale} firebaseConfig={firebaseConfig} signOutAction={signOutAction}>{children}</AppShell>;
}
