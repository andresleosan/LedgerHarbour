import { redirect } from "next/navigation";

import { getCurrentIdentity } from "@/modules/auth/session";
import { resolvePostLoginDestination } from "@/modules/auth/post-login-destination";
import { getPersistenceContext } from "@/modules/persistence/repository-factory";

export const dynamic = "force-dynamic";

export default async function PostLoginContinuationPage() {
  const identity = await getCurrentIdentity();
  if (!identity) redirect("/login");

  const persistence = getPersistenceContext();
  const destination = await resolvePostLoginDestination(identity, {
    tenancyRepository: persistence.tenancyRepository,
    platformRepository: persistence.platformRepository,
  });
  redirect(destination);
}
