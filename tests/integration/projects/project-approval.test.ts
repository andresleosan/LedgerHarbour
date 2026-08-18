import { describe, expect, it } from "vitest";

import { createTestDatabase } from "../../../src/db/test-database";
import { createOnboardingServices } from "../../../src/modules/tenancy/business-service";
import { createPostgresOnboardingRepository } from "../../../src/modules/tenancy/postgres-tenancy-repository";
import { createPlatformService, createPostgresPlatformRepository } from "../../../src/modules/platform/platform-service";
import { createPostgresProjectRepository, createProjectService } from "../../../src/modules/projects/project-service";
import { testServiceExpiresAt } from "../../helpers/business-fixtures";

describe("PostgreSQL project approval lifecycle", () => {
  it("keeps a project pending, grants access after approval, and denies it after parent suspension", async () => {
    const { db, close } = await createTestDatabase();

    try {
      const tenancy = createPostgresOnboardingRepository(db);
      const platform = createPostgresPlatformRepository(db);
      const projects = createPostgresProjectRepository(db);
      const requester = {
        provider: "firebase",
        providerUserId: "project-requester",
        email: "project-requester@example.com",
        displayName: "Project Requester",
        emailVerified: true,
      } as const;
      const admin = {
        provider: "firebase",
        providerUserId: "project-platform-admin",
        email: "project-platform@example.com",
        displayName: "Project Platform Admin",
        emailVerified: true,
      } as const;
      const business = await createOnboardingServices(tenancy).createBusinessRequest({ name: "Postgres Project Harbour" }, requester);
      await platform.bootstrapMember("project-platform-1", admin.email);
      await createPlatformService({ tenancyRepository: tenancy, platformRepository: platform }).claimPlatformMember(admin);
      await createPlatformService({ tenancyRepository: tenancy, platformRepository: platform }).approveBusiness(business.id, admin, {
        serviceExpiresAt: testServiceExpiresAt(),
        reason: "Project approval setup",
      });
      const service = createProjectService({ tenancyRepository: tenancy, projectRepository: projects, platformRepository: platform });

      const project = await service.createProjectRequest(business.id, requester, { name: "Postgres Project" });
      await expect(service.getEffectiveProjectAccess(project.id, requester)).resolves.toMatchObject({ allowed: false, reason: "project_pending" });
      await service.approveProject(project.id, admin, { reason: "Project approval" });
      await expect(service.getEffectiveProjectAccess(project.id, requester)).resolves.toMatchObject({ allowed: true });

      await createPlatformService({ tenancyRepository: tenancy, platformRepository: platform }).suspendBusiness(business.id, admin, { reason: "Parent suspension" });
      await expect(service.getEffectiveProjectAccess(project.id, requester)).resolves.toMatchObject({ allowed: false, reason: "business_suspended" });
    } finally {
      await close();
    }
  }, 30_000);
});
