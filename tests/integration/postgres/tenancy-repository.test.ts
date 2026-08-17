import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { createTestDatabase } from "../../../src/db/test-database";
import type { AuthIdentity } from "../../../src/modules/auth/auth-provider";
import {
  createOnboardingServices,
  ONBOARDING_ERROR_CODES,
  OnboardingError,
  type Business,
} from "../../../src/modules/tenancy/business-service";
import {
  BusinessLifecycleError,
  LIFECYCLE_ERROR_CODES,
  createBusinessLifecycleService,
} from "../../../src/modules/tenancy/business-lifecycle-service";
import { createMembershipService } from "../../../src/modules/tenancy/membership-service";
import { listUserBusinesses } from "../../../src/modules/tenancy/portfolio-service";
import { createPostgresOnboardingRepository } from "../../../src/modules/tenancy/postgres-tenancy-repository";
import type { UserId } from "../../../src/modules/tenancy/types";
import { createApprovedBusiness } from "../../helpers/business-fixtures";

const identity = (providerUserId: string): AuthIdentity => ({
  providerUserId,
  email: `${providerUserId}@example.com`,
  displayName: providerUserId,
  emailVerified: true,
});

const user = (value: string) => value as UserId;
describe("PostgreSQL onboarding repository contract", () => {
  it("upserts the AuthIdentity and creates a pending request atomically", async () => {
    const { db, close } = await createTestDatabase();

    try {
      const repository = createPostgresOnboardingRepository(db);
      const onboarding = createOnboardingServices(repository);
      const owner = identity("postgres-owner");

      const created = await onboarding.createBusinessRequest({ name: "  Harbour Books  " }, owner);
      const userRows = await db.execute<{ provider_id: string; email: string; display_name: string; verification_state: string }>(
        sql`SELECT provider_id, email, display_name, verification_state FROM users`,
      );
      const memberships = await db.execute<{ user_id: string; business_id: string; role: string; is_active: boolean }>(
        sql`SELECT user_id, business_id, role, is_active FROM memberships`,
      );
      const categories = await db.execute<{ business_id: string }>(
        sql`SELECT business_id FROM categories WHERE business_id = ${created.id}`,
      );
      const audit = await db.execute<{ action: string; entity_type: string; entity_id: string }>(
        sql`SELECT action, entity_type, entity_id FROM audit_events WHERE business_id = ${created.id}`,
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
      expect(userRows.rows).toEqual([{
        provider_id: owner.providerUserId,
        email: owner.email,
        display_name: owner.displayName,
        verification_state: "verified",
      }]);
      expect(memberships.rows).toEqual([]);
      expect(categories.rows).toHaveLength(5);
      expect(audit.rows).toEqual([]);
      expect(created.createdBy).not.toBe(owner.providerUserId);
    } finally {
      await close();
    }
  }, 30_000);

  it("updates an existing user by provider_id without creating a duplicate", async () => {
    const { db, close } = await createTestDatabase();

    try {
      const repository = createPostgresOnboardingRepository(db);
      const firstId = await repository.upsertUser(identity("same-provider"));
      const secondId = await repository.upsertUser({
        ...identity("same-provider"),
        email: "updated@example.com",
        displayName: "Updated Name",
        emailVerified: false,
      });
      expect(secondId).toBe(firstId);
      expect(secondId).not.toBe("same-provider");

      const users = await db.execute<{ provider_id: string; email: string; display_name: string; verification_state: string }>(
        sql`SELECT provider_id, email, display_name, verification_state FROM users`,
      );
      expect(users.rows).toEqual([{
        provider_id: "same-provider",
        email: "updated@example.com",
        display_name: "Updated Name",
        verification_state: "unverified",
      }]);
    } finally {
      await close();
    }
  }, 30_000);

  it("supports normalized search, request, approval, rejection, and tenant isolation", async () => {
    const { db, close } = await createTestDatabase();

    try {
      const repository = createPostgresOnboardingRepository(db);
      const onboarding = createOnboardingServices(repository);
      const ownerA = identity("owner-a");
      const ownerB = identity("owner-b");
      const requester = identity("requester");
      const rejectedRequester = identity("rejected-requester");
      const first = await createApprovedBusiness(repository, "North   Star Ltd", ownerA);
      const second = await createApprovedBusiness(repository, "North Star Services", ownerB);

      await expect(onboarding.searchBusinesses(" NORTH  STAR ", requester)).resolves.toEqual([
        { id: first.id, name: "North Star Ltd", isActive: true },
        { id: second.id, name: "North Star Services", isActive: true },
      ]);

      const pending = await onboarding.requestMembership(
        { businessId: first.id, requestedRole: "administrator" },
        requester,
      );
      await expect(onboarding.requestMembership(
        { businessId: first.id, requestedRole: "administrator" },
        requester,
      )).rejects.toMatchObject({ code: ONBOARDING_ERROR_CODES.PENDING_REQUEST_CONFLICT });
      await expect(onboarding.reviewJoinRequest(
        { businessId: second.id, joinRequestId: pending.id, decision: "approved" },
        ownerB,
      )).rejects.toMatchObject({ code: ONBOARDING_ERROR_CODES.HIDDEN_REQUEST });
      await expect(onboarding.reviewJoinRequest(
        { businessId: first.id, joinRequestId: pending.id, decision: "approved" },
        ownerA,
      )).resolves.toMatchObject({ status: "approved", reviewerId: expect.any(String) });

      const rejected = await onboarding.requestMembership(
        { businessId: first.id, requestedRole: "administrator" },
        rejectedRequester,
      );
      await expect(onboarding.reviewJoinRequest(
        { businessId: first.id, joinRequestId: rejected.id, decision: "rejected" },
        ownerA,
      )).resolves.toMatchObject({ status: "rejected" });

      await expect(onboarding.listJoinRequests(second.id, ownerA)).rejects.toMatchObject({
        code: ONBOARDING_ERROR_CODES.INSUFFICIENT_CAPABILITY,
      });
      const memberships = await db.execute<{ user_id: string; business_id: string; role: string }>(
        sql`SELECT user_id, business_id, role FROM memberships ORDER BY business_id, user_id`,
      );
      expect(memberships.rows).toHaveLength(3);
      expect(memberships.rows).toEqual(expect.arrayContaining([
         { user_id: (await repository.upsertUser(ownerA)), business_id: first.id, role: "owner_admin" },
         { user_id: (await repository.upsertUser(requester)), business_id: first.id, role: "administrator" },
         { user_id: (await repository.upsertUser(ownerB)), business_id: second.id, role: "owner_admin" },
      ]));
    } finally {
      await close();
    }
  }, 30_000);

  it("uses async tenant-aware operations in membership, lifecycle, and portfolio services", async () => {
    const { db, close } = await createTestDatabase();

    try {
      const repository = createPostgresOnboardingRepository(db);
      const owner = identity("async-owner");
      const created = await createApprovedBusiness(repository, "Async Books", owner);

       await expect(listUserBusinesses(owner, { tenancyRepository: repository })).resolves.toEqual([
        { id: created.id, name: "Async Books", isActive: true, role: "owner_admin" },
      ]);
       await expect(createMembershipService(repository).listMemberships(created.id, owner))
        .resolves.toEqual([expect.objectContaining({ userId: created.createdBy, role: "owner_admin" })]);

      const originalCreator = created.createdBy;
      const replacement = identity("async-replacement");
      const replacementId = await repository.upsertUser(replacement);
       const replacementMembership = await repository.createMembership({
         membershipId: "persisted-membership-id",
         userId: replacementId,
         businessId: created.id,
         role: "administrator",
         isActive: true,
       });
       expect(replacementMembership.membershipId).toBe("persisted-membership-id");
      await createMembershipService(repository).transferOwnership({
        businessId: created.id,
        targetMembershipId: replacementMembership.membershipId!,
        confirmationName: "Async Books",
        reauthenticatedAt: new Date().toISOString(),
      }, owner);
      const transferAudit = await db.execute<{ entity_id: string }>(sql`
        SELECT entity_id FROM audit_events
        WHERE business_id = ${created.id} AND action = 'ownership_transferred'
      `);
      expect(transferAudit.rows).toEqual([{ entity_id: replacementMembership.membershipId }]);
      await expect(repository.findBusiness(created.id)).resolves.toMatchObject({ createdBy: originalCreator });

       await expect(createBusinessLifecycleService(repository).deactivateBusiness(created.id, replacement, "Async Books"))
         .rejects.toMatchObject({ code: LIFECYCLE_ERROR_CODES.PLATFORM_ADMIN_REQUIRED });
       await expect(repository.findBusiness(created.id)).resolves.toMatchObject({
         id: created.id,
         createdBy: originalCreator,
         status: "active",
         isActive: true,
       });
    } finally {
      await close();
    }
  }, 30_000);

  it("preserves domain errors thrown inside a PostgreSQL transaction", async () => {
    const { db, close } = await createTestDatabase();

    try {
      const repository = createPostgresOnboardingRepository(db);
      const error = new BusinessLifecycleError(LIFECYCLE_ERROR_CODES.INACTIVE_BUSINESS);
      await expect(repository.transaction(async () => { throw error; })).rejects.toBe(error);
    } finally {
      await close();
    }
  }, 30_000);

  it("allows exactly one concurrent PostgreSQL review winner and one audit event", async () => {
    const { db, close } = await createTestDatabase();

    try {
      const repository = createPostgresOnboardingRepository(db);
      const onboarding = createOnboardingServices(repository);
      const owner = identity("concurrent-owner");
      const requester = identity("concurrent-requester");
      const business = await createApprovedBusiness(repository, "Concurrent PostgreSQL Books", owner);
      const pending = await onboarding.requestMembership(
        { businessId: business.id, requestedRole: "administrator" },
        requester,
      );

      const results = await Promise.allSettled([
        onboarding.reviewJoinRequest({ businessId: business.id, joinRequestId: pending.id, decision: "approved" }, owner),
        onboarding.reviewJoinRequest({ businessId: business.id, joinRequestId: pending.id, decision: "approved" }, owner),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
      expect(results.find((result) => result.status === "rejected")).toMatchObject({
        reason: expect.objectContaining({ code: ONBOARDING_ERROR_CODES.REPOSITORY_CONFLICT }),
      });

      const requesterId = await repository.upsertUser(requester);
      const memberRows = await db.execute(sql`SELECT id FROM memberships WHERE user_id = ${requesterId} AND business_id = ${business.id}`);
      const auditRows = await db.execute(sql`SELECT id FROM audit_events WHERE business_id = ${business.id} AND entity_id = ${pending.id} AND action = 'join_request_approved'`);
      expect(memberRows.rows).toHaveLength(1);
      expect(auditRows.rows).toHaveLength(1);
    } finally {
      await close();
    }
  }, 30_000);

  it("rolls back business, membership, categories, and audit when a transaction fails", async () => {
    const { db, close } = await createTestDatabase();

    try {
      const repository = createPostgresOnboardingRepository(db);
      const owner = identity("rollback-owner");
      await repository.upsertUser(owner);

      await expect(repository.transaction(async (transaction) => {
        const created = await transaction.createBusiness({
          name: "Rollback Books",
          normalizedName: "rollback books",
          baseCurrencyKind: "standard",
          baseCurrencyCode: "GBP",
          baseCurrencyId: null,
          createdBy: user(owner.providerUserId),
        });
        await transaction.createMembership({
          membershipId: "rollback-membership",
          userId: user("missing-user"),
          businessId: created.id,
          role: "owner_admin",
          isActive: true,
        });
      })).rejects.toBeInstanceOf(OnboardingError);

      for (const table of ["businesses", "memberships", "categories", "audit_events"] as const) {
        const query = table === "businesses"
          ? sql`SELECT 1 FROM businesses WHERE name = ${"Rollback Books"}`
          : table === "memberships"
            ? sql`SELECT 1 FROM memberships WHERE business_id IN (SELECT id FROM businesses WHERE name = ${"Rollback Books"})`
            : table === "categories"
              ? sql`SELECT 1 FROM categories WHERE business_id IN (SELECT id FROM businesses WHERE name = ${"Rollback Books"})`
              : sql`SELECT 1 FROM audit_events WHERE business_id IN (SELECT id FROM businesses WHERE name = ${"Rollback Books"})`;
        const rows = await db.execute(query);
        expect(rows.rows).toHaveLength(0);
      }
    } finally {
      await close();
    }
  }, 30_000);
});
