import { describe, expect, it, vi } from "vitest";

import { createBusinessRequest, createInMemoryOnboardingRepository } from "../../src/modules/tenancy/business-service";
import { createInMemoryPlatformRepository, createPlatformService } from "../../src/modules/platform/platform-service";
import { createInMemoryProjectRepository, createProjectService, PROJECT_ERROR_CODES } from "../../src/modules/projects/project-service";
import type { AuthIdentity } from "../../src/modules/auth/auth-provider";
import type { UserId } from "../../src/modules/tenancy/types";
import { testServiceExpiresAt } from "../helpers/business-fixtures";

vi.mock("../../src/modules/auth/session", () => ({
  getCurrentIdentity: vi.fn(async () => ({
    provider: "firebase",
    providerUserId: "ordinary-project-user",
    email: "ordinary-project-user@example.com",
    displayName: "Ordinary Project User",
    emailVerified: true,
  } satisfies AuthIdentity)),
}));

describe("project tenant isolation", () => {
  it("does not allow a business admin or platform route caller to cross project tenants", async () => {
    const tenancy = createInMemoryOnboardingRepository();
    const platform = createInMemoryPlatformRepository();
    const projects = createInMemoryProjectRepository();
    const platformAdmin = "platform-admin" as UserId;
    platform.addMember({ id: "platform-1", userId: platformAdmin, normalizedEmail: "platform@example.com" });
    const businessA = await createBusinessRequest({ name: "Business A" }, "owner-a" as UserId, tenancy);
    const businessB = await createBusinessRequest({ name: "Business B" }, "owner-b" as UserId, tenancy);
    const platformService = createPlatformService({ tenancyRepository: tenancy, platformRepository: platform });
    await platformService.approveBusiness(businessA.id, platformAdmin, { serviceExpiresAt: testServiceExpiresAt(), reason: "Isolation setup" });
    await platformService.approveBusiness(businessB.id, platformAdmin, { serviceExpiresAt: testServiceExpiresAt(), reason: "Isolation setup" });
    const service = createProjectService({ tenancyRepository: tenancy, projectRepository: projects, platformRepository: platform });
    const projectA = await service.createProjectRequest(businessA.id, "owner-a" as UserId, { name: "Project A" });

    await expect(service.listProjectsForBusiness(businessB.id, "owner-a" as UserId)).rejects.toMatchObject({ code: PROJECT_ERROR_CODES.BUSINESS_ACCESS_DENIED });
    await expect(service.addProjectMember(businessB.id, projectA.id, "owner-b" as UserId, { userId: "owner-b" as UserId, role: "member" })).rejects.toMatchObject({ code: PROJECT_ERROR_CODES.PROJECT_NOT_FOUND });
  });

  it("denies global project administration to a linked business user", async () => {
    const tenancy = createInMemoryOnboardingRepository();
    const platform = createInMemoryPlatformRepository();
    const projects = createInMemoryProjectRepository();
    const business = await createBusinessRequest({ name: "Global Denial Harbour" }, "owner" as UserId, tenancy);
    platform.addMember({ id: "platform-1", userId: "platform-admin" as UserId, normalizedEmail: "platform@example.com" });
  await createPlatformService({ tenancyRepository: tenancy, platformRepository: platform }).approveBusiness(business.id, "platform-admin" as UserId, { serviceExpiresAt: testServiceExpiresAt(), reason: "Isolation setup" });
    const service = createProjectService({ tenancyRepository: tenancy, projectRepository: projects, platformRepository: platform });
    const project = await service.createProjectRequest(business.id, "owner" as UserId, { name: "Global Denial Project" });

    await expect(service.listProjects("owner" as UserId)).rejects.toMatchObject({ code: PROJECT_ERROR_CODES.PLATFORM_ACCESS_DENIED });
    await expect(service.approveProject(project.id, "owner" as UserId, { reason: "Unauthorized approval" })).rejects.toMatchObject({ code: PROJECT_ERROR_CODES.PLATFORM_ACCESS_DENIED });
  });
});
