import { describe, expect, it } from "vitest";

import {
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

const user = (value: string) => value as UserId;
const business = (value: string) => value as BusinessId;

describe("business approval lifecycle", () => {
  it("creates a pending business without operational membership", async () => {
    const tenancy = createInMemoryOnboardingRepository();

    const created = await createBusinessRequest({ name: "Pending Harbour" }, user("requester"), tenancy);

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

    const approved = await service.approveBusiness(
      created.id,
      user("platform-admin"),
      { serviceExpiresAt: "2026-09-16T00:00:00.000Z" },
    );

    expect(approved).toMatchObject({
      id: created.id,
      status: "active",
      isActive: true,
      activatedAt: expect.any(String),
      serviceExpiresAt: "2026-09-16T00:00:00.000Z",
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
    expect(tenancy.transactionCount).toBe(2);
  });

  it("requires a platform member and rejects invalid lifecycle transitions", async () => {
    const tenancy = createInMemoryOnboardingRepository();
    const platform = createInMemoryPlatformRepository();
    const service = createPlatformService({ tenancyRepository: tenancy, platformRepository: platform });
    const created = await createBusinessRequest({ name: "Protected Harbour" }, user("requester"), tenancy);

    await expect(service.approveBusiness(created.id, user("requester"), {})).rejects.toMatchObject({
      code: PLATFORM_ERROR_CODES.PLATFORM_ACCESS_DENIED,
    });

    platform.addMember({ id: "platform-1", userId: user("platform-admin"), normalizedEmail: "admin@example.com" });
    await service.rejectBusiness(created.id, user("platform-admin"), { reason: "Incomplete request" });
    await expect(service.approveBusiness(created.id, user("platform-admin"), {})).rejects.toMatchObject({
      code: PLATFORM_ERROR_CODES.INVALID_TRANSITION,
    });
  });

  it("suspends and reactivates without deleting membership or business data", async () => {
    const tenancy = createInMemoryOnboardingRepository();
    const platform = createInMemoryPlatformRepository();
    const service = createPlatformService({ tenancyRepository: tenancy, platformRepository: platform });
    const created = await createBusinessRequest({ name: "Service Harbour" }, user("requester"), tenancy);
    platform.addMember({ id: "platform-1", userId: user("platform-admin"), normalizedEmail: "admin@example.com" });
    await service.approveBusiness(created.id, user("platform-admin"), {});

    await service.suspendBusiness(created.id, user("platform-admin"), { reason: "Subscription unpaid" });
    await expect(tenancy.findBusinessStatus(created.id)).resolves.toBe("suspended");
    await expect(tenancy.listMemberships(created.id)).resolves.toHaveLength(1);

    await service.reactivateBusiness(created.id, user("platform-admin"), {});
    await expect(tenancy.findBusinessStatus(created.id)).resolves.toBe("active");
    await expect(tenancy.findBusiness(business(created.id))).resolves.toMatchObject({ status: "active" });
  });

  it.each(["pending", "suspended", "rejected"] as const)("denies the shared operational boundary for %s businesses", async (status) => {
    const tenancy = createInMemoryOnboardingRepository();
    const created = await createBusinessRequest({ name: `${status} Harbour` }, user("requester"), tenancy);
    if (status !== "pending") await tenancy.updateBusinessLifecycle(created.id, { status });

    await expect(requireBusinessOperational(tenancy, created.id)).rejects.toMatchObject({
      code: "INACTIVE_BUSINESS",
    });
  });
});
