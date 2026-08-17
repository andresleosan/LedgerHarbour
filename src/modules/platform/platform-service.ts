import { randomUUID } from "node:crypto";
import type { AuthIdentity } from "../auth/auth-provider";
import { can } from "../permissions/authorize";

import {
  defaultOnboardingRepository,
  OnboardingError,
  resolveOnboardingActor,
  type Business,
  type BusinessLifecycleUpdate,
  type OnboardingActor,
  type OnboardingRepository,
} from "../tenancy/business-service";
import type { BusinessId, BusinessStatus, MembershipStatus, UserId } from "../tenancy/types";
import {
  createInMemoryPlatformRepository,
  type InMemoryPlatformRepository,
  type PlatformMember,
  type PlatformRepository,
} from "./platform-repository";
export { createInMemoryPlatformRepository, createPostgresPlatformRepository } from "./platform-repository";
export type { InMemoryPlatformRepository, PlatformMember, PlatformRepository } from "./platform-repository";

export const PLATFORM_ERROR_CODES = {
  PLATFORM_ACCESS_DENIED: "PLATFORM_ACCESS_DENIED",
  BUSINESS_NOT_FOUND: "BUSINESS_NOT_FOUND",
  INVALID_TRANSITION: "INVALID_BUSINESS_TRANSITION",
  REASON_REQUIRED: "PLATFORM_REASON_REQUIRED",
  INVALID_DATE: "INVALID_SERVICE_DATE",
  REPOSITORY_CONFLICT: "PLATFORM_REPOSITORY_CONFLICT",
  ADMINISTRATOR_NOT_FOUND: "ADMINISTRATOR_NOT_FOUND",
} as const;

export type PlatformErrorCode = (typeof PLATFORM_ERROR_CODES)[keyof typeof PLATFORM_ERROR_CODES];

const messages: Record<PlatformErrorCode, string> = {
  PLATFORM_ACCESS_DENIED: "Platform administration access denied.",
  BUSINESS_NOT_FOUND: "Business not found.",
  INVALID_BUSINESS_TRANSITION: "This business state transition is not available.",
  PLATFORM_REASON_REQUIRED: "A reason is required for this action.",
  INVALID_SERVICE_DATE: "The service expiration date is invalid.",
  PLATFORM_REPOSITORY_CONFLICT: "The business state changed elsewhere.",
  ADMINISTRATOR_NOT_FOUND: "Administrator not found.",
};

export class PlatformError extends Error {
  readonly name = "PlatformError";

  constructor(readonly code: PlatformErrorCode) {
    super(messages[code]);
  }
}

export interface PlatformBusinessDto {
  id: BusinessId;
  name: string;
  status: BusinessStatus;
  requesterId: UserId;
  activatedAt: string | null;
  serviceExpiresAt: string | null;
  suspendedAt: string | null;
  suspensionReason: string | null;
}

export interface ApproveBusinessInput {
  serviceExpiresAt: string;
}

export interface ReasonInput {
  reason?: string;
}

export interface PlatformAdministratorDto {
  membershipId: string;
  businessId: BusinessId;
  userId: UserId;
  email: string | null;
  role: "general_admin" | "administrator";
  isActive: boolean;
  status: MembershipStatus;
  businessStatus: BusinessStatus;
}

export interface AdministratorActionInput {
  action: "suspend" | "revoke";
  reason: string;
}

function requireReason(reason: string | undefined): string {
  if (typeof reason !== "string" || !reason.trim()) throw new PlatformError(PLATFORM_ERROR_CODES.REASON_REQUIRED);
  return reason.trim();
}

function serviceExpirationDate(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new PlatformError(PLATFORM_ERROR_CODES.INVALID_DATE);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) throw new PlatformError(PLATFORM_ERROR_CODES.INVALID_DATE);
  return parsed.toISOString();
}

