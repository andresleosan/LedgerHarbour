import { getCurrentIdentity } from "@/modules/auth/session";
import PlatformAdminPanel from "@/ui/platform/PlatformAdminPanel";
import { loadPlatformSummary } from "../admin-data";

export default async function PlatformBusinessesPage({ searchParams }: { searchParams?: Promise<{ locale?: string }> }) {
  const identity = await getCurrentIdentity();
  if (!identity) return null;
  const summary = await loadPlatformSummary(identity);
  const locale = (await searchParams)?.locale === "es" ? "es" : "en";
  return <PlatformAdminPanel summary={summary} locale={locale} section="businesses" />;
}
