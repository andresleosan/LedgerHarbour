import { describe, expect, it } from "vitest";

import { createTestDatabase } from "../../../src/db/test-database";
import { createOnboardingServices } from "../../../src/modules/tenancy/business-service";
import { createPostgresOnboardingRepository } from "../../../src/modules/tenancy/postgres-tenancy-repository";
import {
  createPlatformService,
  createPostgresPlatformRepository,
} from "../../../src/modules/platform/platform-service";

describe("PostgreSQL business approval lifecycle", () => {
  it("keeps the request pending, then atomically grants owner access on approval", async () => {
    const { db, close } = await createTestDatabase();

    try {
      const tenancy = createPostgresOnboardingRepository(db);
      const platform = createPostgresPlatformRepository(db);
      const onboarding = createOnboardingServices(tenancy);
      const requester = {
        providerUserId: "postgres-requester",
        email: "requester@example.com",
        displayName: "Requester",
        emailVerified: true,
      } as const;
      const admin = {
        providerUserId: "postgres-admin",
        email: "admin@example.com",
        displayName: "Platform Admin",
        emailVerified: true,
      } as const;

      const created = await onboarding.createBusinessRequest({ name: "Postgres Pending Harbour" }, requester);
      await expect(tenancy.listMemberships(created.id)).resolves.toEqual([]);
      await platform.bootstrapMember("platform-admin-1", admin.email);

      const service = createPlatformService({ tenancyRepository: tenancy, platformRepository: platform });
      await service.claimPlatformMember(admin);
      const approved = await service
        .approveBusiness(created.id, admin, { serviceExpiresAt: "2026-09-16T00:00:00.000Z" });

      expect(approved.status).toBe("active");
      await expect(tenancy.listMemberships(created.id)).resolves.toEqual([
        expect.objectContaining({ userId: created.createdBy, role: "owner_admin", isActive: true }),
      ]);
      await expect(platform.listAuditEvents(created.id)).resolves.toEqual([
        expect.objectContaining({ action: "business_approved", targetId: created.id }),
      ]);
    } finally {
      await close();
    }
  }, 30_000);
});
