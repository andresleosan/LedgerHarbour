import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthIdentity } from "../../../src/modules/auth/auth-provider";
import { getCurrentIdentity } from "../../../src/modules/auth/session";
import { createBusinessRequest, defaultOnboardingRepository } from "../../../src/modules/tenancy/business-service";
import { createPlatformService, defaultPlatformRepository } from "../../../src/modules/platform/platform-service";
import { defaultProjectRepository } from "../../../src/modules/projects/project-service";
import { testServiceExpiresAt } from "../../helpers/business-fixtures";

vi.mock("../../../src/modules/auth/session", () => ({ getCurrentIdentity: vi.fn() }));

import { GET as listBusinessProjects, POST as createProject } from "../../../src/app/api/businesses/[businessId]/projects/route";
import { GET as listPlatformProjects } from "../../../src/app/api/platform/projects/route";
import { POST as approveProject } from "../../../src/app/api/platform/projects/[projectId]/approve/route";
import { POST as rejectProject } from "../../../src/app/api/platform/projects/[projectId]/reject/route";
import { POST as suspendProject } from "../../../src/app/api/platform/projects/[projectId]/suspend/route";
import { POST as reactivateProject } from "../../../src/app/api/platform/projects/[projectId]/reactivate/route";
import { GET as listProjectMembers, POST as addProjectMember } from "../../../src/app/api/businesses/[businessId]/projects/[projectId]/members/route";

const mockedIdentity = vi.mocked(getCurrentIdentity);
const requester: AuthIdentity = {
  provider: "firebase",
  providerUserId: "task5-route-requester",
  email: "task5-route-requester@example.com",
  displayName: "Task 5 Requester",
  emailVerified: true,
};
const platformAdmin: AuthIdentity = {
  provider: "firebase",
  providerUserId: "task5-route-platform",
  email: "task5-route-platform@example.com",
  displayName: "Task 5 Platform Admin",
  emailVerified: true,
};
const ordinary: AuthIdentity = {
  provider: "firebase",
  providerUserId: "task5-route-ordinary",
  email: "task5-route-ordinary@example.com",
  displayName: "Task 5 Ordinary",
  emailVerified: true,
};

