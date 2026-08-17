import { describe, expect, it } from "vitest";

import {
  AUTHORIZATION_ERROR_CODES,
  InfrastructureAuthorizationError,
  AuthorizationError,
} from "../../../src/modules/permissions/authorize";
import {
  configureTenantRepository,
  createTenantContext,
  getMembership,
  requireBusinessAccess,
  TenantRepositoryConfigurationError,
  type TenantRepository,
} from "../../../src/modules/tenancy/tenant-context";
import type {
  BusinessId,
  Membership,
  UserId,
} from "../../../src/modules/tenancy/types";

const id = <T extends string>(value: string) => value as T;

const businessA = id<BusinessId>("business-a");
const businessB = id<BusinessId>("business-b");
const userA = id<UserId>("user-a");
const userB = id<UserId>("user-b");
const userC = id<UserId>("user-c");

const repositoryFor = (
  candidate: Membership | null,
  status: "active" | "inactive" | null = "active",
): TenantRepository => ({
  findMembership: async () => candidate,
  findBusinessStatus: async () => status,
});

const membership = (userId: UserId, businessId: BusinessId, role: Membership["role"], isActive = true): Membership => ({
  membershipId: `membership-${userId}-${businessId}`,
  userId,
  businessId,
  role,
  isActive,
  status: isActive ? "active" : "pending",
});

class MemoryTenantRepository implements TenantRepository {
  readonly memberships = [
    membership(userA, businessA, "owner_admin"),
    membership(userB, businessB, "general_admin"),
    membership(userC, businessA, "administrator"),
  ];

  readonly businesses = new Map<BusinessId, "active" | "inactive">([
    [businessA, "active"],
    [businessB, "active"],
  ]);

  findMembership(userId: UserId, businessId: BusinessId): Promise<Membership | null> {
    return Promise.resolve(
      this.memberships.find(
        (candidate) => candidate.userId === userId && candidate.businessId === businessId,
      ) ?? null,
    );
  }

  findBusinessStatus(businessId: BusinessId): Promise<"active" | "inactive" | null> {
    return Promise.resolve(this.businesses.get(businessId) ?? null);
  }
}