async function claimPlatformMemberForActor(
  actor: AuthIdentity,
  tenancy: OnboardingRepository,
  platform: PlatformRepository,
): Promise<PlatformMember> {
  if (process.env.LEDGERHARBOUR_TEST_MODE === "true" || actor.provider !== "firebase" || !actor.emailVerified) {
    throw new PlatformError(PLATFORM_ERROR_CODES.PLATFORM_ACCESS_DENIED);
  }
  const member = await platform.findMemberForClaimByEmail(actor.email);
  if (!member) throw new PlatformError(PLATFORM_ERROR_CODES.PLATFORM_ACCESS_DENIED);
  if (member.userId) throw new PlatformError(PLATFORM_ERROR_CODES.REPOSITORY_CONFLICT);
  const userId = await resolveOnboardingActor(tenancy, actor);
  const linked = await platform.findActiveMemberByUserId(userId);
  if (linked) return linked;
  const linkedMember = await platform.claimMemberByEmail(actor.email, userId);
  if (!linkedMember) throw new PlatformError(PLATFORM_ERROR_CODES.REPOSITORY_CONFLICT);
  return linkedMember;
}

export function toPlatformBusinessDto(business: Business): PlatformBusinessDto {
  return {
    id: business.id,
    name: business.name,
    status: business.status,
    requesterId: business.createdBy,
    activatedAt: business.activatedAt,
    serviceExpiresAt: business.serviceExpiresAt,
    suspendedAt: business.suspendedAt,
    suspensionReason: business.suspensionReason,
  };
}

export async function requirePlatformMember(
  actor: OnboardingActor,
  tenancy: OnboardingRepository,
  platform: PlatformRepository,
): Promise<PlatformMember> {
  const userId = await resolveOnboardingActor(tenancy, actor);
  let member = await platform.findActiveMemberByUserId(userId);
  // Firebase email is used only for this one-time initial claim; normal authorization is user_id.
  if (!member && typeof actor !== "string" && actor.provider === "firebase" && actor.emailVerified) {
    await claimPlatformMemberForActor(actor, tenancy, platform);
    member = await platform.findActiveMemberByUserId(userId);
  }
  if (!member || member.role !== "platform_admin" || !member.isActive || member.userId !== userId) {
    throw new PlatformError(PLATFORM_ERROR_CODES.PLATFORM_ACCESS_DENIED);
  }
  return member;
}

function requirePlatformCapability(
  member: PlatformMember,
  capability: "approve_administrator" | "suspend_administrator" | "revoke_administrator",
): void {
  if (!can(member.role, capability)) throw new PlatformError(PLATFORM_ERROR_CODES.PLATFORM_ACCESS_DENIED);
}

type AdministratorEntry = {
  membership: Awaited<ReturnType<OnboardingRepository["listMemberships"]>>[number];
  business: Business;
  email?: string | null;
};

async function listAdministratorEntries(repository: OnboardingRepository): Promise<AdministratorEntry[]> {
  const businesses = await repository.listBusinesses();
  const entries = await Promise.all(businesses.map(async (business) => ({
    business,
    memberships: await repository.listMemberships(business.id),
  })));
  const administratorEntries = entries.flatMap(({ business, memberships }) => memberships
    .filter((membership) => membership.role === "administrator" || membership.role === "general_admin")
    .map((membership) => ({ membership, business })));
  return Promise.all(administratorEntries.map(async (entry) => ({
    ...entry,
    email: (await repository.findUserById?.(entry.membership.userId))?.email ?? null,
  })));
}

async function findAdministratorEntry(repository: OnboardingRepository, membershipId: string): Promise<AdministratorEntry | null> {
  if (typeof membershipId !== "string" || !membershipId.trim()) return null;
  return (await listAdministratorEntries(repository)).find(({ membership }) => membership.membershipId === membershipId) ?? null;
}

function toPlatformAdministratorDto(entry: AdministratorEntry): PlatformAdministratorDto {
  return {
    membershipId: entry.membership.membershipId,
    businessId: entry.membership.businessId,
    userId: entry.membership.userId,
    email: entry.email ?? null,
    role: entry.membership.role === "general_admin" ? "general_admin" : "administrator",
    isActive: entry.membership.isActive,
    status: entry.membership.status,
    businessStatus: entry.business.status,
  };
}