function request(body?: unknown, method = "POST") {
  return new Request("http://localhost/api/businesses/business-1/projects", {
    method,
    headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.90" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("project HTTP contracts", () => {
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
    mockedIdentity.mockResolvedValue(null);
  });

  it("denies non-platform global reads and returns pending business requests", async () => {
    const business = await createBusinessRequest({ name: "HTTP Project Harbour" }, requester, defaultOnboardingRepository);
    const requesterId = await defaultOnboardingRepository.upsertUser(requester);
    const platformUserId = await defaultOnboardingRepository.upsertUser(platformAdmin);
    defaultPlatformRepository.addMember({ id: "task5-route-platform-member", userId: platformUserId, normalizedEmail: platformAdmin.email });
    await createPlatformService({ tenancyRepository: defaultOnboardingRepository, platformRepository: defaultPlatformRepository }).approveBusiness(business.id, platformAdmin, { serviceExpiresAt: testServiceExpiresAt(), reason: "HTTP project setup" });
    expect(requesterId).toBeTruthy();

    mockedIdentity.mockResolvedValue(requester);
    const created = await createProject(request({ name: "HTTP Pending Project" }), { params: Promise.resolve({ businessId: business.id }) });
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({ status: "pending" });

    const listedForBusiness = await listBusinessProjects(request(undefined, "GET"), { params: Promise.resolve({ businessId: business.id }) });
    expect(listedForBusiness.status).toBe(200);
    await expect(listedForBusiness.json()).resolves.toMatchObject({ projects: [expect.objectContaining({ status: "pending" })] });

    const denied = await listPlatformProjects(new Request("http://localhost/api/platform/projects", { headers: { "x-forwarded-for": "198.51.100.91" } }));
    expect(denied.status).toBe(403);
  });

  it("allows the platform API to approve the pending project", async () => {
    const business = await createBusinessRequest({ name: "HTTP Approval Harbour" }, requester, defaultOnboardingRepository);
    const platformUserId = await defaultOnboardingRepository.upsertUser(platformAdmin);
    defaultPlatformRepository.addMember({ id: "task5-route-platform-member-2", userId: platformUserId, normalizedEmail: platformAdmin.email });
    await createPlatformService({ tenancyRepository: defaultOnboardingRepository, platformRepository: defaultPlatformRepository }).approveBusiness(business.id, platformAdmin, { serviceExpiresAt: testServiceExpiresAt(), reason: "HTTP project setup" });
    mockedIdentity.mockResolvedValue(requester);
    const created = await createProject(request({ name: "HTTP Approval Project" }), { params: Promise.resolve({ businessId: business.id }) });
    const project = await created.json() as { id: string };
    mockedIdentity.mockResolvedValue(platformAdmin);
    const response = await approveProject(new Request("http://localhost/api/platform/projects/approve", { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.92" }, body: JSON.stringify({ reason: "HTTP project approval" }) }), { params: Promise.resolve({ projectId: project.id }) });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ project: { id: project.id, status: "active" } });
    mockedIdentity.mockResolvedValue(ordinary);
    expect(await listPlatformProjects(new Request("http://localhost/api/platform/projects", { headers: { "x-forwarded-for": "198.51.100.93" } }))).toMatchObject({ status: 403 });
  });

  it("returns not found for every platform transition on a missing project", async () => {
    const platformUserId = await defaultOnboardingRepository.upsertUser(platformAdmin);
    defaultPlatformRepository.addMember({ id: "task5-route-platform-member-3", userId: platformUserId, normalizedEmail: platformAdmin.email });
    mockedIdentity.mockResolvedValue(platformAdmin);

    const rejectResponse = await rejectProject(
      new Request("http://localhost/api/platform/projects/missing/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.94" },
        body: JSON.stringify({ reason: "Missing project" }),
      }),
      { params: Promise.resolve({ projectId: "missing" }) },
    );
    const suspendResponse = await suspendProject(
      new Request("http://localhost/api/platform/projects/missing/suspend", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.95" },
        body: JSON.stringify({ reason: "Missing project" }),
      }),
      { params: Promise.resolve({ projectId: "missing" }) },
    );
    const reactivateResponse = await reactivateProject(
      new Request("http://localhost/api/platform/projects/missing/reactivate", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.96" },
        body: JSON.stringify({ reason: "Missing project reactivation" }),
      }),
      { params: Promise.resolve({ projectId: "missing" }) },
    );

    expect(rejectResponse.status).toBe(404);
    expect(suspendResponse.status).toBe(404);
    expect(reactivateResponse.status).toBe(404);
  });

  it("returns 403 for membership reads and writes on a pending project", async () => {
    const business = await createBusinessRequest({ name: "HTTP Membership Gate Harbour" }, requester, defaultOnboardingRepository);
    const platformUserId = await defaultOnboardingRepository.upsertUser(platformAdmin);
    defaultPlatformRepository.addMember({ id: "task5-membership-platform", userId: platformUserId, normalizedEmail: platformAdmin.email });
    await createPlatformService({ tenancyRepository: defaultOnboardingRepository, platformRepository: defaultPlatformRepository })
      .approveBusiness(business.id, platformAdmin, { serviceExpiresAt: testServiceExpiresAt(), reason: "Membership gate setup" });
    mockedIdentity.mockResolvedValue(requester);
    const projectResponse = await createProject(request({ name: "HTTP Pending Membership Project" }), { params: Promise.resolve({ businessId: business.id }) });
    const project = await projectResponse.json() as { id: string };
    const context = { params: Promise.resolve({ businessId: business.id, projectId: project.id }) };

    const listed = await listProjectMembers(request(undefined, "GET"), context);
    const added = await addProjectMember(request({ userId: "unknown-user", role: "member" }), context);
    expect(listed.status).toBe(403);
    expect(added.status).toBe(403);
  });

  it("returns 409 for duplicate membership after the active gates pass", async () => {
    const business = await createBusinessRequest({ name: "HTTP Duplicate Membership Harbour" }, requester, defaultOnboardingRepository);
    const platformUserId = await defaultOnboardingRepository.upsertUser(platformAdmin);
    const targetUserId = await defaultOnboardingRepository.upsertUser(ordinary);
    defaultPlatformRepository.addMember({ id: "task5-duplicate-platform", userId: platformUserId, normalizedEmail: platformAdmin.email });
    await createPlatformService({ tenancyRepository: defaultOnboardingRepository, platformRepository: defaultPlatformRepository })
      .approveBusiness(business.id, platformAdmin, { serviceExpiresAt: testServiceExpiresAt(), reason: "Duplicate membership setup" });
    mockedIdentity.mockResolvedValue(requester);
    const projectResponse = await createProject(request({ name: "HTTP Duplicate Membership Project" }), { params: Promise.resolve({ businessId: business.id }) });
    const project = await projectResponse.json() as { id: string };
    mockedIdentity.mockResolvedValue(platformAdmin);
    await approveProject(new Request("http://localhost/api/platform/projects/approve", { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.97" }, body: JSON.stringify({ reason: "Activate membership test" }) }), { params: Promise.resolve({ projectId: project.id }) });
    mockedIdentity.mockResolvedValue(requester);
    const context = { params: Promise.resolve({ businessId: business.id, projectId: project.id }) };
    const first = await addProjectMember(request({ userId: targetUserId, role: "member" }), context);
    const second = await addProjectMember(request({ userId: targetUserId, role: "member" }), context);
    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
  });
});
