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

export function testServiceExpiresAt(days = 30): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}
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
    .approveBusiness(requested.id, TEST_PLATFORM_ADMIN, { serviceExpiresAt: testServiceExpiresAt(), reason: "Test approval" });
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
