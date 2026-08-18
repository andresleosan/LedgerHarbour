import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthIdentity } from "../../../src/modules/auth/auth-provider";
import { getCurrentIdentity } from "../../../src/modules/auth/session";
import { defaultOnboardingRepository } from "../../../src/modules/tenancy/business-service";
import { defaultPlatformRepository } from "../../../src/modules/platform/platform-service";
import { defaultProjectRepository } from "../../../src/modules/projects/project-service";
import { resetRateLimitersForTests } from "../../../src/modules/security/rate-limit";
import { createBusinessRequest } from "../../../src/modules/tenancy/business-service";
import type { UserId } from "../../../src/modules/tenancy/types";

vi.mock("../../../src/modules/auth/session", () => ({ getCurrentIdentity: vi.fn() }));

import { GET as getSummary } from "../../../src/app/api/platform/summary/route";
import { GET as getAuditEvents } from "../../../src/app/api/platform/audit-events/route";
import { POST as approveBusiness } from "../../../src/app/api/platform/businesses/[businessId]/approve/route";

const mockedIdentity = vi.mocked(getCurrentIdentity);
const platformIdentity: AuthIdentity = {
  provider: "firebase",
  providerUserId: "task6-platform-firebase",
  email: "task6-platform@example.com",
  displayName: "Task 6 Platform",
  emailVerified: true,
};
const ordinaryIdentity: AuthIdentity = {
  provider: "firebase",
  providerUserId: "task6-ordinary-firebase",
  email: "task6-ordinary@example.com",
  displayName: "Task 6 Ordinary",
  emailVerified: true,
};

function request(path: string): Request {
  return new Request(`http://localhost${path}`, { headers: { "x-forwarded-for": "198.51.100.96" } });
}

describe("global platform administration HTTP contracts", () => {
  beforeEach(() => {
    defaultOnboardingRepository.businesses.clear();
    defaultOnboardingRepository.memberships.splice(0);
    defaultOnboardingRepository.categories.splice(0);
    defaultOnboardingRepository.joinRequests.splice(0);
    defaultOnboardingRepository.auditEvents.splice(0);
    defaultPlatformRepository.platformMembers.splice(0);
    defaultPlatformRepository.auditEvents.splice(0);
    defaultProjectRepository.projects.splice(0);
    defaultProjectRepository.memberships.splice(0);
    resetRateLimitersForTests();
    mockedIdentity.mockResolvedValue(null);
  });

  it("returns 401 without an authenticated identity", async () => {
    await expect(getSummary(request("/api/platform/summary"))).resolves.toMatchObject({ status: 401 });
    await expect(getAuditEvents(request("/api/platform/audit-events"))).resolves.toMatchObject({ status: 401 });
  });

  it("returns 403 for an authenticated non-platform user", async () => {
    mockedIdentity.mockResolvedValue(ordinaryIdentity);
    const [summary, audit] = await Promise.all([
      getSummary(request("/api/platform/summary")),
      getAuditEvents(request("/api/platform/audit-events")),
    ]);
    expect(summary.status).toBe(403);
    expect(audit.status).toBe(403);
  });

  it("returns the aggregate safe DTO through the real handlers for a platform admin", async () => {
    mockedIdentity.mockResolvedValue(platformIdentity);
    const userId = await defaultOnboardingRepository.upsertUser(platformIdentity);
    defaultPlatformRepository.addMember({ id: "task6-platform-member", userId, normalizedEmail: platformIdentity.email });

    const summary = await getSummary(request("/api/platform/summary"));
    const audit = await getAuditEvents(request("/api/platform/audit-events"));
    expect(summary.status).toBe(200);
    expect(audit.status).toBe(200);
    await expect(summary.json()).resolves.toMatchObject({
      counts: { businesses: 0, projects: 0, administrators: 0 },
      businesses: [],
      projects: [],
      administrators: [],
    });
    await expect(audit.json()).resolves.toEqual({ events: [] });
  });

  it("requires a reason and maps concurrent business approvals to one 409 conflict", async () => {
    mockedIdentity.mockResolvedValue(platformIdentity);
    const userId = await defaultOnboardingRepository.upsertUser(platformIdentity);
    defaultPlatformRepository.addMember({ id: "task6-platform-member", userId, normalizedEmail: platformIdentity.email });
    const pending = await createBusinessRequest({ name: "Concurrent Route Harbour" }, "task6-owner" as UserId, defaultOnboardingRepository);
    const context = { params: Promise.resolve({ businessId: pending.id }) };
    const body = { serviceExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), reason: "Initial platform approval" };
    const missingReason = await approveBusiness(new Request("http://localhost/api/platform/businesses/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.97" },
      body: JSON.stringify({ serviceExpiresAt: body.serviceExpiresAt }),
    }), context);
    expect(missingReason.status).toBe(400);

    const responses = await Promise.all([
      approveBusiness(new Request("http://localhost/api/platform/businesses/approve", { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.98" }, body: JSON.stringify(body) }), context),
      approveBusiness(new Request("http://localhost/api/platform/businesses/approve", { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.99" }, body: JSON.stringify(body) }), context),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const conflict = responses.find((response) => response.status === 409);
    await expect(conflict?.json()).resolves.toMatchObject({ error: { code: expect.any(String) } });
    expect(defaultPlatformRepository.auditEvents).toContainEqual(expect.objectContaining({ action: "business_approved", reason: body.reason }));
  });
});
