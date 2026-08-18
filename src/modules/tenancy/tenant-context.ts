import {
  AuthorizationError,
  AUTHORIZATION_ERROR_CODES,
  InfrastructureAuthorizationError,
} from "../permissions/authorize";
import { MembershipRole } from "../permissions/roles";
import { MembershipStatus, type BusinessId, type BusinessStatus, type Membership, type UserId } from "./types";

export const BUSINESS_ACCESS_DENIAL_REASONS = {
  BUSINESS_NOT_FOUND: "business_not_found",
  BUSINESS_PENDING: "business_pending",
  BUSINESS_REJECTED: "business_rejected",
  BUSINESS_SUSPENDED: "business_suspended",
  MEMBERSHIP_REQUIRED: "membership_required",
  MEMBERSHIP_INACTIVE: "membership_inactive",
} as const;

export type BusinessAccessDenialReason =
  (typeof BUSINESS_ACCESS_DENIAL_REASONS)[keyof typeof BUSINESS_ACCESS_DENIAL_REASONS];

export type EffectiveBusinessAccess =
  | { allowed: true; membership: Membership; reason: null }
  | { allowed: false; membership: null; reason: BusinessAccessDenialReason };

export interface TenantRepository {
  findMembership(userId: UserId, businessId: BusinessId): Promise<Membership | null>;
  findBusinessStatus(businessId: BusinessId): Promise<BusinessStatus | "inactive" | null>;
  lockMembership?(userId: UserId, businessId: BusinessId): Promise<void>;
  lockBusiness?(businessId: BusinessId): Promise<void>;
  findUserById?(userId: UserId): Promise<{ email: string } | null>;
}

export interface TenantContext {
  getMembership(userId: UserId, businessId: BusinessId): Promise<Membership | null>;
  requireBusinessAccess(userId: UserId, businessId: BusinessId): Promise<Membership>;
  effectiveBusinessAccess(businessId: BusinessId, userId: UserId): Promise<EffectiveBusinessAccess>;
}

export const TENANT_REPOSITORY_CONFIGURATION_CODES = {
  ALREADY_CONFIGURED: "TENANT_REPOSITORY_ALREADY_CONFIGURED",
  INVALID_REPOSITORY: "INVALID_TENANT_REPOSITORY",
} as const;

export class TenantRepositoryConfigurationError extends Error {
  readonly name = "TenantRepositoryConfigurationError";

  constructor(
    readonly code: (typeof TENANT_REPOSITORY_CONFIGURATION_CODES)[keyof typeof TENANT_REPOSITORY_CONFIGURATION_CODES],
    message: string,
  ) {
    super(message);
  }
}

const noConfiguredRepository: TenantRepository = {
  findMembership: async () => null,
  findBusinessStatus: async () => null,
};

let configuredRepository: TenantRepository | null = null;

export function configureTenantRepository(repository: TenantRepository): void {
  if (configuredRepository !== null) {
    throw new TenantRepositoryConfigurationError(
      TENANT_REPOSITORY_CONFIGURATION_CODES.ALREADY_CONFIGURED,
      "Tenant repository is already configured",
    );
  }

  if (
    !repository ||
    typeof repository.findMembership !== "function" ||
    typeof repository.findBusinessStatus !== "function"
  ) {
    throw new TenantRepositoryConfigurationError(
      TENANT_REPOSITORY_CONFIGURATION_CODES.INVALID_REPOSITORY,
      "Tenant repository configuration is invalid",
    );
  }

  configuredRepository = repository;
}

