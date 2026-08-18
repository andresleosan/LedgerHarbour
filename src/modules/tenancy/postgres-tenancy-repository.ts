import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, like, sql } from "drizzle-orm";

import type { Database } from "../../db/client";
import { databaseForOperation, transactionWithDatabase } from "../../db/transaction-scope";
import { defaultCategorySeeds } from "../../db/seed/default-categories";
import {
  auditEvents,
  businesses,
  categories,
  joinRequests,
  memberships,
  users,
} from "../../db/schema";
import type { AuthIdentity } from "../auth/auth-provider";
import {
  ONBOARDING_ERROR_CODES,
  OnboardingError,
  assertPendingBusinessCreationInput,
  type Business,
  type BusinessCreateInput,
  type BusinessLifecycleUpdate,
  validateBusinessStatusTransition,
  type BusinessSearchResult,
  type JoinRequest,
  type OnboardingRepository,
} from "./business-service";
import type { BusinessId, Membership, MembershipStatus, UserId } from "./types";

function id<T extends string>(value: string): T {
  return value as T;
}

function normalizedEmail(email: string): string {
  return email.trim().toLocaleLowerCase("en-US");
}

function isDomainError(error: unknown): error is Error & { code: string } {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; code?: unknown };
  return typeof candidate.name === "string" && [
    "OnboardingError",
    "MembershipAdministrationError",
    "BusinessLifecycleError",
    "CategoryError",
    "CurrencyError",
    "InvoiceError",
  ].includes(candidate.name) && typeof candidate.code === "string";
}

function driverCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { code?: unknown; cause?: unknown };
  if (typeof candidate.code === "string") return candidate.code;
  return candidate.cause ? driverCode(candidate.cause) : null;
}

function constraintName(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const candidate = error as { constraint?: unknown; detail?: unknown; cause?: unknown };
  if (typeof candidate.constraint === "string") return candidate.constraint;
  if (typeof candidate.detail === "string") return candidate.detail;
  return candidate.cause ? constraintName(candidate.cause) : "";
}

function mapDriverError(error: unknown): OnboardingError | null {
  const code = driverCode(error);
  if (!code) return null;
  const constraint = constraintName(error);
  if (code === "23505" && constraint.includes("memberships_user_business_unique")) {
    return new OnboardingError(ONBOARDING_ERROR_CODES.DUPLICATE_MEMBERSHIP);
  }
  if (code === "23505" && constraint.includes("join_requests_one_pending_per_requester_business")) {
    return new OnboardingError(ONBOARDING_ERROR_CODES.PENDING_REQUEST_CONFLICT);
  }
  if (code === "23523" || code === "23503" || code === "23505" || code === "23514") {
    return new OnboardingError(ONBOARDING_ERROR_CODES.REPOSITORY_CONFLICT);
  }
  return new OnboardingError(ONBOARDING_ERROR_CODES.REPOSITORY_CONFLICT);
}

function preserveOrMap(error: unknown): never {
  if (isDomainError(error)) throw error;
  const mapped = mapDriverError(error);
  if (mapped) throw mapped;
  throw error;
}

function mapMembership(row: typeof memberships.$inferSelect): Membership {
  return {
    membershipId: row.id,
    userId: id<UserId>(row.userId),
    businessId: id<BusinessId>(row.businessId),
    role: row.role,
    isActive: row.isActive,
    status: row.status as MembershipStatus,
  };
}

