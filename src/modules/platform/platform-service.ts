import { randomUUID } from "node:crypto";

import {
  defaultOnboardingRepository,
  resolveOnboardingActor,
  type Business,
  type BusinessLifecycleUpdate,
  type OnboardingActor,
  type OnboardingRepository,
} from "../tenancy/business-service";
import type { BusinessId, BusinessStatus, UserId } from "../tenancy/types";
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
} as const;

export type PlatformErrorCode = (typeof PLATFORM_ERROR_CODES)[keyof typeof PLATFORM_ERROR_CODES];

const messages: Record<PlatformErrorCode, string> = {
  PLATFORM_ACCESS_DENIED: "Platform administration access denied.",
  BUSINESS_NOT_FOUND: "Business not found.",
  INVALID_BUSINESS_TRANSITION: "This business state transition is not available.",
  PLATFORM_REASON_REQUIRED: "A reason is required for this action.",
  INVALID_SERVICE_DATE: "The service expiration date is invalid.",
  PLATFORM_REPOSITORY_CONFLICT: "The business state changed elsewhere.",
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
  serviceExpiresAt?: string;
}

export interface ReasonInput {
  reason?: string;
}

function requireReason(reason: string | undefined): string {
  if (typeof reason !== "string" || !reason.trim()) throw new PlatformError(PLATFORM_ERROR_CODES.REASON_REQUIRED);
  return reason.trim();
}

function optionalDate(value: string | undefined): string | null {
  if (value === undefined) return null;
  const parsed = new Date(value);
  if (!value.trim() || Number.isNaN(parsed.getTime())) throw new PlatformError(PLATFORM_ERROR_CODES.INVALID_DATE);
  return parsed.toISOString();
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

async function requirePlatformMember(
  actor: OnboardingActor,
  tenancy: OnboardingRepository,
  platform: PlatformRepository,
): Promise<PlatformMember> {
  const userId = await resolveOnboardingActor(tenancy, actor);
  const member = typeof actor === "string"
    ? await platform.findActiveMemberByUserId(userId)
    : await platform.findActiveMemberByEmail(actor.email);
  if (!member || member.role !== "platform_admin" || !member.isActive) {
    throw new PlatformError(PLATFORM_ERROR_CODES.PLATFORM_ACCESS_DENIED);
  }
  if (!member.userId) await platform.linkMemberToUser(member.id, userId);
  return member;
}

export interface PlatformServiceDependencies {
  tenancyRepository: OnboardingRepository;
  platformRepository: PlatformRepository;
}

export interface PlatformService {
  listBusinesses(actor: OnboardingActor): Promise<PlatformBusinessDto[]>;
  approveBusiness(businessId: BusinessId, actor: OnboardingActor, input: ApproveBusinessInput): Promise<Business>;
  rejectBusiness(businessId: BusinessId, actor: OnboardingActor, input: ReasonInput): Promise<Business>;
  suspendBusiness(businessId: BusinessId, actor: OnboardingActor, input: ReasonInput): Promise<Business>;
  reactivateBusiness(businessId: BusinessId, actor: OnboardingActor, input: ReasonInput): Promise<Business>;
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
      const updated = await transaction.updateBusinessLifecycle(businessId, update);
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

    async approveBusiness(businessId, actor, input) {
      const member = await requirePlatformMember(actor, tenancy, platform);
      const serviceExpiresAt = optionalDate(input.serviceExpiresAt);
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
        });
        const approved = await transaction.updateBusinessLifecycle(businessId, {
          status: "active",
          activatedAt: now,
          serviceExpiresAt,
          suspendedAt: null,
          suspensionReason: null,
        });
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
  };
}

export const defaultPlatformRepository: InMemoryPlatformRepository = createInMemoryPlatformRepository();
if ((process.env.NODE_ENV === "test" || process.env.LEDGERHARBOUR_TEST_MODE === "true") && process.env.PLATFORM_ADMIN_EMAILS) {
  for (const [index, email] of process.env.PLATFORM_ADMIN_EMAILS.split(",").entries()) {
    const normalizedEmail = email.trim().toLocaleLowerCase("en-US");
    if (normalizedEmail) defaultPlatformRepository.addMember({ id: `test-platform-${index + 1}`, userId: null, normalizedEmail });
  }
}
export const createDefaultPlatformService = (tenancyRepository: OnboardingRepository = defaultOnboardingRepository) =>
  createPlatformService({ tenancyRepository, platformRepository: defaultPlatformRepository });