function isOpaqueId(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function isMembershipForRequest(
  membership: Membership | null | undefined,
  userId: UserId,
  businessId: BusinessId,
): membership is Membership {
  return (
    membership !== null &&
    membership !== undefined &&
    membership.userId === userId &&
    membership.businessId === businessId &&
    MembershipRole.includes(membership.role) &&
    typeof membership.isActive === "boolean" &&
    MembershipStatus.includes(membership.status) &&
    (membership.status === "active") === membership.isActive
  );
}

function accessDenied(reason: BusinessAccessDenialReason = BUSINESS_ACCESS_DENIAL_REASONS.MEMBERSHIP_REQUIRED): AuthorizationError {
  return new AuthorizationError(
    AUTHORIZATION_ERROR_CODES.BUSINESS_ACCESS_DENIED,
    "Business access denied",
    reason,
  );
}

async function getMembershipFrom(
  repository: TenantRepository,
  userId: UserId,
  businessId: BusinessId,
): Promise<Membership | null> {
  if (!isOpaqueId(userId) || !isOpaqueId(businessId)) {
    return null;
  }

  let membership: Membership | null;
  try {
    membership = await repository.findMembership(userId, businessId);
  } catch (cause) {
    throw new InfrastructureAuthorizationError(cause);
  }

  return isMembershipForRequest(membership, userId, businessId) ? membership : null;
}

async function requireBusinessAccessFrom(
  repository: TenantRepository,
  userId: UserId,
  businessId: BusinessId,
): Promise<Membership> {
  if (!isOpaqueId(userId) || !isOpaqueId(businessId)) {
    throw accessDenied();
  }

  const result = await effectiveBusinessAccessFrom(repository, businessId, userId);
  if (!result.allowed) throw accessDenied(result.reason);
  return result.membership;
}

function denialReasonForBusinessStatus(status: BusinessStatus | "inactive" | null): BusinessAccessDenialReason | null {
  if (status === null) return BUSINESS_ACCESS_DENIAL_REASONS.BUSINESS_NOT_FOUND;
  if (status === "pending") return BUSINESS_ACCESS_DENIAL_REASONS.BUSINESS_PENDING;
  if (status === "rejected") return BUSINESS_ACCESS_DENIAL_REASONS.BUSINESS_REJECTED;
  if (status === "suspended" || status === "inactive") return BUSINESS_ACCESS_DENIAL_REASONS.BUSINESS_SUSPENDED;
  return null;
}

async function effectiveBusinessAccessFrom(
  repository: TenantRepository,
  businessId: BusinessId,
  userId: UserId,
): Promise<EffectiveBusinessAccess> {
  if (!isOpaqueId(userId) || !isOpaqueId(businessId)) {
    return { allowed: false, membership: null, reason: BUSINESS_ACCESS_DENIAL_REASONS.MEMBERSHIP_REQUIRED };
  }

  let businessStatus: BusinessStatus | "inactive" | null;
  try {
    businessStatus = await repository.findBusinessStatus(businessId);
  } catch (cause) {
    throw new InfrastructureAuthorizationError(cause);
  }

  const businessDenial = denialReasonForBusinessStatus(businessStatus);
  if (businessDenial) return { allowed: false, membership: null, reason: businessDenial };

  let membership: Membership | null;
  try {
    membership = await repository.findMembership(userId, businessId);
  } catch (cause) {
    throw new InfrastructureAuthorizationError(cause);
  }
  if (!isMembershipForRequest(membership, userId, businessId)) {
    return { allowed: false, membership: null, reason: BUSINESS_ACCESS_DENIAL_REASONS.MEMBERSHIP_REQUIRED };
  }
  if (membership.status !== "active" || !membership.isActive) {
    return { allowed: false, membership: null, reason: BUSINESS_ACCESS_DENIAL_REASONS.MEMBERSHIP_INACTIVE };
  }
  return { allowed: true, membership, reason: null };
}

export function getMembership(userId: UserId, businessId: BusinessId): Promise<Membership | null> {
  return getMembershipFrom(configuredRepository ?? noConfiguredRepository, userId, businessId);
}

export function requireBusinessAccess(userId: UserId, businessId: BusinessId): Promise<Membership> {
  return requireBusinessAccessFrom(
    configuredRepository ?? noConfiguredRepository,
    userId,
    businessId,
  );
}

export function effectiveBusinessAccess(businessId: BusinessId, userId: UserId): Promise<EffectiveBusinessAccess>;
export function effectiveBusinessAccess(repository: TenantRepository, businessId: BusinessId, userId: UserId): Promise<EffectiveBusinessAccess>;
export function effectiveBusinessAccess(
  first: TenantRepository | BusinessId,
  second: BusinessId | UserId,
  third?: UserId,
): Promise<EffectiveBusinessAccess> {
  if (third === undefined) {
    return effectiveBusinessAccessFrom(configuredRepository ?? noConfiguredRepository, first as BusinessId, second as UserId);
  }
  return effectiveBusinessAccessFrom(first as TenantRepository, second as BusinessId, third);
}

export function createTenantContext(repository: TenantRepository): TenantContext {
  return {
    getMembership: (userId, businessId) => getMembershipFrom(repository, userId, businessId),
    requireBusinessAccess: (userId, businessId) =>
      requireBusinessAccessFrom(repository, userId, businessId),
    effectiveBusinessAccess: (businessId, userId) => effectiveBusinessAccessFrom(repository, businessId, userId),
  };
}
