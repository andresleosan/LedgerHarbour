import { requireCapability } from "../permissions/authorize";
import {
  defaultOnboardingRepository,
  resolveOnboardingActor,
  type OnboardingActor,
  type OnboardingRepository,
} from "./business-service";
import { createTenantContext } from "./tenant-context";
import type { BusinessId, UserId } from "./types";
import type { Business } from "./business-service";

export const LIFECYCLE_ERROR_CODES = {
  INVALID_ACTION: "INVALID_ACTION",
  BUSINESS_NOT_FOUND: "BUSINESS_NOT_FOUND",
  INSUFFICIENT_CAPABILITY: "INSUFFICIENT_CAPABILITY",
  INACTIVE_BUSINESS: "INACTIVE_BUSINESS",
  ACTIVE_BUSINESS: "ACTIVE_BUSINESS",
  CONFIRMATION_REQUIRED: "CONFIRMATION_REQUIRED",
  REPOSITORY_CONFLICT: "REPOSITORY_CONFLICT",
} as const;

export type LifecycleErrorCode = (typeof LIFECYCLE_ERROR_CODES)[keyof typeof LIFECYCLE_ERROR_CODES];

const publicMessages: Record<LifecycleErrorCode, string> = {
  INVALID_ACTION: "This lifecycle action is not available.",
  BUSINESS_NOT_FOUND: "Business not found.",
  INSUFFICIENT_CAPABILITY: "Only the Owner Admin can change business lifecycle.",
  INACTIVE_BUSINESS: "This business is already inactive.",
  ACTIVE_BUSINESS: "This business is already active.",
  CONFIRMATION_REQUIRED: "Enter the exact business name before changing lifecycle.",
  REPOSITORY_CONFLICT: "The business state changed elsewhere.",
};

export class BusinessLifecycleError extends Error {
  readonly name = "BusinessLifecycleError";

  constructor(readonly code: LifecycleErrorCode) {
    super(publicMessages[code]);
  }
}

function requireActor(actorId: UserId): void {
  if (typeof actorId !== "string" || !actorId.trim()) {
    throw new BusinessLifecycleError(LIFECYCLE_ERROR_CODES.INSUFFICIENT_CAPABILITY);
  }
}

async function requireOwner(
  repository: OnboardingRepository,
  businessId: BusinessId,
  actorId: UserId,
  allowInactive: boolean,
): Promise<Business> {
  requireActor(actorId);
  const business = allowInactive
    ? await repository.findBusiness(businessId)
    : await requireBusinessOperational(repository, businessId);
  if (!business) throw new BusinessLifecycleError(LIFECYCLE_ERROR_CODES.BUSINESS_NOT_FOUND);
  const membership = await createTenantContext(repository).getMembership(actorId, businessId);
  try {
    requireCapability(membership!, "deactivate_business");
  } catch {
    throw new BusinessLifecycleError(LIFECYCLE_ERROR_CODES.INSUFFICIENT_CAPABILITY);
  }
  if (!membership || membership.role !== "owner_admin" || !membership.isActive) {
    throw new BusinessLifecycleError(LIFECYCLE_ERROR_CODES.INSUFFICIENT_CAPABILITY);
  }
  return business;
}

/**
 * Shared write boundary for future document upload and invoice review modules.
 * Those mutation entry points are not part of Task 6 yet.
 */
export async function requireBusinessOperational(
  repository: OnboardingRepository,
  businessId: BusinessId,
): Promise<Business> {
  const business = await repository.findBusiness(businessId);
  if (!business) throw new BusinessLifecycleError(LIFECYCLE_ERROR_CODES.BUSINESS_NOT_FOUND);
   if (business.status !== "active" || !business.isActive) throw new BusinessLifecycleError(LIFECYCLE_ERROR_CODES.INACTIVE_BUSINESS);
  return business;
}

function validateConfirmationName(confirmationName: string, businessName: string): void {
  if (typeof confirmationName !== "string" || confirmationName !== businessName) {
    throw new BusinessLifecycleError(LIFECYCLE_ERROR_CODES.CONFIRMATION_REQUIRED);
  }
}

export interface BusinessLifecycleService {
  deactivateBusiness(businessId: BusinessId, actor: OnboardingActor, confirmationName: string): Promise<void>;
  reactivateBusiness(businessId: BusinessId, actor: OnboardingActor, confirmationName: string): Promise<void>;
}

export function createBusinessLifecycleService(repository: OnboardingRepository = defaultOnboardingRepository): BusinessLifecycleService {
  return {
    async deactivateBusiness(businessId, actor, confirmationName) {
      const actorId = await resolveOnboardingActor(repository, actor);
      const business = await requireOwner(repository, businessId, actorId, false);
      validateConfirmationName(confirmationName, business.name);
      await repository.transaction(async (transaction) => {
        const business = await transaction.findBusiness(businessId);
        if (!business) throw new BusinessLifecycleError(LIFECYCLE_ERROR_CODES.BUSINESS_NOT_FOUND);
         if (business.status !== "active" || !business.isActive) throw new BusinessLifecycleError(LIFECYCLE_ERROR_CODES.INACTIVE_BUSINESS);
        await transaction.updateBusinessStatus(businessId, false);
        await transaction.appendAuditEvent({ businessId, actorId, type: "business_deactivated", entityId: businessId });
      });
    },

    async reactivateBusiness(businessId, actor, confirmationName) {
      const actorId = await resolveOnboardingActor(repository, actor);
      const business = await requireOwner(repository, businessId, actorId, true);
      validateConfirmationName(confirmationName, business.name);
      await repository.transaction(async (transaction) => {
        const business = await transaction.findBusiness(businessId);
        if (!business) throw new BusinessLifecycleError(LIFECYCLE_ERROR_CODES.BUSINESS_NOT_FOUND);
         if (business.status === "active" && business.isActive) throw new BusinessLifecycleError(LIFECYCLE_ERROR_CODES.ACTIVE_BUSINESS);
        await transaction.updateBusinessStatus(businessId, true);
        await transaction.appendAuditEvent({ businessId, actorId, type: "business_reactivated", entityId: businessId });
      });
    },
  };
}

export const deactivateBusiness = (businessId: BusinessId, actor: OnboardingActor, confirmationName: string, repository = defaultOnboardingRepository) =>
  createBusinessLifecycleService(repository).deactivateBusiness(businessId, actor, confirmationName);
export const reactivateBusiness = (businessId: BusinessId, actor: OnboardingActor, confirmationName: string, repository = defaultOnboardingRepository) =>
  createBusinessLifecycleService(repository).reactivateBusiness(businessId, actor, confirmationName);