function mapJoinRequest(row: typeof joinRequests.$inferSelect): JoinRequest {
  return {
    id: row.id,
    businessId: id<BusinessId>(row.businessId),
    requesterId: id<UserId>(row.requesterId),
    requestedRole: "administrator",
    status: row.status,
    reviewerId: row.reviewedBy ? id<UserId>(row.reviewedBy) : null,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function mapBusiness(row: typeof businesses.$inferSelect, createdBy: UserId): Business {
  if (row.baseCurrencyKind !== "standard" || row.baseCurrencyCode !== "GBP" || row.baseCurrencyId !== null) {
    throw new OnboardingError(ONBOARDING_ERROR_CODES.REPOSITORY_CONFLICT);
  }
  return {
    id: id<BusinessId>(row.id),
    name: row.name,
    normalizedName: row.normalizedSearchName,
    status: row.status as Business["status"],
    isActive: row.status === "active" && row.isActive,
    activatedAt: row.activatedAt?.toISOString() ?? null,
    serviceExpiresAt: row.serviceExpiresAt?.toISOString() ?? null,
    suspendedAt: row.suspendedAt?.toISOString() ?? null,
    suspensionReason: row.suspensionReason,
    baseCurrencyKind: "standard",
    baseCurrencyCode: "GBP",
    baseCurrencyId: null,
    createdBy,
  };
}

function entityType(type: string): string {
  if (type.startsWith("business_")) return "business";
  if (type.startsWith("join_request_")) return "join_request";
  if (type.startsWith("membership_")) return "membership";
  if (type.startsWith("category_")) return "category";
  if (type.startsWith("invoice_")) return "invoice";
  return type;
}

function createRepository(db: Database, transactionCount: { value: number }): OnboardingRepository {
  const repository: OnboardingRepository = {
    get transactionCount() {
      return transactionCount.value;
    },

    async transaction<T>(operation: (repository: OnboardingRepository) => Promise<T>): Promise<T> {
      transactionCount.value += 1;
      try {
        return await transactionWithDatabase(db, () => operation(createRepository(databaseForOperation(db), transactionCount)));
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async upsertUser(identity: AuthIdentity): Promise<UserId> {
      try {
        const [row] = await db.insert(users).values({
          id: randomUUID(),
          providerId: identity.providerUserId,
          email: identity.email.trim(),
          normalizedEmail: normalizedEmail(identity.email),
          displayName: identity.displayName.trim(),
          verificationState: identity.emailVerified ? "verified" : "unverified",
        }).onConflictDoUpdate({
          target: users.providerId,
          set: {
            email: identity.email.trim(),
            normalizedEmail: normalizedEmail(identity.email),
            displayName: identity.displayName.trim(),
            verificationState: identity.emailVerified ? "verified" : "unverified",
            updatedAt: new Date(),
          },
        }).returning({ id: users.id });
        if (!row) throw new OnboardingError(ONBOARDING_ERROR_CODES.REPOSITORY_CONFLICT);
        return id<UserId>(row.id);
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async findMembership(userId, businessId) {
      try {
        const [row] = await db.select().from(memberships).where(and(
          eq(memberships.userId, userId),
          eq(memberships.businessId, businessId),
        )).limit(1);
        return row ? mapMembership(row) : null;
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async lockMembership(userId, businessId) {
      try {
        await db.execute(sql`SELECT id FROM memberships WHERE user_id = ${userId} AND business_id = ${businessId} FOR UPDATE`);
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async lockBusiness(businessId) {
      try {
        await db.execute(sql`SELECT id FROM businesses WHERE id = ${businessId} FOR UPDATE`);
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async findUserById(userId) {
      try {
        const [row] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
        return row ?? null;
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async findBusinessStatus(businessId) {
      const business = await repository.findBusiness(businessId);
      if (!business) return null;
      return business.status === "active" && business.isActive ? "active" : business.status === "active" ? "suspended" : business.status;
    },

    async createBusiness(input: BusinessCreateInput) {
      try {
        assertPendingBusinessCreationInput(input);
        const [row] = await db.insert(businesses).values({
          name: input.name,
          normalizedSearchName: input.normalizedName,
          baseCurrencyKind: input.baseCurrencyKind,
          baseCurrencyCode: input.baseCurrencyCode,
          baseCurrencyId: input.baseCurrencyId,
          createdBy: input.createdBy,
          status: "pending",
          isActive: false,
          activatedAt: null,
          serviceExpiresAt: null,
          suspendedAt: null,
          suspensionReason: null,
        }).returning();
        if (!row) throw new OnboardingError(ONBOARDING_ERROR_CODES.REPOSITORY_CONFLICT);
        return mapBusiness(row, input.createdBy);
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async provisionDefaultCategories(businessId) {
      try {
        await db.insert(categories).values(defaultCategorySeeds.map((seed) => ({
          businessId,
          name: seed.name,
          isActive: true,
        })));
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async createMembership(membership) {
      try {
        const [row] = await db.insert(memberships).values({
          id: membership.membershipId,
          userId: membership.userId,
          businessId: membership.businessId,
        role: membership.role,
        isActive: membership.isActive,
        status: membership.status,
        }).returning();
        if (!row) throw new OnboardingError(ONBOARDING_ERROR_CODES.REPOSITORY_CONFLICT);
        return mapMembership(row);
      } catch (error) {
        return preserveOrMap(error);
      }
    },

      async updateMembership(membership, expected) {
      try {
        const [row] = await db.update(memberships).set({
          role: membership.role,
          isActive: membership.isActive,
          status: membership.status,
          updatedAt: new Date(),
        }).where(and(
          eq(memberships.id, membership.membershipId),
          ...(expected ? [eq(memberships.isActive, expected.isActive), eq(memberships.role, expected.role), ...(expected.status ? [eq(memberships.status, expected.status)] : [])] : []),
        )).returning();
        if (!row) throw new OnboardingError(ONBOARDING_ERROR_CODES.REPOSITORY_CONFLICT);
        return mapMembership(row);
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async deleteMembership(membershipId, expected) {
      try {
        const rows = await db.delete(memberships).where(and(
          eq(memberships.id, membershipId),
          ...(expected ? [eq(memberships.isActive, expected.isActive), eq(memberships.role, expected.role), ...(expected.status ? [eq(memberships.status, expected.status)] : [])] : []),
        )).returning({ id: memberships.id });
        if (rows.length === 0) throw new OnboardingError(ONBOARDING_ERROR_CODES.REPOSITORY_CONFLICT);
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async listMemberships(businessId) {
      try {
        const rows = await db.select().from(memberships).where(eq(memberships.businessId, businessId));
        return rows.map(mapMembership);
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async listBusinessesForUser(userId) {
      try {
        const rows = await db.select({ business: businesses, membership: memberships }).from(memberships)
          .innerJoin(businesses, eq(memberships.businessId, businesses.id))
          .where(and(eq(memberships.userId, userId), eq(memberships.status, "active"), eq(memberships.isActive, true)));
        const result: Array<{ business: Business; membership: Membership }> = [];
        for (const row of rows) {
          const creator = row.business.createdBy ?? (await db.select({ actorId: auditEvents.actorId }).from(auditEvents).where(and(
            eq(auditEvents.businessId, row.business.id),
             eq(auditEvents.action, "business_requested"),
            eq(auditEvents.entityId, row.business.id),
          )).limit(1))[0]?.actorId;
          if (!creator) throw new OnboardingError(ONBOARDING_ERROR_CODES.REPOSITORY_CONFLICT);
          result.push({ business: mapBusiness(row.business, id<UserId>(creator)), membership: mapMembership(row.membership) });
        }
        return result;
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async appendAuditEvent(input) {
      try {
        const [row] = await db.insert(auditEvents).values({
          businessId: input.businessId,
          actorType: "user",
          actorId: input.actorId,
          action: input.type,
          entityType: entityType(input.type),
          entityId: input.entityId,
        }).returning();
        if (!row) throw new OnboardingError(ONBOARDING_ERROR_CODES.REPOSITORY_CONFLICT);
        return {
          id: row.id,
          businessId: id<BusinessId>(row.businessId),
          actorId: id<UserId>(row.actorId ?? ""),
          type: row.action,
          entityId: row.entityId,
          createdAt: row.createdAt.toISOString(),
        };
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async listAuditEvents(businessId) {
      try {
        const rows = await db.select().from(auditEvents).where(eq(auditEvents.businessId, businessId)).orderBy(asc(auditEvents.createdAt));
        return rows.map((row) => ({ id: row.id, businessId: id<BusinessId>(row.businessId), actorId: id<UserId>(row.actorId ?? ""), type: row.action, entityId: row.entityId, createdAt: row.createdAt.toISOString() }));
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async findBusiness(businessId) {
      try {
        const [row] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
        if (!row) return null;
        const creator = row.createdBy ?? (await db.select({ actorId: auditEvents.actorId }).from(auditEvents).where(and(
          eq(auditEvents.businessId, businessId),
           eq(auditEvents.action, "business_requested"),
          eq(auditEvents.entityId, businessId),
        )).limit(1))[0]?.actorId;
        if (!creator) throw new OnboardingError(ONBOARDING_ERROR_CODES.REPOSITORY_CONFLICT);
        return mapBusiness(row, id<UserId>(creator));
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async updateBusinessStatus(businessId, isActive) {
      return repository.updateBusinessLifecycle(businessId, {
        status: isActive ? "active" : "suspended",
        suspendedAt: isActive ? null : new Date().toISOString(),
        suspensionReason: isActive ? null : "Business deactivated",
      });
    },

    async updateBusinessLifecycle(businessId, input: BusinessLifecycleUpdate, expectedStatus) {
      try {
        const current = await repository.findBusiness(businessId);
        if (!current) throw new OnboardingError(ONBOARDING_ERROR_CODES.MISSING_BUSINESS);
        validateBusinessStatusTransition(current.status, input.status);
        if (input.status === "active") {
          const [owner] = await db.select({ id: memberships.id }).from(memberships).where(and(
            eq(memberships.businessId, businessId),
            eq(memberships.role, "owner_admin"),
            eq(memberships.status, "active"),
            eq(memberships.isActive, true),
          )).limit(1);
          if (!owner) throw new OnboardingError(ONBOARDING_ERROR_CODES.REPOSITORY_CONFLICT);
        }
        const [row] = await db.update(businesses).set({
          status: input.status,
          isActive: input.status === "active",
          activatedAt: input.activatedAt === undefined ? undefined : input.activatedAt ? new Date(input.activatedAt) : null,
          serviceExpiresAt: input.serviceExpiresAt === undefined ? undefined : input.serviceExpiresAt ? new Date(input.serviceExpiresAt) : null,
          suspendedAt: input.suspendedAt === undefined ? undefined : input.suspendedAt ? new Date(input.suspendedAt) : null,
          suspensionReason: input.suspensionReason,
          updatedAt: new Date(),
        }).where(and(
          eq(businesses.id, businessId),
          ...(expectedStatus ? [eq(businesses.status, expectedStatus)] : []),
        )).returning();
        if (!row) throw new OnboardingError(ONBOARDING_ERROR_CODES.MISSING_BUSINESS);
        if (!row.createdBy) throw new OnboardingError(ONBOARDING_ERROR_CODES.REPOSITORY_CONFLICT);
        return mapBusiness(row, id<UserId>(row.createdBy));
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async listBusinesses() {
      try {
        const rows = await db.select().from(businesses).orderBy(asc(businesses.createdAt), asc(businesses.id));
        return rows.flatMap((row) => row.createdBy ? [mapBusiness(row, id<UserId>(row.createdBy))] : []);
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async searchBusinesses(normalizedQuery): Promise<BusinessSearchResult[]> {
      try {
        const rows = await db.select({ id: businesses.id, name: businesses.name, status: businesses.status }).from(businesses).where(and(
          eq(businesses.status, "active"),
          like(businesses.normalizedSearchName, `%${normalizedQuery}%`),
        )).orderBy(asc(businesses.name));
        return rows.map((row) => ({ id: id<BusinessId>(row.id), name: row.name, isActive: true as const }));
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async listCategories(businessId) {
      try {
        const rows = await db.select().from(categories).where(eq(categories.businessId, businessId));
        return rows.map((row) => ({ id: row.id, businessId: id<BusinessId>(row.businessId), name: row.name, isActive: row.isActive }));
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async findCategory(businessId, categoryId) {
      const rows = await repository.listCategories(businessId);
      return rows.find((category) => category.id === categoryId) ?? null;
    },

    async findCategoryByName(businessId, normalizedName, ignoredId) {
      const rows = await repository.listCategories(businessId);
      return rows.find((category) => category.id !== ignoredId && category.name.trim().toLocaleLowerCase("en-US") === normalizedName) ?? null;
    },

    async createCategory(category) {
      try {
        const [row] = await db.insert(categories).values({ id: category.id, businessId: category.businessId, name: category.name, isActive: category.isActive }).returning();
        if (!row) throw new OnboardingError(ONBOARDING_ERROR_CODES.REPOSITORY_CONFLICT);
        return { id: row.id, businessId: id<BusinessId>(row.businessId), name: row.name, isActive: row.isActive };
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async updateCategory(category) {
      try {
        const [row] = await db.update(categories).set({ name: category.name, isActive: category.isActive, updatedAt: new Date() }).where(and(eq(categories.id, category.id), eq(categories.businessId, category.businessId))).returning();
        if (!row) throw new OnboardingError(ONBOARDING_ERROR_CODES.REPOSITORY_CONFLICT);
        return { id: row.id, businessId: id<BusinessId>(row.businessId), name: row.name, isActive: row.isActive };
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async createJoinRequest(input) {
      try {
        const [row] = await db.insert(joinRequests).values({ requesterId: input.requesterId, businessId: input.businessId, requestedRole: input.requestedRole, status: input.status }).returning();
        if (!row) throw new OnboardingError(ONBOARDING_ERROR_CODES.REPOSITORY_CONFLICT);
        return mapJoinRequest(row);
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async findJoinRequest(joinRequestId) {
      try {
        const [row] = await db.select().from(joinRequests).where(eq(joinRequests.id, joinRequestId)).limit(1);
        return row ? mapJoinRequest(row) : null;
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async listJoinRequests(businessId) {
      try {
        const rows = await db.select().from(joinRequests).where(and(eq(joinRequests.businessId, businessId), eq(joinRequests.status, "pending"))).orderBy(desc(joinRequests.createdAt), desc(joinRequests.id));
        return rows.map(mapJoinRequest);
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async listUserJoinRequests(businessId, requesterId) {
      try {
        const rows = await db.select().from(joinRequests).where(and(eq(joinRequests.businessId, businessId), eq(joinRequests.requesterId, requesterId))).orderBy(asc(joinRequests.createdAt), asc(joinRequests.id));
        return rows.map(mapJoinRequest);
      } catch (error) {
        return preserveOrMap(error);
      }
    },

    async updateJoinRequest(input) {
      try {
        const [row] = await db.update(joinRequests).set({ status: input.status, reviewedBy: input.reviewerId, reviewedAt: input.reviewedAt ? new Date(input.reviewedAt) : null, updatedAt: new Date() }).where(and(
          eq(joinRequests.id, input.id),
          eq(joinRequests.businessId, input.businessId),
          eq(joinRequests.status, "pending"),
        )).returning();
        if (!row) throw new OnboardingError(ONBOARDING_ERROR_CODES.REPOSITORY_CONFLICT);
        return mapJoinRequest(row);
      } catch (error) {
        return preserveOrMap(error);
      }
    },
  };

  return repository;
}

export function createPostgresOnboardingRepository(db: Database): OnboardingRepository {
  return createRepository(db, { value: 0 });
}
