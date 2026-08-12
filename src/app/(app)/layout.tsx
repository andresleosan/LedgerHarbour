import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { clearCurrentIdentity, getCurrentIdentity } from "@/modules/auth/session";
import { listUserBusinesses } from "@/modules/tenancy/portfolio-service";
import AppShell from "@/ui/AppShell";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const identity = getCurrentIdentity();
  if (!identity) redirect("/login");

  const businesses = await listUserBusinesses(identity);
  const locale = "en" as const;

  async function signOutAction() {
    "use server";
    await clearCurrentIdentity();
    redirect("/login");
  }

  return <AppShell identity={identity} businesses={businesses} locale={locale} signOutAction={signOutAction}>{children}</AppShell>;
}
