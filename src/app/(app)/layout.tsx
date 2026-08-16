import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { clearCurrentIdentity, getCurrentIdentity } from "@/modules/auth/session";
import { listUserBusinesses } from "@/modules/tenancy/portfolio-service";
import { getPersistenceContext } from "@/modules/persistence/repository-factory";
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
    ? {
        apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
        authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
        appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
      }
    : undefined;

  async function signOutAction() {
    "use server";
    await clearCurrentIdentity();
    redirect("/login");
  }

  return <AppShell identity={identity} businesses={businesses} locale={locale} firebaseConfig={firebaseConfig} signOutAction={signOutAction}>{children}</AppShell>;
}
