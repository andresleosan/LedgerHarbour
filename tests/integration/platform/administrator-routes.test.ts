import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthIdentity } from "../../../src/modules/auth/auth-provider";
import {
  createBusinessRequest,
  defaultOnboardingRepository,
} from "../../../src/modules/tenancy/business-service";
import {
  createPlatformService,
  defaultPlatformRepository,
} from "../../../src/modules/platform/platform-service";
import { resetRateLimitersForTests } from "../../../src/modules/security/rate-limit";
import { getCurrentIdentity } from "../../../src/modules/auth/session";
import type { UserId } from "../../../src/modules/tenancy/types";

vi.mock("../../../src/modules/auth/session", () => ({
  getCurrentIdentity: vi.fn(),
}));

import { GET as listAdministrators } from "../../../src/app/api/platform/administrators/route";
import { POST as approveAdministrator } from "../../../src/app/api/platform/administrators/[membershipId]/approve/route";
import { POST as suspendAdministrator } from "../../../src/app/api/platform/administrators/[membershipId]/suspend/route";
import { POST as rejectBusiness } from "../../../src/app/api/platform/businesses/[businessId]/reject/route";
import { POST as suspendBusiness } from "../../../src/app/api/platform/businesses/[businessId]/suspend/route";
import { POST as reactivateBusiness } from "../../../src/app/api/platform/businesses/[businessId]/reactivate/route";

const mockedIdentity = vi.mocked(getCurrentIdentity);
const platformIdentity: AuthIdentity = {
  provider: "firebase",
  providerUserId: "route-platform-firebase",
  email: "route-platform@example.com",
  displayName: "Route Platform",
  emailVerified: true,
};
const ordinaryIdentity: AuthIdentity = {
  provider: "firebase",
  providerUserId: "route-ordinary-firebase",
  email: "route-ordinary@example.com",
  displayName: "Route Ordinary",
  emailVerified: true,
};

function request(body?: unknown, method = "POST"): Request {
  return new Request("http://localhost/api/platform/administrators", {
    method,
    headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.80" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function setupAdministrator(isActive = false, suffix = "") {
  const platformUserId = await defaultOnboardingRepository.upsertUser(platformIdentity);
  defaultPlatformRepository.addMember({
    id: `route-platform-member${suffix}`,
    userId: platformUserId,
    normalizedEmail: platformIdentity.email,
  });
  const business = await createBusinessRequest({ name: `Administrator HTTP Harbour${suffix}` }, "route-owner" as UserId, defaultOnboardingRepository);
  await createPlatformService({
    tenancyRepository: defaultOnboardingRepository,
    platformRepository: defaultPlatformRepository,
  }).approveBusiness(business.id, platformIdentity, {
    serviceExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  });
  const membership = await defaultOnboardingRepository.createMembership({
    membershipId: `route-administrator-membership${suffix}`,
    userId: "route-member" as UserId,
    businessId: business.id,
    role: "administrator",
    isActive,
  });
  return membership;
}

describe("platform administrator HTTP contracts", () => {
  beforeEach(() => {
    defaultOnboardingRepository.businesses.clear();
    defaultOnboardingRepository.memberships.splice(0);
    defaultOnboardingRepository.categories.splice(0);
    defaultOnboardingRepository.joinRequests.splice(0);
    defaultOnboardingRepository.auditEvents.splice(0);
    defaultPlatformRepository.platformMembers.splice(0);
    defaultPlatformRepository.auditEvents.splice(0);
    resetRateLimitersForTests();
    vi.unstubAllEnvs();
    mockedIdentity.mockResolvedValue(null);
  });

  it("returns 401 from all administrator endpoints without identity", async () => {
    const context = { params: Promise.resolve({ membershipId: "missing" }) };
    await expect(listAdministrators(request(undefined, "GET"))).resolves.toMatchObject({ status: 401 });
    await expect(approveAdministrator(request({}), context)).resolves.toMatchObject({ status: 401 });
    await expect(suspendAdministrator(request({ action: "suspend", reason: "test" }), context)).resolves.toMatchObject({ status: 401 });
  });

  it("returns generic 403 for non-platform identities", async () => {
    mockedIdentity.mockResolvedValue(ordinaryIdentity);
    const context = { params: Promise.resolve({ membershipId: "missing" }) };
    const responses = await Promise.all([
      listAdministrators(request(undefined, "GET")),
      approveAdministrator(request({}), context),
      suspendAdministrator(request({ action: "suspend", reason: "test" }), context),
    ]);

    expect(responses.map((response) => response.status)).toEqual([403, 403, 403]);
    await expect(responses[0]?.json()).resolves.toEqual({
      error: { code: "PLATFORM_ACCESS_DENIED", message: "Platform administration access denied." },
    });
  });

  it("supports platform success, revoke audit, and no reactivation over HTTP", async () => {
    mockedIdentity.mockResolvedValue(platformIdentity);
    const membership = await setupAdministrator(true);
    const context = { params: Promise.resolve({ membershipId: membership.membershipId }) };

    const list = await listAdministrators(request(undefined, "GET"));
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({ administrators: [expect.objectContaining({ membershipId: membership.membershipId })] });

    const suspended = await suspendAdministrator(request({ action: "suspend", reason: "HTTP review" }), context);
    expect(suspended.status).toBe(200);
    const reapproval = await approveAdministrator(request({}), context);
    expect(reapproval.status).toBe(409);

    const second = await setupAdministrator(true, "-2");
    const revoked = await suspendAdministrator(request({ action: "revoke", reason: "HTTP revoke" }), { params: Promise.resolve({ membershipId: second.membershipId }) });
    expect(revoked.status).toBe(200);
    expect(defaultPlatformRepository.auditEvents).toContainEqual(expect.objectContaining({
      action: "administrator_revoked",
      targetId: second.membershipId,
      reason: "HTTP revoke",
    }));
  });

  it("returns generic 429 and 503 rate-limit errors", async () => {
    mockedIdentity.mockResolvedValue(platformIdentity);
    await setupAdministrator(true);
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await listAdministrators(request(undefined, "GET"));
    }
    await expect(listAdministrators(request(undefined, "GET"))).resolves.toMatchObject({ status: 429 });

    resetRateLimitersForTests();
    vi.stubEnv("RATE_LIMIT_MODE", "invalid");
    await expect(listAdministrators(request(undefined, "GET"))).resolves.toMatchObject({ status: 503 });
  });

  it("covers platform business reject, suspend, and reactivate HTTP transitions", async () => {
    mockedIdentity.mockResolvedValue(platformIdentity);
    const activeMembership = await setupAdministrator(true);
    const businessContext = { params: Promise.resolve({ businessId: activeMembership.businessId }) };

    const suspended = await suspendBusiness(request({ reason: "HTTP suspension" }), businessContext);
    expect(suspended.status).toBe(200);
    const reactivated = await reactivateBusiness(request({}, "POST"), businessContext);
    expect(reactivated.status).toBe(200);

    const pending = await createBusinessRequest({ name: "HTTP Reject Harbour" }, "route-pending-owner" as UserId, defaultOnboardingRepository);
    const missingReason = await rejectBusiness(request({}, "POST"), { params: Promise.resolve({ businessId: pending.id }) });
    expect(missingReason.status).toBe(400);
    const rejected = await rejectBusiness(request({ reason: "HTTP rejection" }), { params: Promise.resolve({ businessId: pending.id }) });
    expect(rejected.status).toBe(200);
    await expect(rejected.json()).resolves.toMatchObject({ business: { id: pending.id, status: "rejected" } });
  });
});
