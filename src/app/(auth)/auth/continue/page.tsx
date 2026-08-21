import { redirect } from "next/navigation";

import { resolveLocale, withLocale } from "../../../../i18n/locale";
import { getCurrentIdentity } from "../../../../modules/auth/session";
import { resolvePostLoginDestination } from "../../../../modules/auth/post-login-destination";
import { getPersistenceContext } from "../../../../modules/persistence/repository-factory";

export const dynamic = "force-dynamic";

export type PostLoginDestination = "/admin" | "/onboarding" | "/login";
export type PostLoginSearchParams = Record<string, string | string[] | undefined>;

function buildPostLoginRedirect(
  destination: PostLoginDestination,
  rawSearchParams: PostLoginSearchParams,
): string {
  const currentSearchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(rawSearchParams)) {
    if (Array.isArray(value)) {
      for (const item of value) currentSearchParams.append(key, item);
    } else if (value !== undefined) {
      currentSearchParams.set(key, value);
    }
  }

  return withLocale(destination, currentSearchParams, resolveLocale(currentSearchParams.get("locale")));
}

interface PostLoginContinuationPageProps {
  searchParams: Promise<PostLoginSearchParams>;
}

async function PostLoginContinuationPage({ searchParams }: PostLoginContinuationPageProps) {
  const rawSearchParams = await searchParams;

  const identity = await getCurrentIdentity();
  if (!identity) redirect(buildPostLoginRedirect("/login", rawSearchParams));

  const persistence = getPersistenceContext();
  const destination = await resolvePostLoginDestination(identity, {
    tenancyRepository: persistence.tenancyRepository,
    platformRepository: persistence.platformRepository,
  });
  redirect(buildPostLoginRedirect(destination, rawSearchParams));
}

export default Object.assign(PostLoginContinuationPage, { buildPostLoginRedirect });
