import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PATCH as patchMemberRoute } from "../../../src/app/api/businesses/[businessId]/members/[membershipId]/route";
import { POST as transferOwnershipRoute } from "../../../src/app/api/businesses/[businessId]/ownership/transfer/route";
import { PATCH as lifecycleRoute } from "../../../src/app/api/businesses/[businessId]/lifecycle/route";
import { clearCurrentIdentity, setCurrentIdentity } from "../../../src/modules/auth/session";
import {
  createInMemoryOnboardingRepository,
  createOnboardingServices,
  defaultOnboardingRepository,
} from "../../../src/modules/tenancy/business-service";
import {
  BusinessLifecycleError,
  createBusinessLifecycleService,
  LIFECYCLE_ERROR_CODES,
  requireBusinessOperational,
} from "../../../src/modules/tenancy/business-lifecycle-service";
import { createMembershipService, MEMBERSHIP_ERROR_CODES } from "../../../src/modules/tenancy/membership-service";
import type { UserId } from "../../../src/modules/tenancy/types";
import { createApprovedBusiness } from "../../helpers/business-fixtures";

const user = (value: string) => value as UserId;
const identity = (id: string) => ({ providerUserId: id, email: `${id}@example.com`, displayName: id, emailVerified: true });
const contextFor = (businessId: string, membershipId: string) => ({ params: Promise.resolve({ businessId, membershipId }) });
const lifecycleContext = (businessId: string) => ({ params: Promise.resolve({ businessId }) });
const requestFor = (body: unknown, method = "PATCH") => new Request("http://localhost", {
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  await expect(response.json()).resolves.toMatchObject({ error: { code, message: expect.any(String) } });
}

describe("membership administration routes and business lifecycle", () => {
  beforeEach(() => {
    process.env.AUTH_MODE = "development";
    defaultOnboardingRepository.businesses.clear();
    defaultOnboardingRepository.memberships.splice(0);
    defaultOnboardingRepository.categories.splice(0);
    defaultOnboardingRepository.joinRequests.splice(0);
    defaultOnboardingRepository.auditEvents.splice(0);
  });

  afterEach(async () => clearCurrentIdentity());

  it("covers the member route status matrix and stable public errors", async () => {
    const created = await createApprovedBusiness(defaultOnboardingRepository, "Route Members", identity("owner"));
    const adminId = await defaultOnboardingRepository.upsertUser(identity("admin"));
    const adminMembership = await defaultOnboardingRepository.createMembership({ membershipId: "membership-admin", userId: adminId, businessId: created.id, role: "administrator", isActive: true, status: "active" });
    const ownerId = await defaultOnboardingRepository.upsertUser(identity("owner"));
    const ownerMembership = (await defaultOnboardingRepository.findMembership(ownerId, created.id))!;

    await expectError(await patchMemberRoute(requestFor({ action: "remove_administrator" }), contextFor(created.id, "admin")), 401, "IDENTITY_REQUIRED");
    await setCurrentIdentity(identity("owner"));
    await expectError(await patchMemberRoute(requestFor({ action: "remove_administrator" }), contextFor(created.id, "missing")), 404, "MEMBER_NOT_FOUND");
    await expectError(await patchMemberRoute(requestFor({ action: "invalid" }), contextFor(created.id, adminMembership.membershipId)), 400, "INVALID_ACTION");
    await setCurrentIdentity(identity("admin"));
    await expectError(await patchMemberRoute(requestFor({ action: "remove_administrator" }), contextFor(created.id, "admin")), 403, "INSUFFICIENT_CAPABILITY");

    await setCurrentIdentity(identity("owner"));
    const admin2Id = await defaultOnboardingRepository.upsertUser(identity("admin-2"));
    const admin2Membership = await defaultOnboardingRepository.createMembership({ membershipId: "membership-admin-2", userId: admin2Id, businessId: created.id, role: "administrator", isActive: true, status: "active" });
    await expectError(await patchMemberRoute(requestFor({ action: "remove_general_admin" }), contextFor(created.id, admin2Membership.membershipId)), 400, "INVALID_TARGET");
    const success = await patchMemberRoute(requestFor({ action: "remove_administrator" }), contextFor(created.id, adminMembership.membershipId));
    expect(success.status).toBe(200);
    await expect(success.json()).resolves.toEqual({ ok: true });

    const crossBusiness = await createApprovedBusiness(defaultOnboardingRepository, "Other Route Members", identity("other-owner"));
    await setCurrentIdentity(identity("other-owner"));
    await expectError(await patchMemberRoute(requestFor({ action: "remove_administrator" }), contextFor(crossBusiness.id, adminMembership.membershipId)), 404, "MEMBER_NOT_FOUND");

    await setCurrentIdentity(identity("owner"));
    const ownerTarget = await patchMemberRoute(requestFor({ action: "remove_administrator" }), contextFor(created.id, ownerMembership.membershipId));
    expect(ownerTarget.status).toBe(400);
    await expect(ownerTarget.json()).resolves.toEqual({
      error: { code: "OWNER_PROTECTED", message: "The current Owner Admin cannot be removed here." },
    });
  });

  it("covers ownership confirmation, transfer, and lifecycle status contracts", async () => {
    const created = await createApprovedBusiness(defaultOnboardingRepository, "Route Lifecycle", identity("owner"));
    const targetId = await defaultOnboardingRepository.upsertUser(identity("target"));
    const targetMembership = await defaultOnboardingRepository.createMembership({ membershipId: "membership-target", userId: targetId, businessId: created.id, role: "administrator", isActive: true, status: "active" });

    await expectError(await transferOwnershipRoute(requestFor({ targetMembershipId: targetMembership.membershipId }, "POST"), lifecycleContext(created.id)), 401, "IDENTITY_REQUIRED");
    await setCurrentIdentity(identity("owner"));
    await expectError(await transferOwnershipRoute(requestFor({ targetMembershipId: targetMembership.membershipId, confirmationName: "wrong", reauthenticatedAt: new Date().toISOString() }, "POST"), lifecycleContext(created.id)), 400, "CONFIRMATION_REQUIRED");
    await expectError(await lifecycleRoute(requestFor({ action: "invalid" }), lifecycleContext(created.id)), 400, "INVALID_ACTION");
    await expectError(await lifecycleRoute(requestFor({ action: "deactivate", confirmationName: "Route Lifecycle" }), lifecycleContext("missing")), 403, "PLATFORM_ADMIN_REQUIRED");

    const transferred = await transferOwnershipRoute(requestFor({ targetMembershipId: targetMembership.membershipId, confirmationName: "Route Lifecycle", reauthenticatedAt: new Date().toISOString() }, "POST"), lifecycleContext(created.id));
    expect(transferred.status).toBe(200);
    await expect(transferred.json()).resolves.toEqual({ ok: true });

    await setCurrentIdentity(identity("target"));
    await expectError(await lifecycleRoute(requestFor({ action: "deactivate", confirmationName: "Route Lifecycle" }), lifecycleContext(created.id)), 403, "PLATFORM_ADMIN_REQUIRED");
    await expectError(await lifecycleRoute(requestFor({ action: "reactivate", confirmationName: "Route Lifecycle" }), lifecycleContext(created.id)), 403, "PLATFORM_ADMIN_REQUIRED");
    expect(defaultOnboardingRepository.businesses.get(created.id)).toMatchObject({ status: "active", isActive: true });
    expect(defaultOnboardingRepository.auditEvents.map((event) => event.type)).toContain("ownership_transferred");
  });

  it("covers ownership transfer route 403, 404, 409, invalid target, and stable bodies", async () => {
    const created = await createApprovedBusiness(defaultOnboardingRepository, "Ownership Matrix", identity("owner"));
    const targetId = await defaultOnboardingRepository.upsertUser(identity("target"));
    const targetMembership = await defaultOnboardingRepository.createMembership({ membershipId: "membership-target-2", userId: targetId, businessId: created.id, role: "administrator", isActive: true, status: "active" });
    const validConfirmation = {
      targetMembershipId: targetMembership.membershipId,
      confirmationName: "Ownership Matrix",
      reauthenticatedAt: new Date().toISOString(),
    };

    await clearCurrentIdentity();
    const unauthenticated = await transferOwnershipRoute(requestFor(validConfirmation, "POST"), lifecycleContext(created.id));
    expect(unauthenticated.status).toBe(401);
    await expect(unauthenticated.json()).resolves.toEqual({
      error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." },
    });

    await setCurrentIdentity(identity("target"));
    const forbidden = await transferOwnershipRoute(requestFor(validConfirmation, "POST"), lifecycleContext(created.id));
    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toEqual({
      error: { code: "INSUFFICIENT_CAPABILITY", message: "You do not have permission to manage members." },
    });

    await setCurrentIdentity(identity("owner"));
    const hidden = await transferOwnershipRoute(requestFor({ ...validConfirmation, targetMembershipId: "missing" }, "POST"), lifecycleContext(created.id));
    expect(hidden.status).toBe(404);
    await expect(hidden.json()).resolves.toEqual({
      error: { code: "MEMBER_NOT_FOUND", message: "Member not found." },
    });
    const ownerId = await defaultOnboardingRepository.upsertUser(identity("owner"));
    const ownerMembership = (await defaultOnboardingRepository.findMembership(ownerId, created.id))!;
    const invalidTarget = await transferOwnershipRoute(requestFor({ ...validConfirmation, targetMembershipId: ownerMembership.membershipId }, "POST"), lifecycleContext(created.id));
    expect(invalidTarget.status).toBe(400);
    await expect(invalidTarget.json()).resolves.toEqual({
      error: { code: "INVALID_TARGET", message: "This membership target is not valid." },
    });

    defaultOnboardingRepository.businesses.get(created.id)!.isActive = false;
    const conflict = await transferOwnershipRoute(requestFor(validConfirmation, "POST"), lifecycleContext(created.id));
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toEqual({
      error: { code: "INACTIVE_BUSINESS", message: "This business is inactive." },
    });
  });

  it("denies an ordinary Administrator at service and route lifecycle boundaries", async () => {
    const created = await createApprovedBusiness(defaultOnboardingRepository, "Administrator Boundary", identity("owner"));
    const administratorId = await defaultOnboardingRepository.upsertUser(identity("administrator"));
    await defaultOnboardingRepository.createMembership({ membershipId: "membership-administrator", userId: administratorId, businessId: created.id, role: "administrator", isActive: true, status: "active" });
    const lifecycle = createBusinessLifecycleService(defaultOnboardingRepository);
    const membership = createMembershipService(defaultOnboardingRepository);

    await expect(membership.removeAdministrator({ businessId: created.id, membershipId: "owner" }, user("administrator")))
      .rejects.toMatchObject({ code: MEMBERSHIP_ERROR_CODES.INSUFFICIENT_CAPABILITY });
    await expect(lifecycle.deactivateBusiness(created.id, user("administrator"), "Administrator Boundary"))
      .rejects.toMatchObject({ code: LIFECYCLE_ERROR_CODES.PLATFORM_ADMIN_REQUIRED });

    await setCurrentIdentity(identity("administrator"));
    const ownerId = await defaultOnboardingRepository.upsertUser(identity("owner"));
    const ownerMembership = (await defaultOnboardingRepository.findMembership(ownerId, created.id))!;
    const memberRoute = await patchMemberRoute(requestFor({ action: "remove_administrator" }), contextFor(created.id, ownerMembership.membershipId));
    expect(memberRoute.status).toBe(403);
    await expect(memberRoute.json()).resolves.toEqual({
      error: { code: "INSUFFICIENT_CAPABILITY", message: "You do not have permission to manage members." },
    });
    const lifecycleRouteResponse = await lifecycleRoute(requestFor({ action: "deactivate", confirmationName: "Administrator Boundary" }), lifecycleContext(created.id));
    expect(lifecycleRouteResponse.status).toBe(403);
    await expect(lifecycleRouteResponse.json()).resolves.toEqual({
      error: { code: "PLATFORM_ADMIN_REQUIRED", message: "Only a platform administrator can change business lifecycle." },
    });
  });

  it("blocks legacy lifecycle writes and preserves the active business", async () => {
    const repository = createInMemoryOnboardingRepository();
    const created = await createApprovedBusiness(repository, "Soft Lifecycle", user("owner"));
     repository.memberships.push({ membershipId: "membership-member", userId: user("member"), businessId: created.id, role: "administrator", isActive: true, status: "active" });
    const lifecycle = createBusinessLifecycleService(repository);

    await expect(lifecycle.deactivateBusiness(created.id, user("owner"), "Wrong Name")).rejects.toMatchObject({ code: LIFECYCLE_ERROR_CODES.PLATFORM_ADMIN_REQUIRED });
    expect(repository.businesses.get(created.id)).toMatchObject({ status: "active", isActive: true, name: "Soft Lifecycle" });
    expect(repository.memberships).toContainEqual(expect.objectContaining({ membershipId: "membership-member", userId: user("member"), businessId: created.id, role: "administrator", isActive: true }));
    await expect(lifecycle.deactivateBusiness(created.id, user("owner"), "Soft Lifecycle")).rejects.toMatchObject({ code: LIFECYCLE_ERROR_CODES.PLATFORM_ADMIN_REQUIRED });
    await expect(lifecycle.reactivateBusiness(created.id, user("owner"), "Wrong Name")).rejects.toMatchObject({ code: LIFECYCLE_ERROR_CODES.PLATFORM_ADMIN_REQUIRED });
    await expect(lifecycle.reactivateBusiness(created.id, user("owner"), "Soft Lifecycle")).rejects.toMatchObject({ code: LIFECYCLE_ERROR_CODES.PLATFORM_ADMIN_REQUIRED });
    expect(repository.businesses.get(created.id)?.isActive).toBe(true);
    expect(repository.memberships).toContainEqual(expect.objectContaining({ membershipId: "membership-member", userId: user("member"), businessId: created.id, role: "administrator", isActive: true }));
  });

  it("passes CAS expectations for every membership mutation", async () => {
    const enforceCas = (repository: ReturnType<typeof createInMemoryOnboardingRepository>) => {
      let wrapped!: typeof repository;
      wrapped = new Proxy(repository, {
        get(target, property, receiver) {
          if (property === "transaction") {
            return (operation: (transaction: typeof repository) => Promise<unknown>) =>
              target.transaction(() => operation(wrapped));
          }
          if (property === "updateMembership" || property === "deleteMembership") {
            return (...args: [unknown, unknown?]) => {
              if (args[1] === undefined) throw new Error("membership CAS expectation missing");
              return (target[property] as (...values: unknown[]) => unknown)(...args);
            };
          }
          return Reflect.get(target, property, receiver);
        },
      });
      return wrapped;
    };

    const createScenario = async () => {
      const baseRepository = createInMemoryOnboardingRepository();
      const created = await createApprovedBusiness(baseRepository, "CAS Harbour", identity("cas-owner"));
      const targetId = await baseRepository.upsertUser(identity("cas-target"));
      const target = await baseRepository.createMembership({
        membershipId: "cas-target-membership",
        userId: targetId,
        businessId: created.id,
        role: "administrator",
        isActive: true,
        status: "active",
      });
      const ownerId = baseRepository.memberships.find((membership) => membership.role === "owner_admin")!.userId;
      return { repository: enforceCas(baseRepository), created, target, ownerId };
    };

    const setScenario = await createScenario();
    expect(setScenario.repository.memberships.find((membership) => membership.role === "owner_admin")).toMatchObject({
      userId: setScenario.ownerId,
      isActive: true,
      status: "active",
    });
    await createMembershipService(setScenario.repository).setGeneralAdmin(
      { businessId: setScenario.created.id, membershipId: setScenario.target.membershipId },
      setScenario.ownerId,
    );

    const removeScenario = await createScenario();
    await createMembershipService(removeScenario.repository).removeAdministrator(
      { businessId: removeScenario.created.id, membershipId: removeScenario.target.membershipId },
      removeScenario.ownerId,
    );

    const transferScenario = await createScenario();
    await createMembershipService(transferScenario.repository).transferOwnership(
      {
        businessId: transferScenario.created.id,
        targetMembershipId: transferScenario.target.membershipId,
        confirmationName: "CAS Harbour",
        reauthenticatedAt: new Date().toISOString(),
      },
      transferScenario.ownerId,
    );
  });

  it("blocks inactive join requests and reviews while preserving pending state", async () => {
    const repository = createInMemoryOnboardingRepository();
    const onboarding = createOnboardingServices(repository);
    const created = await createApprovedBusiness(repository, "Inactive Operations", user("owner"));
    const pending = await onboarding.requestMembership({ businessId: created.id, requestedRole: "administrator" }, user("requester"));
    const business = repository.businesses.get(created.id)!;
    business.status = "suspended";
    business.isActive = false;
    await expect(onboarding.requestMembership({ businessId: created.id, requestedRole: "administrator" }, user("requester-2")))
      .rejects.toMatchObject({ code: "INACTIVE_BUSINESS" });
    await expect(onboarding.listJoinRequests(created.id, user("owner")))
      .rejects.toMatchObject({ code: "INSUFFICIENT_CAPABILITY" });
    await expect(onboarding.reviewJoinRequest({ businessId: created.id, joinRequestId: pending.id, decision: "approved" }, user("owner")))
      .rejects.toMatchObject({ code: "INSUFFICIENT_CAPABILITY" });
    expect(repository.joinRequests).toContainEqual(expect.objectContaining({ id: pending.id, status: "pending" }));
    expect(repository.memberships).toContainEqual(expect.objectContaining({ userId: user("owner"), role: "owner_admin" }));
  });

  it("requires an exact lifecycle confirmation at the route boundary", async () => {
    const created = await createApprovedBusiness(defaultOnboardingRepository, "Confirmed Lifecycle", identity("owner"));
    await setCurrentIdentity(identity("owner"));

    await expectError(await lifecycleRoute(requestFor({ action: "deactivate" }), lifecycleContext(created.id)), 400, "CONFIRMATION_REQUIRED");
    await expectError(await lifecycleRoute(requestFor({ action: "deactivate", confirmationName: "Wrong" }), lifecycleContext(created.id)), 403, "PLATFORM_ADMIN_REQUIRED");
    await expect(requireBusinessOperational(defaultOnboardingRepository, created.id)).resolves.toMatchObject({ isActive: true });
    expect(new BusinessLifecycleError(LIFECYCLE_ERROR_CODES.CONFIRMATION_REQUIRED).message).toContain("exact business name");
  });
});
