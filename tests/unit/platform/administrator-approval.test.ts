import { describe, expect, it } from "vitest";

import {
  createInMemoryOnboardingRepository,
  createBusinessRequest,
} from "../../../src/modules/tenancy/business-service";
import {
  createInMemoryPlatformRepository,
  createPlatformService,
  PLATFORM_ERROR_CODES,
} from "../../../src/modules/platform/platform-service";
import { effectiveBusinessAccess } from "../../../src/modules/tenancy/tenant-context";
import type { BusinessId, UserId } from "../../../src/modules/tenancy/types";
import { createApprovedBusiness } from "../../helpers/business-fixtures";

const user = (value: string) => value as UserId;
const business = (value: string) => value as BusinessId;

async function fixture() {
  const tenancy = createInMemoryOnboardingRepository();
  const platform = createInMemoryPlatformRepository();
  const created = await createApprovedBusiness(tenancy, "Administrator Harbour", user("owner"));
  platform.addMember({ id: "platform-1", userId: user("platform-admin"), normalizedEmail: "platform@example.com" });
  const administrator = await tenancy.createMembership({
    membershipId: "membership-administrator",
    userId: user("administrator"),
    businessId: created.id,
    role: "administrator",
    isActive: false,
  });
  return { tenancy, platform, service: createPlatformService({ tenancyRepository: tenancy, platformRepository: platform }), created, administrator };
}

