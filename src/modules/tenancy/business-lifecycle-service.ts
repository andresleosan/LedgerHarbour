import {
  defaultOnboardingRepository,
  type OnboardingActor,
  type OnboardingRepository,
} from "./business-service";
import type { BusinessId } from "./types";
import type { Business } from "./business-service";

export const LIFECYCLE_ERROR_CODES = {
  INVALID_ACTION: "INVALID_ACTION",
  BUSINESS_NOT_FOUND: "BUSINESS_NOT_FOUND",
  INSUFFICIENT_CAPABILITY: "INSUFFICIENT_CAPABILITY",
  INACTIVE_BUSINESS: "INACTIVE_BUSINESS",
  ACTIVE_BUSINESS: "ACTIVE_BUSINESS",
  CONFIRMATION_REQUIRED: "CONFIRMATION_REQUIRED",
  REPOSITORY_CONFLICT: "REPOSITORY_CONFLICT",
  PLATFORM_ADMIN_REQUIRED: "PLATFORM_ADMIN_REQUIRED",
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
  PLATFORM_ADMIN_REQUIRED: "Only a platform administrator can change business lifecycle.",
};

export class BusinessLifecycleError extends Error {
  readonly name = "BusinessLifecycleError";

  constructor(readonly code: LifecycleErrorCode) {
    super(publicMessages[code]);
  }
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

export interface BusinessLifecycleService {
  deactivateBusiness(businessId: BusinessId, actor: OnboardingActor, confirmationName: string): Promise<void>;
  reactivateBusiness(businessId: BusinessId, actor: OnboardingActor, confirmationName: string): Promise<void>;
}

export function createBusinessLifecycleService(repository: OnboardingRepository = defaultOnboardingRepository): BusinessLifecycleService {
  void repository;
  return {
    async deactivateBusiness(businessId, actor, confirmationName) {
      void businessId;
      void actor;
      void confirmationName;
      throw new BusinessLifecycleError(LIFECYCLE_ERROR_CODES.PLATFORM_ADMIN_REQUIRED);
    },

    async reactivateBusiness(businessId, actor, confirmationName) {
      void businessId;
      void actor;
      void confirmationName;
      throw new BusinessLifecycleError(LIFECYCLE_ERROR_CODES.PLATFORM_ADMIN_REQUIRED);
    },
  };
}

export const deactivateBusiness = (businessId: BusinessId, actor: OnboardingActor, confirmationName: string, repository = defaultOnboardingRepository) =>
  createBusinessLifecycleService(repository).deactivateBusiness(businessId, actor, confirmationName);
export const reactivateBusiness = (businessId: BusinessId, actor: OnboardingActor, confirmationName: string, repository = defaultOnboardingRepository) =>
  createBusinessLifecycleService(repository).reactivateBusiness(businessId, actor, confirmationName);
