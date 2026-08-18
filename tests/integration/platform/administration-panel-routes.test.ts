import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthIdentity } from "../../../src/modules/auth/auth-provider";
import { getCurrentIdentity } from "../../../src/modules/auth/session";
import { defaultOnboardingRepository } from "../../../src/modules/tenancy/business-service";
import { defaultPlatformRepository } from "../../../src/modules/platform/platform-service";
import { defaultProjectRepository } from "../../../src/modules/projects/project-service";
import { resetRateLimitersForTests } from "../../../src/modules/security/rate-limit";

vi.mock("../../../src/modules/auth/session", () => ({ getCurrentIdentity: vi.fn() }));

import { GET as getSummary } from "../../../src/app/api/platform/summary/route";
import { GET as getAuditEvents } from "../../../src/app/api/platform/audit-events/route";

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
});
