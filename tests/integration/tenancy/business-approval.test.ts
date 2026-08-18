import { describe, expect, it } from "vitest";

import { createTestDatabase } from "../../../src/db/test-database";
import { createOnboardingServices } from "../../../src/modules/tenancy/business-service";
import { createPostgresOnboardingRepository } from "../../../src/modules/tenancy/postgres-tenancy-repository";
import {
  createPlatformService,
  createPostgresPlatformRepository,
} from "../../../src/modules/platform/platform-service";
import { testServiceExpiresAt } from "../../helpers/business-fixtures";

describe("PostgreSQL business approval lifecycle", () => {
  it("keeps the request pending, then atomically grants owner access on approval", async () => {
    const { db, close } = await createTestDatabase();

    try {
      const tenancy = createPostgresOnboardingRepository(db);
      const platform = createPostgresPlatformRepository(db);
      const onboarding = createOnboardingServices(tenancy);
      const requester = {
        provider: "firebase",
        providerUserId: "postgres-requester",
        email: "requester@example.com",
        displayName: "Requester",
        emailVerified: true,
      } as const;
      const admin = {
        provider: "firebase",
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
        .approveBusiness(created.id, admin, { serviceExpiresAt: testServiceExpiresAt(), reason: "Postgres approval" });

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

  it("keeps the first PostgreSQL platform claim and rejects the second claim", async () => {
    const { db, close } = await createTestDatabase();

    try {
      const tenancy = createPostgresOnboardingRepository(db);
      const platform = createPostgresPlatformRepository(db);
      const service = createPlatformService({ tenancyRepository: tenancy, platformRepository: platform });
       const first = { provider: "firebase", providerUserId: "postgres-first", email: "admin@example.com", displayName: "First", emailVerified: true } as const;
      await platform.bootstrapMember("platform-admin-1", first.email);

      const linked = await service.claimPlatformMember(first);

      await expect(service.claimPlatformMember({ ...first, providerUserId: "postgres-second", displayName: "Second" })).rejects.toMatchObject({ code: "PLATFORM_REPOSITORY_CONFLICT" });
      const linkedUserId = linked.userId;
      expect(linkedUserId).not.toBeNull();
      await expect(platform.findActiveMemberByUserId(linkedUserId as never)).resolves.toMatchObject({ id: "platform-admin-1", userId: linkedUserId });
    } finally {
      await close();
    }
  }, 30_000);

  it("allows only one concurrent PostgreSQL platform claim", async () => {
    const { db, close } = await createTestDatabase();

    try {
      const tenancy = createPostgresOnboardingRepository(db);
      const platform = createPostgresPlatformRepository(db);
      const service = createPlatformService({ tenancyRepository: tenancy, platformRepository: platform });
       const first = { provider: "firebase", providerUserId: "postgres-first", email: "admin@example.com", displayName: "First", emailVerified: true } as const;
      const second = first;
      await platform.bootstrapMember("platform-admin-1", first.email);

      const results = await Promise.allSettled([
        service.claimPlatformMember(first),
        service.claimPlatformMember(second),
      ]);

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
      const winner = results.find((result) => result.status === "fulfilled")!;
      await expect(platform.findActiveMemberByUserId((winner as PromiseFulfilledResult<{ userId: string }>).value.userId as never)).resolves.toMatchObject({ id: "platform-admin-1" });
    } finally {
      await close();
    }
  }, 30_000);

  it("rejects PostgreSQL repository creation attempts that provide an active status", async () => {
    const { db, close } = await createTestDatabase();

    try {
      const tenancy = createPostgresOnboardingRepository(db);

      await expect(tenancy.createBusiness({
        name: "Active Bypass",
        normalizedName: "active bypass",
        isActive: true,
        status: "active",
        baseCurrencyKind: "standard",
        baseCurrencyCode: "GBP",
        baseCurrencyId: null,
        createdBy: "requester",
      } as never)).rejects.toMatchObject({ code: "INVALID_BUSINESS_TRANSITION" });
    } finally {
      await close();
    }
  }, 30_000);
});
