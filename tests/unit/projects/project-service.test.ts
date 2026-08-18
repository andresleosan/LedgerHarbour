import { describe, expect, it } from "vitest";

import {
  createBusinessRequest,
  createInMemoryOnboardingRepository,
} from "../../../src/modules/tenancy/business-service";
import {
  createInMemoryPlatformRepository,
  createPlatformService,
} from "../../../src/modules/platform/platform-service";
import {
  createInMemoryProjectRepository,
  createProjectService,
  PROJECT_ERROR_CODES,
} from "../../../src/modules/projects/project-service";
import type { BusinessId, UserId } from "../../../src/modules/tenancy/types";
import { testServiceExpiresAt } from "../../helpers/business-fixtures";

const user = (value: string) => value as UserId;
const business = (value: string) => value as BusinessId;

async function approvedBusiness() {
  const tenancy = createInMemoryOnboardingRepository();
  const platform = createInMemoryPlatformRepository();
  const projectRepository = createInMemoryProjectRepository();
  const platformService = createPlatformService({ tenancyRepository: tenancy, platformRepository: platform });
  const requester = user("business-owner");
  const createdBusiness = await createBusinessRequest({ name: "Project Harbour" }, requester, tenancy);
  platform.addMember({ id: "platform-1", userId: user("platform-admin"), normalizedEmail: "platform@example.com" });
  await platformService.approveBusiness(createdBusiness.id, user("platform-admin"), { serviceExpiresAt: testServiceExpiresAt(), reason: "Project test setup" });
  return { tenancy, platform, projectRepository, requester, business: createdBusiness };
}

function serviceFor(input: Awaited<ReturnType<typeof approvedBusiness>>) {
  return createProjectService({
    tenancyRepository: input.tenancy,
    projectRepository: input.projectRepository,
    platformRepository: input.platform,
  });
}