describe("platform administrator approval", () => {
  it.each(["pending", "rejected", "suspended"] as const)("denies effective access for %s before membership capabilities", async (status) => {
    const tenancy = createInMemoryOnboardingRepository();
    const created = await createBusinessRequest({ name: `${status} Harbour` }, user("owner"), tenancy);
    const membership = await tenancy.createMembership({
      membershipId: `membership-${status}`,
      userId: user("member"),
      businessId: created.id,
      role: "owner_admin",
      isActive: true,
    });
    if (status !== "pending") {
      tenancy.businesses.get(created.id)!.status = status;
      tenancy.businesses.get(created.id)!.isActive = false;
    }

    await expect(effectiveBusinessAccess(tenancy, created.id, membership.userId)).resolves.toMatchObject({
      allowed: false,
      reason: `business_${status}`,
    });
  });

  it("approves and suspends a business administrator globally without tenant membership", async () => {
    const { tenancy, platform, service, created, administrator } = await fixture();

    await expect(service.approveAdministrator(administrator.membershipId, user("platform-admin"), {}))
      .resolves.toMatchObject({ membershipId: administrator.membershipId, isActive: true });
    await expect(service.suspendAdministrator(administrator.membershipId, user("platform-admin"), {
      action: "suspend",
      reason: "Access review",
    })).resolves.toMatchObject({ membershipId: administrator.membershipId, isActive: false });

    expect(platform.auditEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "administrator_approved", targetId: administrator.membershipId }),
      expect.objectContaining({ action: "administrator_suspended", targetId: administrator.membershipId, reason: "Access review" }),
    ]));
    await expect(effectiveBusinessAccess(tenancy, created.id, user("administrator"))).resolves.toMatchObject({
      allowed: false,
      reason: "membership_inactive",
    });
  });

  it("does not approve a membership after platform suspension", async () => {
    const { tenancy, service, administrator } = await fixture();
    await tenancy.updateMembership({ ...administrator, isActive: true, status: "active" });

    await service.suspendAdministrator(administrator.membershipId, user("platform-admin"), {
      action: "suspend",
      reason: "Temporary review",
    });

    await expect(service.approveAdministrator(administrator.membershipId, user("platform-admin"), {}))
      .rejects.toMatchObject({ code: PLATFORM_ERROR_CODES.INVALID_TRANSITION });
  });

  it("serializes administrator actions and audits only the winning transition", async () => {
    const { tenancy, service, platform, administrator } = await fixture();
    await tenancy.updateMembership({ ...administrator, isActive: true, status: "active" });

    const results = await Promise.allSettled([
      service.suspendAdministrator(administrator.membershipId, user("platform-admin"), {
        action: "suspend",
        reason: "Suspend race",
      }),
      service.suspendAdministrator(administrator.membershipId, user("platform-admin"), {
        action: "revoke",
        reason: "Revoke race",
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(platform.auditEvents.filter((event) => event.targetId === administrator.membershipId)).toHaveLength(1);
  });

  it("claims a verified Firebase platform member once, then authorizes by linked user id", async () => {
    const tenancy = createInMemoryOnboardingRepository();
    const platform = createInMemoryPlatformRepository();
    platform.addMember({ id: "platform-claim", userId: null, normalizedEmail: "claimed@example.com" });
    const service = createPlatformService({ tenancyRepository: tenancy, platformRepository: platform });
    const firstIdentity = {
      provider: "firebase" as const,
      providerUserId: "firebase-claimed",
      email: "claimed@example.com",
      displayName: "Claimed Admin",
      emailVerified: true,
    };

    await expect(service.listAdministrators(firstIdentity)).resolves.toEqual([]);
    const linkedUserId = platform.platformMembers[0]?.userId;
    expect(linkedUserId).toMatch(/^user-/);
    await expect(service.listAdministrators({ ...firstIdentity, email: "renamed@example.com" })).resolves.toEqual([]);
    expect(platform.platformMembers[0]?.userId).toBe(linkedUserId);
  });

  it("cascades a suspended business through effective access without deleting memberships", async () => {
    const { tenancy, service, created } = await fixture();
    await tenancy.updateMembership({
      membershipId: "membership-administrator",
      userId: user("administrator"),
      businessId: created.id,
      role: "administrator",
      isActive: true,
      status: "active",
    });

    await service.suspendBusiness(created.id, user("platform-admin"), { reason: "Business review" });

    await expect(effectiveBusinessAccess(tenancy, created.id, user("owner"))).resolves.toMatchObject({
      allowed: false,
      reason: "business_suspended",
    });
    await expect(effectiveBusinessAccess(tenancy, created.id, user("administrator"))).resolves.toMatchObject({
      allowed: false,
      reason: "business_suspended",
    });
    await expect(tenancy.listMemberships(created.id)).resolves.toHaveLength(2);
    await expect(tenancy.listBusinessesForUser(user("owner"))).resolves.toMatchObject([
      { business: { id: created.id, isActive: false } },
    ]);
  });

  it("revokes only the requested membership and keeps other businesses isolated", async () => {
    const { tenancy, service, administrator } = await fixture();
    await tenancy.updateMembership({ ...administrator, isActive: true, status: "active" });
    const second = await createApprovedBusiness(tenancy, "Second Administrator Harbour", user("second-owner"));
    const secondAdministrator = await tenancy.createMembership({
      membershipId: "membership-second-administrator",
      userId: user("second-administrator"),
      businessId: second.id,
      role: "administrator",
      isActive: true,
    });

    await service.suspendAdministrator(administrator.membershipId, user("platform-admin"), {
      action: "revoke",
      reason: "Access no longer required",
    });

    await expect(service.approveAdministrator(administrator.membershipId, user("platform-admin"), {}))
      .rejects.toMatchObject({ code: PLATFORM_ERROR_CODES.INVALID_TRANSITION });

    await expect(tenancy.findMembership(user("administrator"), business(administrator.businessId))).resolves.toMatchObject({
      status: "revoked",
      isActive: false,
    });
    await expect(tenancy.findMembership(user("second-administrator"), second.id)).resolves.toEqual(secondAdministrator);
  });

  it("requires a linked platform administrator and an explicit reason for suspension actions", async () => {
    const { service, administrator } = await fixture();

    await expect(service.listAdministrators(user("ordinary-user"))).rejects.toMatchObject({
      code: PLATFORM_ERROR_CODES.PLATFORM_ACCESS_DENIED,
    });
    await expect(service.suspendAdministrator(administrator.membershipId, user("platform-admin"), {
      action: "suspend",
      reason: "",
    })).rejects.toMatchObject({ code: PLATFORM_ERROR_CODES.REASON_REQUIRED });
  });
});
