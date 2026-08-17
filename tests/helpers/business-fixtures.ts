import {
  createBusiness,
  createInMemoryOnboardingRepository,
  createOnboardingServices,
  type Business,
  type OnboardingActor,
  type OnboardingRepository,
} from "../../src/modules/tenancy/business-service";
import { createInMemoryPlatformRepository, createPlatformService } from "../../src/modules/platform/platform-service";
import type { UserId } from "../../src/modules/tenancy/types";

export const TEST_SERVICE_EXPIRES_AT = "2026-09-16T00:00:00.000Z";
export const TEST_PLATFORM_ADMIN = "test-platform-admin" as UserId;

export async function createApprovedBusiness(
  repository: OnboardingRepository,
  name: string,
  requester: OnboardingActor,
): Promise<Business> {
  const requested = await createBusiness({ name }, requester, repository);
  const platform = createInMemoryPlatformRepository();
  platform.addMember({
    id: "test-platform-member",
    userId: TEST_PLATFORM_ADMIN,
    normalizedEmail: "test-platform-admin@example.com",
  });
  return createPlatformService({ tenancyRepository: repository, platformRepository: platform })
    .approveBusiness(requested.id, TEST_PLATFORM_ADMIN, { serviceExpiresAt: TEST_SERVICE_EXPIRES_AT });
}

export async function createApprovedMemoryBusiness(
  name: string,
  requester: OnboardingActor,
): Promise<{ business: Business; repository: ReturnType<typeof createInMemoryOnboardingRepository> }> {
  const repository = createInMemoryOnboardingRepository();
  const business = await createApprovedBusiness(repository, name, requester);
  return { business, repository };
}

export function createApprovedOnboardingServices(repository: OnboardingRepository = createInMemoryOnboardingRepository()) {
  return {
    repository,
    services: createOnboardingServices(repository),
  };
}
