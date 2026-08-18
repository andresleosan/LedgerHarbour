import type { AuthIdentity } from "./auth-provider";
import {
  PlatformError,
  PLATFORM_ERROR_CODES,
  requirePlatformMember,
  type PlatformRepository,
} from "../platform/platform-service";
import type { OnboardingRepository } from "../tenancy/business-service";

export interface PostLoginDestinationDependencies {
  tenancyRepository: OnboardingRepository;
  platformRepository: PlatformRepository;
}

export async function resolvePostLoginDestination(
  identity: AuthIdentity,
  dependencies: PostLoginDestinationDependencies,
): Promise<"/admin" | "/onboarding"> {
  try {
    await requirePlatformMember(
      identity,
      dependencies.tenancyRepository,
      dependencies.platformRepository,
    );
    return "/admin";
  } catch (error) {
    if (error instanceof PlatformError && error.code === PLATFORM_ERROR_CODES.PLATFORM_ACCESS_DENIED) {
      return "/onboarding";
    }
    throw error;
  }
}
