import { describe, expect, it } from "vitest";

import {
  createInMemoryOnboardingRepository,
  createOnboardingServices,
} from "../../../src/modules/tenancy/business-service";
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
    });
    const request = await services.requestMembership({ businessId: second.id, requestedRole: "administrator" }, user("requester"));

    await expect(services.reviewJoinRequest({ businessId: first.id, joinRequestId: request.id, decision: "approved" }, user("general-1")))
      .rejects.toMatchObject({ code: "JOIN_REQUEST_NOT_FOUND" });
  });
});
