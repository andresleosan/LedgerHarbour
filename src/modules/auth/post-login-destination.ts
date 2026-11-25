import type { AuthIdentity } from "./auth-provider";
import {
  PlatformError,
  PLATFORM_ERROR_CODES,
  requirePlatformMember,
  type PlatformRepository,
} from "../platform/platform-service";
import type { OnboardingRepository } from "../tenancy/business-service";
import { listUserBusinesses } from "../tenancy/portfolio-service";

export interface PostLoginDestinationDependencies {
  tenancyRepository: OnboardingRepository;
  platformRepository: PlatformRepository;
}

export async function resolvePostLoginDestination(
  identity: AuthIdentity,
  dependencies: PostLoginDestinationDependencies,
): Promise<"/admin" | "/portfolio" | "/onboarding"> {
  try {
    await requirePlatformMember(
      identity,
      dependencies.tenancyRepository,
      dependencies.platformRepository,
    );
    return "/admin";
  } catch (error) {
    if (error instanceof PlatformError && error.code === PLATFORM_ERROR_CODES.PLATFORM_ACCESS_DENIED) {
      const businesses = await listUserBusinesses(identity, { tenancyRepository: dependencies.tenancyRepository });
      return businesses.length > 0 ? "/portfolio" : "/onboarding";
    }
    throw error;
  }
}