export interface PlatformServiceDependencies {
  tenancyRepository: OnboardingRepository;
  platformRepository: PlatformRepository;
}

export interface PlatformService {
  claimPlatformMember(actor: AuthIdentity): Promise<PlatformMember>;
  listBusinesses(actor: OnboardingActor): Promise<PlatformBusinessDto[]>;
  approveBusiness(businessId: BusinessId, actor: OnboardingActor, input: ApproveBusinessInput): Promise<Business>;
  rejectBusiness(businessId: BusinessId, actor: OnboardingActor, input: ReasonInput): Promise<Business>;
  suspendBusiness(businessId: BusinessId, actor: OnboardingActor, input: ReasonInput): Promise<Business>;
  reactivateBusiness(businessId: BusinessId, actor: OnboardingActor, input: ReasonInput): Promise<Business>;
  listAdministrators(actor: OnboardingActor): Promise<PlatformAdministratorDto[]>;
  approveAdministrator(membershipId: string, actor: OnboardingActor, input: ReasonInput): Promise<PlatformAdministratorDto>;
  suspendAdministrator(membershipId: string, actor: OnboardingActor, input: AdministratorActionInput): Promise<PlatformAdministratorDto>;
}

export function createPlatformService(dependencies: PlatformServiceDependencies): PlatformService {
  const { tenancyRepository: tenancy, platformRepository: platform } = dependencies;

  async function runTransition(
    businessId: BusinessId,
    actor: OnboardingActor,
    action: string,
    beforeStatus: BusinessStatus,
    update: BusinessLifecycleUpdate,
    reason: string | null,
  ): Promise<Business> {
    const member = await requirePlatformMember(actor, tenancy, platform);
    const execute = async (transaction: OnboardingRepository, transactionPlatform: PlatformRepository): Promise<Business> => {
      const current = await transaction.findBusiness(businessId);
      if (!current) throw new PlatformError(PLATFORM_ERROR_CODES.BUSINESS_NOT_FOUND);
      if (current.status !== beforeStatus) throw new PlatformError(PLATFORM_ERROR_CODES.INVALID_TRANSITION);
      let updated: Business;
      try {
        updated = await transaction.updateBusinessLifecycle(businessId, update, beforeStatus);
      } catch (error) {
        if (error instanceof OnboardingError) throw new PlatformError(PLATFORM_ERROR_CODES.REPOSITORY_CONFLICT);
        throw error;
      }
      await transactionPlatform.appendAuditEvent({
        actorId: member.id,
        action,
        targetType: "business",
        targetId: businessId,
        beforeStatus: current.status,
        afterStatus: updated.status,
        reason,
      });
      return updated;
    };
    if (platform.transaction) return platform.transaction((transactionPlatform) => tenancy.transaction((transaction) => execute(transaction, transactionPlatform)));
    return tenancy.transaction((transaction) => execute(transaction, platform));
  }

  return {
    async listBusinesses(actor) {
      await requirePlatformMember(actor, tenancy, platform);
      return (await tenancy.listBusinesses()).map(toPlatformBusinessDto);
    },

    async claimPlatformMember(actor) {
      return claimPlatformMemberForActor(actor, tenancy, platform);
    },

    async approveBusiness(businessId, actor, input) {
      const member = await requirePlatformMember(actor, tenancy, platform);
      const serviceExpiresAt = serviceExpirationDate(input.serviceExpiresAt);
      const execute = async (transaction: OnboardingRepository, transactionPlatform: PlatformRepository): Promise<Business> => {
        const current = await transaction.findBusiness(businessId);
        if (!current) throw new PlatformError(PLATFORM_ERROR_CODES.BUSINESS_NOT_FOUND);
        if (current.status !== "pending") throw new PlatformError(PLATFORM_ERROR_CODES.INVALID_TRANSITION);
        const now = new Date().toISOString();
        await transaction.createMembership({
          membershipId: randomUUID(),
          userId: current.createdBy,
          businessId,
          role: "owner_admin",
          isActive: true,
          status: "active",
        });
         let approved: Business;
         try {
           approved = await transaction.updateBusinessLifecycle(businessId, {
          status: "active",
          activatedAt: now,
          serviceExpiresAt,
          suspendedAt: null,
          suspensionReason: null,
           }, "pending");
         } catch (error) {
           if (error instanceof OnboardingError) throw new PlatformError(PLATFORM_ERROR_CODES.REPOSITORY_CONFLICT);
           throw error;
         }
        await transaction.appendAuditEvent({ businessId, actorId: current.createdBy, type: "business_created", entityId: businessId });
        await transactionPlatform.appendAuditEvent({
          actorId: member.id,
          action: "business_approved",
          targetType: "business",
          targetId: businessId,
          beforeStatus: "pending",
          afterStatus: "active",
          reason: null,
        });
        return approved;
      };
      if (platform.transaction) return platform.transaction((transactionPlatform) => tenancy.transaction((transaction) => execute(transaction, transactionPlatform)));
      return tenancy.transaction((transaction) => execute(transaction, platform));
    },

    async rejectBusiness(businessId, actor, input) {
      return runTransition(businessId, actor, "business_rejected", "pending", {
        status: "rejected",
        suspendedAt: null,
        suspensionReason: null,
      }, requireReason(input.reason));
    },

    async suspendBusiness(businessId, actor, input) {
      const reason = requireReason(input.reason);
      return runTransition(businessId, actor, "business_suspended", "active", {
        status: "suspended",
        suspendedAt: new Date().toISOString(),
        suspensionReason: reason,
      }, reason);
    },

    async reactivateBusiness(businessId, actor, input) {
      return runTransition(businessId, actor, "business_reactivated", "suspended", {
        status: "active",
        suspendedAt: null,
        suspensionReason: null,
      }, input.reason?.trim() || null);
    },

    async listAdministrators(actor) {
      const member = await requirePlatformMember(actor, tenancy, platform);
      requirePlatformCapability(member, "approve_administrator");
      return (await listAdministratorEntries(tenancy)).map(toPlatformAdministratorDto);
    },

    async approveAdministrator(membershipId, actor, input) {
      const member = await requirePlatformMember(actor, tenancy, platform);
      requirePlatformCapability(member, "approve_administrator");
      const before = await findAdministratorEntry(tenancy, membershipId);
      if (!before || before.membership.isActive) throw new PlatformError(PLATFORM_ERROR_CODES.ADMINISTRATOR_NOT_FOUND);
      if (before.membership.status !== "pending") throw new PlatformError(PLATFORM_ERROR_CODES.INVALID_TRANSITION);
      const reason = input.reason?.trim() || null;
      const execute = async (transaction: OnboardingRepository, transactionPlatform: PlatformRepository): Promise<PlatformAdministratorDto> => {
        const current = await findAdministratorEntry(transaction, membershipId);
        if (!current || current.membership.isActive) throw new PlatformError(PLATFORM_ERROR_CODES.REPOSITORY_CONFLICT);
        if (current.membership.status !== "pending") throw new PlatformError(PLATFORM_ERROR_CODES.INVALID_TRANSITION);
        let updated: Awaited<ReturnType<OnboardingRepository["updateMembership"]>>;
        try {
          updated = await transaction.updateMembership({ ...current.membership, isActive: true, status: "active" }, {
            isActive: false,
            role: current.membership.role,
            status: "pending",
          });
        } catch (error) {
          if (error instanceof OnboardingError) throw new PlatformError(PLATFORM_ERROR_CODES.REPOSITORY_CONFLICT);
          throw error;
        }
        await transactionPlatform.appendAuditEvent({
          actorId: member.id,
          action: "administrator_approved",
          targetType: "membership",
          targetId: updated.membershipId,
          beforeStatus: "pending",
          afterStatus: "active",
          reason,
        });
        return toPlatformAdministratorDto({ membership: updated, business: current.business, email: before.email });
      };
      if (platform.transaction) return platform.transaction((transactionPlatform) => tenancy.transaction((transaction) => execute(transaction, transactionPlatform)));
      return tenancy.transaction((transaction) => execute(transaction, platform));
    },

    async suspendAdministrator(membershipId, actor, input) {
      const member = await requirePlatformMember(actor, tenancy, platform);
      requirePlatformCapability(member, input.action === "revoke" ? "revoke_administrator" : "suspend_administrator");
      const reason = requireReason(input.reason);
      const before = await findAdministratorEntry(tenancy, membershipId);
      if (!before) throw new PlatformError(PLATFORM_ERROR_CODES.ADMINISTRATOR_NOT_FOUND);
      const execute = async (transaction: OnboardingRepository, transactionPlatform: PlatformRepository): Promise<PlatformAdministratorDto> => {
        const current = await findAdministratorEntry(transaction, membershipId);
        if (!current) throw new PlatformError(PLATFORM_ERROR_CODES.REPOSITORY_CONFLICT);
        const nextStatus = input.action === "revoke" ? "revoked" : "suspended";
        if (!current.membership.isActive || current.membership.status !== "active") throw new PlatformError(PLATFORM_ERROR_CODES.REPOSITORY_CONFLICT);
        try {
          await transaction.updateMembership({
            ...current.membership,
            isActive: false,
            status: input.action === "revoke" ? "revoked" : "suspended",
          }, {
            isActive: true,
            role: current.membership.role,
            status: "active",
          });
        } catch (error) {
          if (error instanceof OnboardingError) throw new PlatformError(PLATFORM_ERROR_CODES.REPOSITORY_CONFLICT);
          throw error;
        }
        await transactionPlatform.appendAuditEvent({
          actorId: member.id,
          action: input.action === "revoke" ? "administrator_revoked" : "administrator_suspended",
          targetType: "membership",
          targetId: current.membership.membershipId,
          beforeStatus: current.membership.isActive ? "active" : "suspended",
          afterStatus: nextStatus,
          reason,
        });
        return toPlatformAdministratorDto({
          membership: {
            ...current.membership,
            isActive: false,
            status: input.action === "revoke" ? "revoked" : "suspended",
          },
          business: current.business,
          email: before.email,
        });
      };
      if (platform.transaction) return platform.transaction((transactionPlatform) => tenancy.transaction((transaction) => execute(transaction, transactionPlatform)));
      return tenancy.transaction((transaction) => execute(transaction, platform));
    },
  };
}