describe("project approval lifecycle", () => {
  it("creates a pending project and denies effective access before approval", async () => {
    const setup = await approvedBusiness();
    const service = serviceFor(setup);

    const project = await service.createProjectRequest(setup.business.id, setup.requester, { name: "Pending Project" });

    expect(project).toMatchObject({
      businessId: setup.business.id,
      status: "pending",
      isActive: false,
      requesterId: setup.requester,
    });
    await expect(service.getEffectiveProjectAccess(project.id, setup.requester)).resolves.toMatchObject({
      allowed: false,
      reason: "project_pending",
    });
  });

  it("allows only a platform administrator to approve and audits the transition", async () => {
    const setup = await approvedBusiness();
    const service = serviceFor(setup);
    const project = await service.createProjectRequest(setup.business.id, setup.requester, { name: "Approved Project" });

    await expect(service.approveProject(project.id, setup.requester, { reason: "Requester approval" })).rejects.toMatchObject({
      code: PROJECT_ERROR_CODES.PLATFORM_ACCESS_DENIED,
    });

    const approved = await service.approveProject(project.id, user("platform-admin"), { reason: "Project approved" });
    expect(approved).toMatchObject({ status: "active", isActive: true });
    await expect(service.getEffectiveProjectAccess(project.id, setup.requester)).resolves.toMatchObject({ allowed: true });
    expect(setup.platform.auditEvents).toContainEqual(expect.objectContaining({
      action: "project_approved",
      targetType: "project",
      targetId: project.id,
      beforeStatus: "pending",
      afterStatus: "active",
    }));
  });

  it("enforces rejection, suspension and reactivation transitions with reasons and CAS", async () => {
    const setup = await approvedBusiness();
    const service = serviceFor(setup);
    const rejected = await service.createProjectRequest(setup.business.id, setup.requester, { name: "Rejected Project" });
    await service.rejectProject(rejected.id, user("platform-admin"), { reason: "Insufficient information" });
    await expect(service.approveProject(rejected.id, user("platform-admin"), { reason: "Project reapproval" })).rejects.toMatchObject({
      code: PROJECT_ERROR_CODES.INVALID_TRANSITION,
    });

    const project = await service.createProjectRequest(setup.business.id, setup.requester, { name: "Suspended Project" });
    await service.approveProject(project.id, user("platform-admin"), { reason: "Project approved" });
    const results = await Promise.allSettled([
      service.suspendProject(project.id, user("platform-admin"), { reason: "Service review" }),
      service.suspendProject(project.id, user("platform-admin"), { reason: "Concurrent review" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    await expect(service.reactivateProject(project.id, user("platform-admin"), { reason: "Review complete" })).resolves.toMatchObject({
      status: "active",
      isActive: true,
    });
  });

  it("denies project access while the parent business is suspended", async () => {
    const setup = await approvedBusiness();
    const service = serviceFor(setup);
    const project = await service.createProjectRequest(setup.business.id, setup.requester, { name: "Parent Gate Project" });
    await service.approveProject(project.id, user("platform-admin"), { reason: "Project approved" });

    await createPlatformService({ tenancyRepository: setup.tenancy, platformRepository: setup.platform })
      .suspendBusiness(setup.business.id, user("platform-admin"), { reason: "Business suspended" });

    await expect(service.getEffectiveProjectAccess(project.id, setup.requester)).resolves.toMatchObject({
      allowed: false,
      reason: "business_suspended",
    });
  });

  it("keeps project membership and project listings tenant-isolated", async () => {
    const tenancy = createInMemoryOnboardingRepository();
    const platform = createInMemoryPlatformRepository();
    const projectRepository = createInMemoryProjectRepository();
    const platformService = createPlatformService({ tenancyRepository: tenancy, platformRepository: platform });
    const firstBusiness = await createBusinessRequest({ name: "First Project Harbour" }, user("owner-a"), tenancy);
    const secondBusiness = await createBusinessRequest({ name: "Second Project Harbour" }, user("owner-b"), tenancy);
    platform.addMember({ id: "platform-1", userId: user("platform-admin"), normalizedEmail: "platform@example.com" });
  await platformService.approveBusiness(firstBusiness.id, user("platform-admin"), { serviceExpiresAt: testServiceExpiresAt(), reason: "Project isolation setup" });
  await platformService.approveBusiness(secondBusiness.id, user("platform-admin"), { serviceExpiresAt: testServiceExpiresAt(), reason: "Project isolation setup" });
    const firstService = createProjectService({ tenancyRepository: tenancy, projectRepository, platformRepository: platform });
    const secondService = firstService;
    const project = await firstService.createProjectRequest(firstBusiness.id, user("owner-a"), { name: "Private Project" });
    await firstService.approveProject(project.id, user("platform-admin"), { reason: "Cross-tenant approval" });

    await expect(secondService.listProjectsForBusiness(firstBusiness.id, user("owner-b"))).rejects.toMatchObject({
      code: PROJECT_ERROR_CODES.BUSINESS_ACCESS_DENIED,
    });
    await expect(secondService.getEffectiveProjectAccess(project.id, user("owner-b"))).resolves.toMatchObject({
      allowed: false,
      reason: "membership_required",
    });
    await expect(firstService.listProjectsForBusiness(firstBusiness.id, user("owner-a"))).resolves.toHaveLength(1);
    expect(business(project.businessId)).toBe(firstBusiness.id);
  });

  it("rejects project membership identifiers that do not resolve to a known user", async () => {
    const setup = await approvedBusiness();
    const service = serviceFor(setup);
    const project = await service.createProjectRequest(setup.business.id, setup.requester, { name: "Member Validation Project" });
    await service.approveProject(project.id, user("platform-admin"), { reason: "Activate member validation project" });

    await expect(service.addProjectMember(setup.business.id, project.id, setup.requester, {
      userId: user("unknown-user"),
      role: "member",
    })).rejects.toMatchObject({ code: PROJECT_ERROR_CODES.INVALID_MEMBER });
  });

  it.each(["pending", "rejected", "suspended"] as const)("denies membership operations for a %s project", async (status) => {
    const setup = await approvedBusiness();
    const service = serviceFor(setup);
    const project = await service.createProjectRequest(setup.business.id, setup.requester, { name: `${status} Membership Project` });

    if (status === "rejected") await service.rejectProject(project.id, user("platform-admin"), { reason: "Rejected for membership gate" });
    if (status === "suspended") {
      await service.approveProject(project.id, user("platform-admin"), { reason: "Approved before suspension" });
      await service.suspendProject(project.id, user("platform-admin"), { reason: "Suspended for membership gate" });
    }

    await expect(service.listProjectMembers(setup.business.id, project.id, setup.requester)).rejects.toMatchObject({
      code: "PROJECT_ACCESS_DENIED",
    });
    await expect(service.addProjectMember(setup.business.id, project.id, setup.requester, {
      userId: setup.requester,
      role: "member",
    })).rejects.toMatchObject({ code: "PROJECT_ACCESS_DENIED" });
  });

  it("denies membership operations when the parent business is inactive", async () => {
    const setup = await approvedBusiness();
    const service = serviceFor(setup);
    const project = await service.createProjectRequest(setup.business.id, setup.requester, { name: "Inactive Business Membership Project" });
    await service.approveProject(project.id, user("platform-admin"), { reason: "Business gate setup" });
    await createPlatformService({ tenancyRepository: setup.tenancy, platformRepository: setup.platform })
      .suspendBusiness(setup.business.id, user("platform-admin"), { reason: "Business gate" });

    await expect(service.listProjectMembers(setup.business.id, project.id, setup.requester)).rejects.toMatchObject({
      code: "BUSINESS_INACTIVE",
    });
    await expect(service.addProjectMember(setup.business.id, project.id, setup.requester, {
      userId: setup.requester,
      role: "member",
    })).rejects.toMatchObject({ code: "BUSINESS_INACTIVE" });
  });

  it("serializes effective access with a concurrent parent-business suspension", async () => {
    const setup = await approvedBusiness();
    const service = serviceFor(setup);
    const project = await service.createProjectRequest(setup.business.id, setup.requester, { name: "Snapshot Project" });
    await service.approveProject(project.id, user("platform-admin"), { reason: "Project approved" });

    let releaseMembership!: () => void;
    const membershipGate = new Promise<void>((resolve) => { releaseMembership = resolve; });
    let membershipReadStarted!: () => void;
    const membershipRead = new Promise<void>((resolve) => { membershipReadStarted = resolve; });
    const findMembership = setup.projectRepository.findProjectMembership.bind(setup.projectRepository);
    setup.projectRepository.findProjectMembership = async (projectId, userId) => {
      membershipReadStarted();
      await membershipGate;
      return findMembership(projectId, userId);
    };

    const accessPromise = service.getEffectiveProjectAccess(project.id, setup.requester);
    await membershipRead;
    const suspensionPromise = createPlatformService({ tenancyRepository: setup.tenancy, platformRepository: setup.platform })
      .suspendBusiness(setup.business.id, user("platform-admin"), { reason: "Concurrent suspension" });
    const suspensionRace = await Promise.race([
      suspensionPromise.then(() => "suspended" as const),
      new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 20)),
    ]);
    expect(suspensionRace).toBe("blocked");

    releaseMembership();
    await expect(accessPromise).resolves.toMatchObject({ allowed: true });
    await suspensionPromise;
    await expect(service.getEffectiveProjectAccess(project.id, setup.requester)).resolves.toMatchObject({
      allowed: false,
      reason: "business_suspended",
    });
  });
});
