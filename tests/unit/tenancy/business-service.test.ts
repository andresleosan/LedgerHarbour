import { describe, expect, it, vi } from "vitest";

import {
  createBusiness,
  createInMemoryOnboardingRepository,
  createOnboardingServices,
  ONBOARDING_ERROR_CODES,
  type Business,
} from "../../../src/modules/tenancy/business-service";
import type { BusinessId, UserId } from "../../../src/modules/tenancy/types";
import { createApprovedBusiness } from "../../helpers/business-fixtures";

const user = (value: string) => value as UserId;
const business = (value: string) => value as BusinessId;

describe("business onboarding service", () => {
  it("creates a pending GBP business request without operational membership", async () => {
    const repository = createInMemoryOnboardingRepository();

    const created = await createBusiness(
      { name: "  Harbour Books  " },
      user("owner-1"),
      repository,
    );

    expect(created).toMatchObject<Partial<Business>>({
      name: "Harbour Books",
      normalizedName: "harbour books",
      status: "pending",
      isActive: false,
      baseCurrencyKind: "standard",
      baseCurrencyCode: "GBP",
      baseCurrencyId: null,
    });
    expect(repository.memberships).toHaveLength(0);
    expect(repository.categories.filter((category) => category.businessId === created.id)).toHaveLength(5);
    expect(repository.auditEvents).toEqual([expect.objectContaining({
      actorId: created.createdBy,
      type: "business_requested",
      entityId: created.id,
    })]);
    expect(repository.transactionCount).toBe(1);
  });

  it("keeps memory provider IDs stable across AuthIdentity upserts", async () => {
    const repository = createInMemoryOnboardingRepository();
    const first = await repository.upsertUser({
      providerUserId: "provider-user",
      email: "first@example.com",
      displayName: "First",
      emailVerified: true,
    });
    const second = await repository.upsertUser({
      providerUserId: "provider-user",
      email: "updated@example.com",
      displayName: "Updated",
      emailVerified: false,
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^user-/);
    expect(first).not.toBe("provider-user");
  });

  it("rejects a second provider for an occupied normalized email", async () => {
    const repository = createInMemoryOnboardingRepository();
    await repository.upsertUser({
      provider: "firebase",
      providerUserId: "provider-first",
      email: "Owner@Example.com",
      displayName: "First",
      emailVerified: true,
    });

    await expect(repository.upsertUser({
      provider: "firebase",
      providerUserId: "provider-second",
      email: " owner@example.com ",
      displayName: "Second",
      emailVerified: true,
    })).rejects.toMatchObject({ code: ONBOARDING_ERROR_CODES.REPOSITORY_CONFLICT });
  });

  it("resolves an AuthIdentity to the repository local user id exactly at the boundary", async () => {
    const repository = createInMemoryOnboardingRepository();
    const identity = {
      providerUserId: "provider-user",
      email: "local@example.com",
      displayName: "Local User",
      emailVerified: true,
    };
    const localId = await repository.upsertUser(identity);

    expect(localId).toMatch(/^user-/);
    expect(localId).not.toBe(identity.providerUserId);
    expect(localId).not.toBe(identity.email);
  });

  it("rejects an empty business name at the service boundary", async () => {
    const repository = createInMemoryOnboardingRepository();

    await expect(createBusiness({ name: " \t " }, user("owner-1"), repository)).rejects.toMatchObject({
      code: ONBOARDING_ERROR_CODES.INVALID_BUSINESS_NAME,
    });
  });

  it("allows duplicate visible names while indexing their normalized form", async () => {
    const repository = createInMemoryOnboardingRepository();

    const first = await createBusiness({ name: "Same Name" }, user("owner-1"), repository);
    const second = await createBusiness({ name: " same   name " }, user("owner-2"), repository);

    expect(first.id).not.toBe(second.id);
    expect(first.normalizedName).toBe("same name");
    expect(second.normalizedName).toBe("same name");
  });

  it("searches active businesses by normalized name and returns safe summaries only", async () => {
    const repository = createInMemoryOnboardingRepository();
    const services = createOnboardingServices(repository);

    const active = await createApprovedBusiness(repository, "North Star Ltd", user("owner-1"));
    await createApprovedBusiness(repository, "North Star Services", user("owner-2"));
    const inactive = await createApprovedBusiness(repository, "North Star Closed", user("owner-3"));
    repository.businesses.get(inactive.id)!.isActive = false;

    await expect(services.searchBusinesses("  NORTH   STAR ", user("searcher"))).resolves.toEqual([
      { id: active.id, name: "North Star Ltd", isActive: true },
      { id: expect.any(String), name: "North Star Services", isActive: true },
    ]);
    await expect(services.searchBusinesses("   ", user("searcher"))).rejects.toMatchObject({
      code: ONBOARDING_ERROR_CODES.INVALID_SEARCH_QUERY,
    });
  });

  it("does not expose inactive businesses in search", async () => {
    const repository = createInMemoryOnboardingRepository();
    const services = createOnboardingServices(repository);
    const inactive = await createApprovedBusiness(repository, "Closed Books", user("owner-1"));
    repository.businesses.get(inactive.id)!.isActive = false;

    await expect(services.searchBusinesses("closed", user("searcher"))).resolves.toEqual([]);
  });

  it("uses the shared Task 3 tenant and permission boundary for review authorization", async () => {
    const repository = createInMemoryOnboardingRepository();
    const services = createOnboardingServices(repository);
    const created = await createApprovedBusiness(repository, "Reviewable", user("owner-1"));
    const request = await services.requestMembership(
      { businessId: created.id, requestedRole: "administrator" },
      user("requester"),
    );

    await expect(
      services.reviewJoinRequest(
        { businessId: created.id, joinRequestId: request.id, decision: "approved" },
        user("requester"),
      ),
    ).rejects.toMatchObject({ code: ONBOARDING_ERROR_CODES.INSUFFICIENT_CAPABILITY });

    await expect(
      services.reviewJoinRequest(
        { businessId: created.id, joinRequestId: request.id, decision: "approved" },
        user("owner-1"),
      ),
    ).resolves.toMatchObject({ status: "approved", reviewerId: user("owner-1") });
    expect(repository.memberships).toContainEqual(expect.objectContaining({
      userId: user("requester"),
      businessId: created.id,
      role: "administrator",
      isActive: true,
    }));
    expect(repository.memberships.find((membership) => membership.userId === user("requester"))?.membershipId).toEqual(expect.any(String));
  });

  it("denies cross-business review even when the reviewer knows the request ID", async () => {
    const repository = createInMemoryOnboardingRepository();
    const services = createOnboardingServices(repository);
    const first = await createApprovedBusiness(repository, "First", user("owner-1"));
    const second = await createApprovedBusiness(repository, "Second", user("owner-2"));
    const request = await services.requestMembership(
      { businessId: first.id, requestedRole: "administrator" },
      user("requester"),
    );

    await expect(
      services.reviewJoinRequest(
        { businessId: second.id, joinRequestId: request.id, decision: "approved" },
        user("owner-2"),
      ),
    ).rejects.toMatchObject({ code: ONBOARDING_ERROR_CODES.HIDDEN_REQUEST });
  });

  it("keeps the public createBusiness signature available", async () => {
    const repository = createInMemoryOnboardingRepository();
    const created = await createBusiness({ name: "Public API" }, user("owner"), repository);

    expect(created.id).toEqual(expect.any(String));
    expect(repository.businesses.has(business(created.id))).toBe(true);
  });

  it("reuses the default repository across separate module bundle evaluations", async () => {
    vi.resetModules();
    const firstBundle = await import("../../../src/modules/tenancy/business-service");
    vi.resetModules();
    const secondBundle = await import("../../../src/modules/tenancy/business-service");

    expect(secondBundle.defaultOnboardingRepository).toBe(firstBundle.defaultOnboardingRepository);
  });
});