const DEFAULT_PLATFORM_REPOSITORY_KEY = Symbol.for("ledgerharbour.platform.defaultRepository");

function createDefaultPlatformRepository(): InMemoryPlatformRepository {
  const shareAcrossBundles = process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
  const globalState = globalThis as typeof globalThis & { [key: symbol]: unknown };
  const existing = globalState[DEFAULT_PLATFORM_REPOSITORY_KEY] as InMemoryPlatformRepository | undefined;
  if (shareAcrossBundles && existing?.platformMembers && existing?.auditEvents) return existing;

  const repository = createInMemoryPlatformRepository();
  if (process.env.PLATFORM_ADMIN_EMAILS) {
    for (const [index, email] of process.env.PLATFORM_ADMIN_EMAILS.split(",").entries()) {
      const normalizedEmail = email.trim().toLocaleLowerCase("en-US");
      if (normalizedEmail) {
        repository.addMember({ id: `test-platform-${index + 1}`, userId: null, normalizedEmail });
      }
    }
  }
  if (shareAcrossBundles) {
    Object.defineProperty(globalState, DEFAULT_PLATFORM_REPOSITORY_KEY, {
      configurable: false,
      enumerable: false,
      value: repository,
      writable: false,
    });
  }
  return repository;
}

export const defaultPlatformRepository: InMemoryPlatformRepository = createDefaultPlatformRepository();
export const createDefaultPlatformService = (tenancyRepository: OnboardingRepository = defaultOnboardingRepository) =>
  createPlatformService({ tenancyRepository, platformRepository: defaultPlatformRepository });