describe("tenant isolation boundary", () => {
  it("prevents a business A user from obtaining business B membership by changing the ID", async () => {
    const context = createTenantContext(new MemoryTenantRepository());

    await expect(context.getMembership(userA, businessB)).resolves.toBeNull();
    await expect(context.requireBusinessAccess(userA, businessB)).rejects.toMatchObject({
      code: AUTHORIZATION_ERROR_CODES.BUSINESS_ACCESS_DENIED,
      message: "Business access denied",
    });
  });

  it("returns only the membership belonging to the requested user and business", async () => {
    const context = createTenantContext(new MemoryTenantRepository());

    await expect(context.requireBusinessAccess(userA, businessA)).resolves.toEqual(
      membership(userA, businessA, "owner_admin"),
    );
    await expect(context.requireBusinessAccess(userB, businessA)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it("rejects inactive memberships and inactive or missing businesses", async () => {
    const repository = new MemoryTenantRepository();
    repository.memberships[0].isActive = false;
    repository.businesses.set(businessB, "inactive");
    const context = createTenantContext(repository);

    await expect(context.requireBusinessAccess(userA, businessA)).rejects.toMatchObject({
      code: AUTHORIZATION_ERROR_CODES.BUSINESS_ACCESS_DENIED,
    });
    await expect(context.requireBusinessAccess(userB, businessB)).rejects.toMatchObject({
      code: AUTHORIZATION_ERROR_CODES.BUSINESS_ACCESS_DENIED,
    });
    await expect(context.requireBusinessAccess(userA, id<BusinessId>("business-missing"))).rejects.toMatchObject({
      code: AUTHORIZATION_ERROR_CODES.BUSINESS_ACCESS_DENIED,
    });
  });

  it.each(["", "   ", "\t\n"])
  ("rejects a user ID containing only %j without querying the repository", async (invalidUserId) => {
    let membershipLookups = 0;
    let businessLookups = 0;
    const repository: TenantRepository = {
      findMembership: async () => {
        membershipLookups += 1;
        return membership(userA, businessA, "owner_admin");
      },
      findBusinessStatus: async () => {
        businessLookups += 1;
        return "active";
      },
    };
    const context = createTenantContext(repository);

    await expect(context.getMembership(id<UserId>(invalidUserId), businessA)).resolves.toBeNull();
    await expect(context.requireBusinessAccess(id<UserId>(invalidUserId), businessA)).rejects.toMatchObject({
      code: AUTHORIZATION_ERROR_CODES.BUSINESS_ACCESS_DENIED,
      message: "Business access denied",
    });
    expect(membershipLookups).toBe(0);
    expect(businessLookups).toBe(0);
  });

  it.each(["", "   ", "\t\n"])
  ("rejects a business ID containing only %j without querying the repository", async (invalidBusinessId) => {
    let membershipLookups = 0;
    let businessLookups = 0;
    const repository: TenantRepository = {
      findMembership: async () => {
        membershipLookups += 1;
        return membership(userA, businessA, "owner_admin");
      },
      findBusinessStatus: async () => {
        businessLookups += 1;
        return "active";
      },
    };
    const context = createTenantContext(repository);

    await expect(context.getMembership(userA, id<BusinessId>(invalidBusinessId))).resolves.toBeNull();
    await expect(context.requireBusinessAccess(userA, id<BusinessId>(invalidBusinessId))).rejects.toMatchObject({
      code: AUTHORIZATION_ERROR_CODES.BUSINESS_ACCESS_DENIED,
      message: "Business access denied",
    });
    expect(membershipLookups).toBe(0);
    expect(businessLookups).toBe(0);
  });

  it.each([
    {
      description: "another user's membership",
      candidate: membership(userB, businessA, "general_admin"),
    },
    {
      description: "another business's membership",
      candidate: membership(userA, businessB, "owner_admin"),
    },
    {
      description: "a malformed role",
      candidate: { ...membership(userA, businessA, "owner_admin"), role: "owner" as Membership["role"] },
    },
    {
      description: "a malformed active flag",
      candidate: { ...membership(userA, businessA, "owner_admin"), isActive: "true" as unknown as boolean },
    },
    {
      description: "an inconsistent lifecycle status",
      candidate: { ...membership(userA, businessA, "owner_admin"), status: "suspended" as const, isActive: true },
    },
  ])("fails closed for $description returned by a defective repository", async ({ candidate }) => {
    const context = createTenantContext(repositoryFor(candidate));

    await expect(context.getMembership(userA, businessA)).resolves.toBeNull();
    await expect(context.requireBusinessAccess(userA, businessA)).rejects.toMatchObject({
      code: AUTHORIZATION_ERROR_CODES.BUSINESS_ACCESS_DENIED,
      message: "Business access denied",
    });
  });

  it("fails closed when the repository returns undefined for membership", async () => {
    const context = createTenantContext({
      findMembership: async () => undefined as unknown as Membership,
      findBusinessStatus: async () => "active",
    });

    await expect(context.getMembership(userA, businessA)).resolves.toBeNull();
    await expect(context.requireBusinessAccess(userA, businessA)).rejects.toMatchObject({
      code: AUTHORIZATION_ERROR_CODES.BUSINESS_ACCESS_DENIED,
      message: "Business access denied",
    });
  });

  it.each(["membership", "business status"])(
    "normalizes a %s repository failure at the authorization boundary",
    async (failurePoint) => {
      const cause = new Error("postgres host, password, and private query details");
      const repository: TenantRepository = {
        findMembership: async () => {
          if (failurePoint === "membership") {
            throw cause;
          }
          return membership(userA, businessA, "owner_admin");
        },
        findBusinessStatus: async () => {
          if (failurePoint === "business status") {
            throw cause;
          }
          return "active";
        },
      };
      const context = createTenantContext(repository);

      if (failurePoint === "membership") {
        await expect(context.getMembership(userA, businessA)).rejects.toMatchObject({
          code: AUTHORIZATION_ERROR_CODES.INFRASTRUCTURE_FAILURE,
          message: "Business access temporarily unavailable",
        });
      } else {
        await expect(context.getMembership(userA, businessA)).resolves.toEqual(
          membership(userA, businessA, "owner_admin"),
        );
      }
      await expect(context.requireBusinessAccess(userA, businessA)).rejects.toMatchObject({
        code: AUTHORIZATION_ERROR_CODES.INFRASTRUCTURE_FAILURE,
        message: "Business access temporarily unavailable",
      });
      await expect(context.requireBusinessAccess(userA, businessA)).rejects.toBeInstanceOf(
        InfrastructureAuthorizationError,
      );
    },
  );

  it("configures the top-level repository once and rejects a silent adapter switch", async () => {
    const firstRepository = repositoryFor(membership(userA, businessA, "owner_admin"));
    const secondRepository = repositoryFor(membership(userB, businessA, "general_admin"));

    configureTenantRepository(firstRepository);

    expect(() => configureTenantRepository(secondRepository)).toThrowError(
      expect.objectContaining({
        code: "TENANT_REPOSITORY_ALREADY_CONFIGURED",
      }),
    );
    expect(() => configureTenantRepository(secondRepository)).toThrowError(
      TenantRepositoryConfigurationError,
    );
    await expect(getMembership(userA, businessA)).resolves.toEqual(
      membership(userA, businessA, "owner_admin"),
    );
    await expect(requireBusinessAccess(userA, businessA)).resolves.toEqual(
      membership(userA, businessA, "owner_admin"),
    );
  });
});
