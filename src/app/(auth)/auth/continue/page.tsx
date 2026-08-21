import { redirect } from "next/navigation";

import { resolveLocale, withLocale } from "@/i18n/locale";
import { getCurrentIdentity } from "@/modules/auth/session";
import { resolvePostLoginDestination } from "@/modules/auth/post-login-destination";
import { getPersistenceContext } from "@/modules/persistence/repository-factory";

export const dynamic = "force-dynamic";

interface PostLoginContinuationPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PostLoginContinuationPage({ searchParams }: PostLoginContinuationPageProps) {
  const rawSearchParams = await searchParams;
  const currentSearchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(rawSearchParams)) {
    if (Array.isArray(value)) {
      for (const item of value) currentSearchParams.append(key, item);
    } else if (value !== undefined) {
      currentSearchParams.set(key, value);
    }
  }
  const locale = resolveLocale(currentSearchParams.get("locale"));

  const identity = await getCurrentIdentity();
  if (!identity) redirect(withLocale("/login", currentSearchParams, locale));

  const persistence = getPersistenceContext();
  const destination = await resolvePostLoginDestination(identity, {
    tenancyRepository: persistence.tenancyRepository,
    platformRepository: persistence.platformRepository,
  });
  redirect(withLocale(destination, currentSearchParams, locale));
}
