import { describe, expect, it, vi } from "vitest";

import {
  createBusiness,
  createBusinessRequest,
  createInMemoryOnboardingRepository,
} from "../../../src/modules/tenancy/business-service";
import {
  createInMemoryPlatformRepository,
  createPlatformService,
  PLATFORM_ERROR_CODES,
} from "../../../src/modules/platform/platform-service";
import { requireBusinessOperational } from "../../../src/modules/tenancy/business-lifecycle-service";
import type { BusinessId, UserId } from "../../../src/modules/tenancy/types";
import { testServiceExpiresAt } from "../../helpers/business-fixtures";

const user = (value: string) => value as UserId;
const business = (value: string) => value as BusinessId;

describe("business approval lifecycle", () => {
  it("creates a pending business without operational membership", async () => {
    const tenancy = createInMemoryOnboardingRepository();

    const created = await createBusiness({ name: "Pending Harbour" }, user("requester"), tenancy);

    expect(created).toMatchObject({ status: "pending", isActive: false });
    await expect(tenancy.listMemberships(created.id)).resolves.toEqual([]);
    await expect(tenancy.findBusinessStatus(created.id)).resolves.toBe("pending");
  });

  it("approves atomically, provisions the requester as owner_admin, and audits the transition", async () => {
    const tenancy = createInMemoryOnboardingRepository();
    const platform = createInMemoryPlatformRepository();
    const service = createPlatformService({ tenancyRepository: tenancy, platformRepository: platform });
    const created = await createBusinessRequest({ name: "Approved Harbour" }, user("requester"), tenancy);
    platform.addMember({ id: "platform-1", userId: user("platform-admin"), normalizedEmail: "admin@example.com" });
    const serviceExpiresAt = testServiceExpiresAt();

    const approved = await service.approveBusiness(
      created.id,
      user("platform-admin"),
       { serviceExpiresAt, reason: "Initial approval" },
    );

    expect(approved).toMatchObject({
      id: created.id,
      status: "active",
      isActive: true,
      activatedAt: expect.any(String),
      serviceExpiresAt,
    });
    expect(tenancy.memberships).toContainEqual(expect.objectContaining({
      userId: user("requester"),
      businessId: created.id,
      role: "owner_admin",
      isActive: true,
    }));
    expect(platform.auditEvents).toContainEqual(expect.objectContaining({
      actorId: "platform-1",
      targetId: created.id,
      action: "business_approved",
      beforeStatus: "pending",
      afterStatus: "active",
    }));
    expect(tenancy.auditEvents).toContainEqual(expect.objectContaining({
      actorId: user("requester"),
      entityId: created.id,
      type: "business_requested",
    }));
    expect(tenancy.auditEvents).not.toContainEqual(expect.objectContaining({
      actorId: user("requester"),
      entityId: created.id,
      type: "business_created",
    }));
    expect(tenancy.transactionCount).toBe(2);
  });

  it("requires a platform member and rejects invalid lifecycle transitions", async () => {
    const tenancy = createInMemoryOnboardingRepository();
    const platform = createInMemoryPlatformRepository();
    const service = createPlatformService({ tenancyRepository: tenancy, platformRepository: platform });
    const created = await createBusinessRequest({ name: "Protected Harbour" }, user("requester"), tenancy);

    await expect(service.approveBusiness(created.id, user("requester"), { serviceExpiresAt: testServiceExpiresAt(), reason: "Unauthorized approval" })).rejects.toMatchObject({
      code: PLATFORM_ERROR_CODES.PLATFORM_ACCESS_DENIED,
    });

    platform.addMember({ id: "platform-1", userId: user("platform-admin"), normalizedEmail: "admin@example.com" });
    await service.rejectBusiness(created.id, user("platform-admin"), { reason: "Incomplete request" });
    await expect(service.approveBusiness(created.id, user("platform-admin"), { serviceExpiresAt: testServiceExpiresAt(), reason: "Rejected approval" })).rejects.toMatchObject({
      code: PLATFORM_ERROR_CODES.INVALID_TRANSITION,
    });
  });

  it("suspends and reactivates without deleting membership or business data", async () => {
    const tenancy = createInMemoryOnboardingRepository();
    const platform = createInMemoryPlatformRepository();
    const service = createPlatformService({ tenancyRepository: tenancy, platformRepository: platform });
    const created = await createBusinessRequest({ name: "Service Harbour" }, user("requester"), tenancy);
    platform.addMember({ id: "platform-1", userId: user("platform-admin"), normalizedEmail: "admin@example.com" });
    await service.approveBusiness(created.id, user("platform-admin"), { serviceExpiresAt: testServiceExpiresAt(), reason: "Lifecycle setup" });

    await service.suspendBusiness(created.id, user("platform-admin"), { reason: "Subscription unpaid" });
    await expect(tenancy.findBusinessStatus(created.id)).resolves.toBe("suspended");
    await expect(tenancy.listMemberships(created.id)).resolves.toHaveLength(1);

    await service.reactivateBusiness(created.id, user("platform-admin"), { reason: "Lifecycle restoration" });
    await expect(tenancy.findBusinessStatus(created.id)).resolves.toBe("active");
    await expect(tenancy.findBusiness(business(created.id))).resolves.toMatchObject({ status: "active" });
  });

  it("rejects an unlinked identity even when its email matches a platform member", async () => {
    const tenancy = createInMemoryOnboardingRepository();
    const platform = createInMemoryPlatformRepository();
    const service = createPlatformService({ tenancyRepository: tenancy, platformRepository: platform });
    platform.addMember({ id: "platform-1", userId: null, normalizedEmail: "admin@example.com" });

    await expect(service.listBusinesses({
      providerUserId: "different-provider",
      email: "admin@example.com",
      displayName: "Impostor",
      emailVerified: true,
    })).rejects.toMatchObject({ code: PLATFORM_ERROR_CODES.PLATFORM_ACCESS_DENIED });

    await expect(service.claimPlatformMember({
      provider: "firebase",
      providerUserId: "different-provider",
      email: "admin@example.com",
      displayName: "Verified Admin",
      emailVerified: true,
    })).resolves.toMatchObject({ id: "platform-1", userId: expect.stringMatching(/^user-/) });
    await expect(service.listBusinesses({
      provider: "firebase",
      providerUserId: "different-provider",
      email: "admin@example.com",
      displayName: "Verified Admin",
      emailVerified: true,
    })).resolves.toEqual([]);
  });

  it("rejects a development provider claim even when its email is bootstrapped", async () => {
    const tenancy = createInMemoryOnboardingRepository();
    const platform = createInMemoryPlatformRepository();
    const service = createPlatformService({ tenancyRepository: tenancy, platformRepository: platform });
    platform.addMember({ id: "platform-1", userId: null, normalizedEmail: "admin@example.com" });

    await expect(service.claimPlatformMember({
      provider: "development",
      providerUserId: "dev-admin",
      email: "admin@example.com",
      displayName: "Development Admin",
      emailVerified: true,
    })).rejects.toMatchObject({ code: PLATFORM_ERROR_CODES.PLATFORM_ACCESS_DENIED });
    expect(platform.platformMembers[0]?.userId).toBeNull();
  });

  it("rejects a claim when the legacy test mode flag is enabled", async () => {
    vi.stubEnv("LEDGERHARBOUR_TEST_MODE", "true");
    const tenancy = createInMemoryOnboardingRepository();
    const platform = createInMemoryPlatformRepository();
    const service = createPlatformService({ tenancyRepository: tenancy, platformRepository: platform });
    platform.addMember({ id: "platform-1", userId: null, normalizedEmail: "admin@example.com" });

    try {
      await expect(service.claimPlatformMember({
        provider: "firebase",
        providerUserId: "firebase-admin",
        email: "admin@example.com",
        displayName: "Firebase Admin",
        emailVerified: true,
      })).rejects.toMatchObject({ code: PLATFORM_ERROR_CODES.PLATFORM_ACCESS_DENIED });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("keeps the first platform claim when a second identity claims the same member", async () => {
    const tenancy = createInMemoryOnboardingRepository();
    const platform = createInMemoryPlatformRepository();
    const service = createPlatformService({ tenancyRepository: tenancy, platformRepository: platform });
    platform.addMember({ id: "platform-1", userId: null, normalizedEmail: "admin@example.com" });
    const first = { provider: "firebase", providerUserId: "first-provider", email: "admin@example.com", displayName: "First", emailVerified: true } as const;
    const second = { provider: "firebase", providerUserId: "second-provider", email: "admin@example.com", displayName: "Second", emailVerified: true } as const;

    const linked = await service.claimPlatformMember(first);

    await expect(service.claimPlatformMember(second)).rejects.toMatchObject({ code: PLATFORM_ERROR_CODES.REPOSITORY_CONFLICT });
    expect(platform.platformMembers[0]).toMatchObject({ id: "platform-1", userId: linked.userId });
  });

  it("allows only one concurrent in-memory platform claim", async () => {
    const tenancy = createInMemoryOnboardingRepository();
    const platform = createInMemoryPlatformRepository();
    const service = createPlatformService({ tenancyRepository: tenancy, platformRepository: platform });
    platform.addMember({ id: "platform-1", userId: null, normalizedEmail: "admin@example.com" });
    const first = { provider: "firebase", providerUserId: "first-provider", email: "admin@example.com", displayName: "First", emailVerified: true } as const;
    const second = { provider: "firebase", providerUserId: "second-provider", email: "admin@example.com", displayName: "Second", emailVerified: true } as const;

    const results = await Promise.allSettled([
      service.claimPlatformMember(first),
      service.claimPlatformMember(second),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const winner = results.find((result) => result.status === "fulfilled")!;
    expect(platform.platformMembers[0].userId).toBe((winner as PromiseFulfilledResult<{ userId: string }>).value.userId);
  });

  it("rejects repository creation attempts that provide an active status", async () => {
    const tenancy = createInMemoryOnboardingRepository();

    await expect(tenancy.createBusiness({
      name: "Active Bypass",
      normalizedName: "active bypass",
      isActive: true,
      status: "active",
      baseCurrencyKind: "standard",
      baseCurrencyCode: "GBP",
      baseCurrencyId: null,
      createdBy: user("requester"),
    } as never)).rejects.toMatchObject({ code: "INVALID_BUSINESS_TRANSITION" });
  });

  it("requires a future service expiration date to approve", async () => {
    const tenancy = createInMemoryOnboardingRepository();
    const platform = createInMemoryPlatformRepository();
    const service = createPlatformService({ tenancyRepository: tenancy, platformRepository: platform });
    const created = await createBusiness({ name: "Expiring Harbour" }, user("requester"), tenancy);
    platform.addMember({ id: "platform-1", userId: user("platform-admin"), normalizedEmail: "admin@example.com" });

    await expect(service.approveBusiness(created.id, user("platform-admin"), { serviceExpiresAt: "2020-01-01T00:00:00.000Z", reason: "Expired approval" }))
      .rejects.toMatchObject({ code: PLATFORM_ERROR_CODES.INVALID_DATE });
    await expect(service.approveBusiness(created.id, user("platform-admin"), { reason: "Missing expiry" } as never))
      .rejects.toMatchObject({ code: PLATFORM_ERROR_CODES.INVALID_DATE });
  });

  it.each(["pending", "suspended", "rejected"] as const)("denies the shared operational boundary for %s businesses", async (status) => {
    const tenancy = createInMemoryOnboardingRepository();
    const created = await createBusinessRequest({ name: `${status} Harbour` }, user("requester"), tenancy);
    if (status !== "pending") {
      const stored = tenancy.businesses.get(created.id)!;
      stored.status = status;
      stored.isActive = false;
    }

    await expect(requireBusinessOperational(tenancy, created.id)).rejects.toMatchObject({
      code: "INACTIVE_BUSINESS",
    });
  });
});
