import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST as createBusinessRoute } from "../../../src/app/api/businesses/route";
import {
  GET as getJoinRequestsRoute,
  PATCH as patchJoinRequestsRoute,
  POST as postJoinRequestRoute,
} from "../../../src/app/api/businesses/[businessId]/join-requests/route";
import { GET as searchBusinessesRoute } from "../../../src/app/api/businesses/search/route";
import { clearCurrentIdentity, setCurrentIdentity } from "../../../src/modules/auth/session";

import {
  createInMemoryOnboardingRepository,
  createOnboardingServices,
  defaultOnboardingRepository,
  OnboardingError,
  ONBOARDING_ERROR_CODES,
  type JoinRequest,
} from "../../../src/modules/tenancy/business-service";
import type { BusinessId, UserId } from "../../../src/modules/tenancy/types";
import { createApprovedBusiness } from "../../helpers/business-fixtures";

const user = (value: string) => value as UserId;
const business = (value: string) => value as BusinessId;

async function expectErrorResponse(
  response: Response,
  status: number,
  code: string,
  message: string,
) {
  expect(response.status).toBe(status);
  await expect(response.json()).resolves.toEqual({ error: { code, message } });
}

describe("in-memory onboarding repository boundary", () => {
  beforeEach(() => {
    process.env.AUTH_MODE = "development";
    defaultOnboardingRepository.businesses.clear();
    defaultOnboardingRepository.memberships.splice(0);
    defaultOnboardingRepository.categories.splice(0);
    defaultOnboardingRepository.joinRequests.splice(0);
    defaultOnboardingRepository.auditEvents.splice(0);
  });

  afterEach(async () => {
    await clearCurrentIdentity();
  });

  it("supports create, request, approve, and rejects a second pending request", async () => {
    const repository = createInMemoryOnboardingRepository();
    const services = createOnboardingServices(repository);
    const created = await createApprovedBusiness(repository, "Integration Books", user("owner"));

    const request = await services.requestMembership(
      { businessId: created.id, requestedRole: "administrator" },
      user("member"),
    );
    await expect(
      services.requestMembership(
        { businessId: created.id, requestedRole: "administrator" },
        user("member"),
      ),
    ).rejects.toMatchObject({ code: ONBOARDING_ERROR_CODES.PENDING_REQUEST_CONFLICT });

    const reviewed = await services.reviewJoinRequest(
      { businessId: created.id, joinRequestId: request.id, decision: "approved" },
      user("owner"),
    );
    expect(reviewed.status).toBe("approved");
    expect(repository.memberships).toContainEqual(expect.objectContaining({
      userId: user("member"),
      businessId: created.id,
      role: "administrator",
      isActive: true,
    }));
  });

  it("allows a rejected user to reapply and records reviewer metadata without membership", async () => {
    const repository = createInMemoryOnboardingRepository();
    const services = createOnboardingServices(repository);
    const created = await createApprovedBusiness(repository, "Reapply Books", user("owner"));

    const first = await services.requestMembership(
      { businessId: created.id, requestedRole: "administrator" },
      user("member"),
    );
    const rejected = await services.reviewJoinRequest(
      { businessId: created.id, joinRequestId: first.id, decision: "rejected" },
      user("owner"),
    );
    expect(rejected).toMatchObject({
      status: "rejected",
      reviewerId: user("owner"),
      reviewedAt: expect.any(String),
    });
    expect(repository.memberships.filter((item) => item.userId === user("member"))).toHaveLength(0);

    await expect(services.listUserJoinRequests(created.id, user("member"))).resolves.toEqual([
      { status: "rejected" },
    ]);

    await expect(
      services.requestMembership(
        { businessId: created.id, requestedRole: "administrator" },
        user("member"),
      ),
    ).resolves.toMatchObject({ status: "pending" });
  });

  it("returns requester history chronologically even when repository rows are out of order", async () => {
    const repository = createInMemoryOnboardingRepository();
    const services = createOnboardingServices(repository);
    const created = await createApprovedBusiness(repository, "Chronological Books", user("owner"));
    const first = await services.requestMembership(
      { businessId: created.id, requestedRole: "administrator" },
      user("member"),
    );
    await services.reviewJoinRequest(
      { businessId: created.id, joinRequestId: first.id, decision: "rejected" },
      user("owner"),
    );
    const second = await services.requestMembership(
      { businessId: created.id, requestedRole: "administrator" },
      user("member"),
    );
    const firstRow = repository.joinRequests.find((request) => request.id === first.id) as JoinRequest;
    const secondRow = repository.joinRequests.find((request) => request.id === second.id) as JoinRequest;
    firstRow.createdAt = "2026-08-11T10:00:00.000Z";
    secondRow.createdAt = "2026-08-11T11:00:00.000Z";
    repository.joinRequests.reverse();

    await expect(services.listUserJoinRequests(created.id, user("member"))).resolves.toEqual([
      { status: "rejected" },
      { status: "pending" },
    ]);

  });

  it("denies administrators from listing requests and hides requests from another business", async () => {
    const repository = createInMemoryOnboardingRepository();
    const services = createOnboardingServices(repository);
    const first = await createApprovedBusiness(repository, "First", user("owner-1"));
    const second = await createApprovedBusiness(repository, "Second", user("owner-2"));
    const request = await services.requestMembership(
      { businessId: first.id, requestedRole: "administrator" },
      user("member"),
    );
    await services.reviewJoinRequest(
      { businessId: first.id, joinRequestId: request.id, decision: "rejected" },
      user("owner-1"),
    );
    repository.memberships.push({
       membershipId: "membership-admin",
      userId: user("admin"),
      businessId: first.id,
      role: "administrator",
      isActive: true,
    });

    await expect(services.listJoinRequests(first.id, user("admin"))).rejects.toMatchObject({
      code: ONBOARDING_ERROR_CODES.INSUFFICIENT_CAPABILITY,
    });
    await expect(services.listJoinRequests(second.id, user("owner-2"))).resolves.toEqual([]);
    await expect(
      services.reviewJoinRequest(
        { businessId: business(second.id), joinRequestId: request.id, decision: "approved" },
        user("owner-2"),
      ),
    ).rejects.toMatchObject({ code: ONBOARDING_ERROR_CODES.HIDDEN_REQUEST });
  });

  it("rejects inactive targets without disclosing business details", async () => {
    const repository = createInMemoryOnboardingRepository();
    const services = createOnboardingServices(repository);
    const created = await createApprovedBusiness(repository, "Inactive", user("owner"));
    repository.businesses.get(created.id)!.isActive = false;

    await expect(
      services.requestMembership(
        { businessId: created.id, requestedRole: "administrator" },
        user("member"),
      ),
    ).rejects.toMatchObject({ code: ONBOARDING_ERROR_CODES.INACTIVE_BUSINESS });
  });

  it("allows General Admin to approve and reject Administrator requests", async () => {
    const repository = createInMemoryOnboardingRepository();
    const services = createOnboardingServices(repository);
    const created = await createApprovedBusiness(repository, "General Admin Books", user("owner"));
    repository.memberships.push({
       membershipId: "membership-general-admin",
      userId: user("general-admin"),
      businessId: created.id,
       role: "general_admin",
       isActive: true,
       status: "active",
    });
    const approvedRequest = await services.requestMembership(
      { businessId: created.id, requestedRole: "administrator" },
      user("approved-member"),
    );
    const rejectedRequest = await services.requestMembership(
      { businessId: created.id, requestedRole: "administrator" },
      user("rejected-member"),
    );

    await expect(
      services.reviewJoinRequest(
        { businessId: created.id, joinRequestId: approvedRequest.id, decision: "approved" },
        user("general-admin"),
      ),
    ).resolves.toMatchObject({ status: "approved", reviewerId: user("general-admin") });
    await expect(
      services.reviewJoinRequest(
        { businessId: created.id, joinRequestId: rejectedRequest.id, decision: "rejected" },
        user("general-admin"),
      ),
    ).resolves.toMatchObject({ status: "rejected", reviewerId: user("general-admin") });
  });

  it("denies a General Admin from reviewing another business", async () => {
    const repository = createInMemoryOnboardingRepository();
    const services = createOnboardingServices(repository);
    const first = await createApprovedBusiness(repository, "General Admin First", user("owner-1"));
    const second = await createApprovedBusiness(repository, "General Admin Second", user("owner-2"));
    repository.memberships.push({
       membershipId: "membership-general-admin-first",
      userId: user("general-admin"),
      businessId: first.id,
       role: "general_admin",
       isActive: true,
       status: "active",
    });
    const request = await services.requestMembership(
      { businessId: second.id, requestedRole: "administrator" },
      user("requester"),
    );

    await expect(
      services.reviewJoinRequest(
        { businessId: first.id, joinRequestId: request.id, decision: "approved" },
        user("general-admin"),
      ),
    ).rejects.toMatchObject({ code: ONBOARDING_ERROR_CODES.HIDDEN_REQUEST });
  });

  it("serializes concurrent approvals with one success and one stable conflict", async () => {
    const repository = createInMemoryOnboardingRepository();
    const services = createOnboardingServices(repository);
    const created = await createApprovedBusiness(repository, "Concurrent Books", user("owner"));
    const request = await services.requestMembership(
      { businessId: created.id, requestedRole: "administrator" },
      user("concurrent-member"),
    );

    const results = await Promise.allSettled([
      services.reviewJoinRequest(
        { businessId: created.id, joinRequestId: request.id, decision: "approved" },
        user("owner"),
      ),
      services.reviewJoinRequest(
        { businessId: created.id, joinRequestId: request.id, decision: "approved" },
        user("owner"),
      ),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: expect.objectContaining({ code: ONBOARDING_ERROR_CODES.REPOSITORY_CONFLICT }),
    });
    expect(repository.memberships.filter((membership) => membership.userId === user("concurrent-member"))).toHaveLength(1);
    expect(repository.auditEvents.filter((event) => event.type === "join_request_approved")).toHaveLength(1);
    expect(repository.joinRequests.find((candidate) => candidate.id === request.id)).toMatchObject({ status: "approved" });
  });

  it("covers direct route authentication, validation, conflict, hidden, and transition contracts", async () => {
    const identity = (id: string) => ({
      providerUserId: id,
      email: `${id}@example.com`,
      displayName: id,
      emailVerified: true,
    });
    const contextFor = (businessId: string) => ({ params: Promise.resolve({ businessId }) });
    const jsonRequest = (body: string, url = "http://localhost/api/businesses") =>
      new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });

    await clearCurrentIdentity();
    await expectErrorResponse(
      await createBusinessRoute(jsonRequest(JSON.stringify({ name: "No identity" }))),
      401,
      "IDENTITY_REQUIRED",
      "Sign in is required.",
    );
    await expectErrorResponse(await postJoinRequestRoute(
      jsonRequest(JSON.stringify({ requestedRole: "administrator" }), "http://localhost/api/businesses/missing/join-requests"),
      contextFor("missing"),
    ), 401, "IDENTITY_REQUIRED", "Sign in is required.");
    await expectErrorResponse(
      await getJoinRequestsRoute(new Request("http://localhost"), contextFor("missing")),
      401,
      "IDENTITY_REQUIRED",
      "Sign in is required.",
    );

    await setCurrentIdentity(identity("route-owner"));
    await expectErrorResponse(
      await createBusinessRoute(jsonRequest("{")),
      400,
      ONBOARDING_ERROR_CODES.INVALID_BUSINESS_NAME,
      "Business name is required.",
    );
    await expectErrorResponse(
      await createBusinessRoute(jsonRequest(JSON.stringify({ name: 42 }))),
      400,
      ONBOARDING_ERROR_CODES.INVALID_BUSINESS_NAME,
      "Business name is required.",
    );

    const created = await createApprovedBusiness(defaultOnboardingRepository, "Route Contract Books", identity("route-owner"));
    const duplicateMembership = await postJoinRequestRoute(
      jsonRequest(JSON.stringify({ requestedRole: "administrator" }), `http://localhost/api/businesses/${created.id}/join-requests`),
      contextFor(created.id),
    );
    await expectErrorResponse(
      duplicateMembership,
      409,
      ONBOARDING_ERROR_CODES.DUPLICATE_MEMBERSHIP,
      "You already have membership in this business.",
    );

    const emptySearch = await searchBusinessesRoute(new Request("http://localhost/api/businesses/search?q="));
    await expectErrorResponse(
      emptySearch,
      400,
      ONBOARDING_ERROR_CODES.INVALID_SEARCH_QUERY,
      "Enter a business name to search.",
    );
    await clearCurrentIdentity();
    await expectErrorResponse(
      await searchBusinessesRoute(new Request("http://localhost/api/businesses/search?q=route")),
      401,
      "IDENTITY_REQUIRED",
      "Sign in is required.",
    );
    await setCurrentIdentity(identity("route-owner"));

    const missingTarget = await postJoinRequestRoute(
      jsonRequest(JSON.stringify({ requestedRole: "administrator" }), "http://localhost/api/businesses/missing/join-requests"),
      contextFor("missing"),
    );
    await expectErrorResponse(
      missingTarget,
      400,
      ONBOARDING_ERROR_CODES.MISSING_BUSINESS,
      "Business not found.",
    );

    const inactive = defaultOnboardingRepository.businesses.get(created.id as BusinessId)!;
    inactive.isActive = false;
    const inactiveTarget = await postJoinRequestRoute(
      jsonRequest(JSON.stringify({ requestedRole: "administrator" }), `http://localhost/api/businesses/${created.id}/join-requests`),
      contextFor(created.id),
    );
    await expectErrorResponse(
      inactiveTarget,
      400,
      ONBOARDING_ERROR_CODES.INACTIVE_BUSINESS,
      "This business is not available for joining.",
    );
    inactive.isActive = true;

    const malformedJoin = await postJoinRequestRoute(
      jsonRequest("{", `http://localhost/api/businesses/${created.id}/join-requests`),
      contextFor(created.id),
    );
    await expectErrorResponse(
      malformedJoin,
      400,
      ONBOARDING_ERROR_CODES.INVALID_REQUEST_ROLE,
      "This membership role is not available.",
    );
    const invalidRole = await postJoinRequestRoute(
      jsonRequest(JSON.stringify({ requestedRole: "owner_admin" }), `http://localhost/api/businesses/${created.id}/join-requests`),
      contextFor(created.id),
    );
    await expectErrorResponse(
      invalidRole,
      400,
      ONBOARDING_ERROR_CODES.INVALID_REQUEST_ROLE,
      "This membership role is not available.",
    );

    await setCurrentIdentity(identity("route-member"));
    const pending = await postJoinRequestRoute(
      jsonRequest(JSON.stringify({ requestedRole: "administrator" }), `http://localhost/api/businesses/${created.id}/join-requests`),
      contextFor(created.id),
    );
    expect(pending.status).toBe(201);
    const pendingRequest = await pending.json() as { id: string };
    await expectErrorResponse(await postJoinRequestRoute(
      jsonRequest(JSON.stringify({ requestedRole: "administrator" }), `http://localhost/api/businesses/${created.id}/join-requests`),
      contextFor(created.id),
    ), 409, ONBOARDING_ERROR_CODES.PENDING_REQUEST_CONFLICT, "A join request is already pending.");
    const ownRequests = await getJoinRequestsRoute(
      new Request(`http://localhost/api/businesses/${created.id}/join-requests?mine=true`),
      contextFor(created.id),
    );
    expect(ownRequests.status).toBe(200);
    await expect(ownRequests.json()).resolves.toMatchObject([
      { status: "pending" },
    ]);
    expect(await (await getJoinRequestsRoute(
      new Request(`http://localhost/api/businesses/${created.id}/join-requests?mine=true`),
      contextFor(created.id),
    )).json()).toEqual([{ status: "pending" }]);

    defaultOnboardingRepository.memberships.push({
       membershipId: "membership-route-member",
      userId: user("route-member"),
      businessId: created.id as BusinessId,
      role: "administrator",
      isActive: true,
    });

    await setCurrentIdentity(identity("route-other-business-owner"));
    const otherBusiness = await createApprovedBusiness(defaultOnboardingRepository, "Other Route Books", identity("route-other-business-owner"));
    const hidden = await patchJoinRequestsRoute(
      new Request("http://localhost", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ joinRequestId: pendingRequest.id, decision: "approved" }) }),
      contextFor(otherBusiness.id),
    );
    await expectErrorResponse(
      hidden,
      404,
      ONBOARDING_ERROR_CODES.HIDDEN_REQUEST,
      "Join request not found.",
    );

    await setCurrentIdentity(identity("route-unrelated"));
    const forbidden = await getJoinRequestsRoute(new Request("http://localhost"), contextFor(created.id));
    await expectErrorResponse(
      forbidden,
      403,
      ONBOARDING_ERROR_CODES.INSUFFICIENT_CAPABILITY,
      "You do not have permission to review join requests.",
    );

    await setCurrentIdentity(identity("route-owner"));
    const invalidTransition = await patchJoinRequestsRoute(
      new Request("http://localhost", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ joinRequestId: pendingRequest.id, decision: "not-valid" }) }),
      contextFor(created.id),
    );
    await expectErrorResponse(
      invalidTransition,
      400,
      ONBOARDING_ERROR_CODES.INVALID_TRANSITION,
      "This join request cannot change state.",
    );
    const malformedPatch = await patchJoinRequestsRoute(
      new Request("http://localhost", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{" }),
      contextFor(created.id),
    );
    await expectErrorResponse(
      malformedPatch,
      400,
      ONBOARDING_ERROR_CODES.INVALID_TRANSITION,
      "This join request cannot change state.",
    );

    await setCurrentIdentity(identity("route-owner"));
    const repositoryConflict = await patchJoinRequestsRoute(
      new Request("http://localhost", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ joinRequestId: "missing-request", decision: "approved" }) }),
      contextFor(created.id),
    );
    await expectErrorResponse(
      repositoryConflict,
      404,
      ONBOARDING_ERROR_CODES.HIDDEN_REQUEST,
      "Join request not found.",
    );
  });

  it("covers successful authorized review routes and remaining PATCH status contracts", async () => {
    const identity = (id: string) => ({
      providerUserId: id,
      email: `${id}@example.com`,
      displayName: id,
      emailVerified: true,
    });
    const contextFor = (businessId: string) => ({ params: Promise.resolve({ businessId }) });
    const requestFor = (body: string, method = "POST") => new Request("http://localhost", {
      method,
      headers: { "Content-Type": "application/json" },
      body,
    });

    await setCurrentIdentity(identity("matrix-owner"));
    const created = await createApprovedBusiness(defaultOnboardingRepository, "Matrix Books", identity("matrix-owner"));

    await setCurrentIdentity(identity("matrix-member"));
    const rejectedRequest = await postJoinRequestRoute(
      requestFor(JSON.stringify({ requestedRole: "administrator" })),
      contextFor(created.id),
    );
    const rejected = await rejectedRequest.json() as { id: string };
    await setCurrentIdentity(identity("matrix-owner"));
    const authorizedList = await getJoinRequestsRoute(new Request("http://localhost"), contextFor(created.id));
    expect(authorizedList.status).toBe(200);
    expect(await authorizedList.json()).toMatchObject([{ id: rejected.id, status: "pending" }]);
    const rejectedResponse = await patchJoinRequestsRoute(
      requestFor(JSON.stringify({ joinRequestId: rejected.id, decision: "rejected" }), "PATCH"),
      contextFor(created.id),
    );
    expect(rejectedResponse.status).toBe(200);

    await setCurrentIdentity(identity("matrix-member"));
    const approvedRequest = await postJoinRequestRoute(
      requestFor(JSON.stringify({ requestedRole: "administrator" })),
      contextFor(created.id),
    );
    const approved = await approvedRequest.json() as { id: string };
    await setCurrentIdentity(identity("matrix-owner"));
    const approvedResponse = await patchJoinRequestsRoute(
      requestFor(JSON.stringify({ joinRequestId: approved.id, decision: "approved" }), "PATCH"),
      contextFor(created.id),
    );
    expect(approvedResponse.status).toBe(200);

    await clearCurrentIdentity();
    await expectErrorResponse(await patchJoinRequestsRoute(
      requestFor(JSON.stringify({ joinRequestId: approved.id, decision: "approved" }), "PATCH"),
      contextFor(created.id),
    ), 401, "IDENTITY_REQUIRED", "Sign in is required.");

    await setCurrentIdentity(identity("matrix-outsider"));
    await expectErrorResponse(await patchJoinRequestsRoute(
      requestFor(JSON.stringify({ joinRequestId: approved.id, decision: "approved" }), "PATCH"),
      contextFor(created.id),
    ), 403, ONBOARDING_ERROR_CODES.INSUFFICIENT_CAPABILITY, "You do not have permission to review join requests.");

    defaultOnboardingRepository.memberships.push({
       membershipId: "membership-duplicate-member",
      userId: user("duplicate-member"),
      businessId: created.id as BusinessId,
      role: "administrator",
      isActive: true,
    });
    defaultOnboardingRepository.joinRequests.push({
      id: "matrix-conflict-request",
      businessId: created.id as BusinessId,
      requesterId: user("duplicate-member"),
      requestedRole: "administrator",
      status: "pending",
      reviewerId: null,
      reviewedAt: null,
      createdAt: new Date().toISOString(),
    });
    await setCurrentIdentity(identity("matrix-owner"));
    await expectErrorResponse(await patchJoinRequestsRoute(
      requestFor(JSON.stringify({ joinRequestId: "matrix-conflict-request", decision: "approved" }), "PATCH"),
      contextFor(created.id),
    ), 409, ONBOARDING_ERROR_CODES.REPOSITORY_CONFLICT, "The requested change conflicts with current membership state.");
  });

  it("asserts authenticated search success shape and stable route error bodies", async () => {
    const identity = {
      providerUserId: "search-contract-owner",
      email: "search-contract-owner@example.com",
      displayName: "Search Contract Owner",
      emailVerified: true,
    };
    const requestFor = (body: string) => new Request("http://localhost/api/businesses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    await setCurrentIdentity(identity);
    const created = await createApprovedBusiness(defaultOnboardingRepository, "Safe Search Books", user("search-contract-owner"));

    const success = await searchBusinessesRoute(new Request("http://localhost/api/businesses/search?q=safe%20search"));
    expect(success.status).toBe(200);
    const summaries = await success.json() as Array<Record<string, unknown>>;
    expect(summaries).toEqual([{ id: created.id, name: created.name, isActive: true }]);
    expect(Object.keys(summaries[0]).sort()).toEqual(["id", "isActive", "name"]);

    const empty = await searchBusinessesRoute(new Request("http://localhost/api/businesses/search?q="));
    expect(empty.status).toBe(400);
    await expect(empty.json()).resolves.toEqual({
      error: { code: ONBOARDING_ERROR_CODES.INVALID_SEARCH_QUERY, message: "Enter a business name to search." },
    });

    await clearCurrentIdentity();
    const unauthorized = await searchBusinessesRoute(new Request("http://localhost/api/businesses/search?q=safe"));
    expect(unauthorized.status).toBe(401);
    await expect(unauthorized.json()).resolves.toEqual({
      error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." },
    });

    await setCurrentIdentity(identity);
    const originalCreateBusiness = defaultOnboardingRepository.createBusiness;
    defaultOnboardingRepository.createBusiness = async () => {
      throw new OnboardingError(ONBOARDING_ERROR_CODES.REPOSITORY_CONFLICT);
    };
    try {
      const conflict = await createBusinessRoute(requestFor(JSON.stringify({ name: "Conflict Books" })));
      expect(conflict.status).toBe(409);
      await expect(conflict.json()).resolves.toEqual({
        error: { code: ONBOARDING_ERROR_CODES.REPOSITORY_CONFLICT, message: "The requested change conflicts with current membership state." },
      });
    } finally {
      defaultOnboardingRepository.createBusiness = originalCreateBusiness;
    }
  });
});
