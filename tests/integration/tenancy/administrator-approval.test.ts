import { describe, expect, it } from "vitest";

import {
  createInMemoryOnboardingRepository,
  createOnboardingServices,
  ONBOARDING_ERROR_CODES,
} from "../../../src/modules/tenancy/business-service";
import { createMembershipService, MEMBERSHIP_ERROR_CODES } from "../../../src/modules/tenancy/membership-service";
import {
  createInMemoryPlatformRepository,
  createPlatformService,
} from "../../../src/modules/platform/platform-service";
import { effectiveBusinessAccess } from "../../../src/modules/tenancy/tenant-context";
import type { UserId } from "../../../src/modules/tenancy/types";
import { createApprovedBusiness } from "../../helpers/business-fixtures";

const user = (value: string) => value as UserId;

describe("administrator approval integration", () => {
  it("keeps business approval internal while allowing global platform suspension", async () => {
    const tenancy = createInMemoryOnboardingRepository();
    const platform = createInMemoryPlatformRepository();
    const services = createOnboardingServices(tenancy);
    const created = await createApprovedBusiness(tenancy, "Internal Approval Harbour", user("owner"));
    platform.addMember({ id: "platform-1", userId: user("platform-admin"), normalizedEmail: "platform@example.com" });

    const request = await services.requestMembership({ businessId: created.id, requestedRole: "administrator" }, user("member"));
    await expect(services.reviewJoinRequest({ businessId: created.id, joinRequestId: request.id, decision: "approved" }, user("owner")))
      .resolves.toMatchObject({ reviewerId: user("owner"), status: "approved" });

    const membership = (await tenancy.findMembership(user("member"), created.id))!;
    const platformService = createPlatformService({ tenancyRepository: tenancy, platformRepository: platform });
    await expect(platformService.suspendAdministrator(membership.membershipId, user("platform-admin"), {
      action: "suspend",
      reason: "Platform policy review",
    })).resolves.toMatchObject({ isActive: false });

    await expect(effectiveBusinessAccess(tenancy, created.id, user("member"))).resolves.toMatchObject({
      allowed: false,
      reason: "membership_inactive",
    });
  });

  it("denies a tenant administrator from operating a different business", async () => {
    const tenancy = createInMemoryOnboardingRepository();
    const services = createOnboardingServices(tenancy);
    const first = await createApprovedBusiness(tenancy, "First Harbour", user("owner-1"));
    const second = await createApprovedBusiness(tenancy, "Second Harbour", user("owner-2"));
    tenancy.memberships.push({
      membershipId: "membership-general-1",
      userId: user("general-1"),
      businessId: first.id,
       role: "general_admin",
       isActive: true,
       status: "active",
    });
    const request = await services.requestMembership({ businessId: second.id, requestedRole: "administrator" }, user("requester"));

    await expect(services.reviewJoinRequest({ businessId: first.id, joinRequestId: request.id, decision: "approved" }, user("general-1")))
      .rejects.toMatchObject({ code: "JOIN_REQUEST_NOT_FOUND" });
  });

  it("revalidates join-request access inside the transaction before writing", async () => {
    const tenancy = createInMemoryOnboardingRepository();
    const services = createOnboardingServices(tenancy);
    const created = await createApprovedBusiness(tenancy, "TOCTOU Join Harbour", user("owner"));
    const request = await services.requestMembership({ businessId: created.id, requestedRole: "administrator" }, user("member"));
    const originalStatus = tenancy.findBusinessStatus.bind(tenancy);
    let calls = 0;
    tenancy.findBusinessStatus = async (businessId) => {
      const status = await originalStatus(businessId);
      calls += 1;
      if (calls === 1) {
        tenancy.businesses.get(created.id)!.status = "suspended";
        tenancy.businesses.get(created.id)!.isActive = false;
      }
      return status;
    };

    await expect(services.reviewJoinRequest({ businessId: created.id, joinRequestId: request.id, decision: "approved" }, user("owner")))
      .rejects.toMatchObject({ code: ONBOARDING_ERROR_CODES.INSUFFICIENT_CAPABILITY });
    await expect(tenancy.findJoinRequest(request.id)).resolves.toMatchObject({ status: "pending" });
  });

  it("revalidates membership access inside the transaction before writing", async () => {
    const tenancy = createInMemoryOnboardingRepository();
    const created = await createApprovedBusiness(tenancy, "TOCTOU Membership Harbour", user("owner"));
    const target = await tenancy.createMembership({
      membershipId: "membership-toctou",
      userId: user("member"),
      businessId: created.id,
      role: "administrator",
      isActive: true,
    });
    const originalStatus = tenancy.findBusinessStatus.bind(tenancy);
    let calls = 0;
    tenancy.findBusinessStatus = async (businessId) => {
      const status = await originalStatus(businessId);
      calls += 1;
      if (calls === 1) {
        tenancy.businesses.get(created.id)!.status = "suspended";
        tenancy.businesses.get(created.id)!.isActive = false;
      }
      return status;
    };

    await expect(createMembershipService(tenancy).setGeneralAdmin({ businessId: created.id, membershipId: target.membershipId }, user("owner")))
      .rejects.toMatchObject({ code: MEMBERSHIP_ERROR_CODES.INSUFFICIENT_CAPABILITY });
    await expect(tenancy.findMembership(user("member"), created.id)).resolves.toMatchObject({ role: "administrator" });
  });
});
