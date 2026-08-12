import {
  AuthorizationError,
  AUTHORIZATION_ERROR_CODES,
  InfrastructureAuthorizationError,
} from "../permissions/authorize";
import { MembershipRole } from "../permissions/roles";
import type { BusinessId, Membership, UserId } from "./types";

export interface TenantRepository {
  findMembership(userId: UserId, businessId: BusinessId): Promise<Membership | null>;
  findBusinessStatus(businessId: BusinessId): Promise<"active" | "inactive" | null>;
}

export interface TenantContext {
  getMembership(userId: UserId, businessId: BusinessId): Promise<Membership | null>;
  requireBusinessAccess(userId: UserId, businessId: BusinessId): Promise<Membership>;
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
    typeof membership.isActive === "boolean"
  );
}

function accessDenied(): AuthorizationError {
  return new AuthorizationError(
    AUTHORIZATION_ERROR_CODES.BUSINESS_ACCESS_DENIED,
    "Business access denied",
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

  let membership: Membership | null;
  let businessStatus: "active" | "inactive" | null;
  try {
    [membership, businessStatus] = await Promise.all([
      repository.findMembership(userId, businessId),
      repository.findBusinessStatus(businessId),
    ]);
  } catch (cause) {
    throw new InfrastructureAuthorizationError(cause);
  }

  if (!isMembershipForRequest(membership, userId, businessId) || !membership.isActive) {
    throw accessDenied();
  }

  if (businessStatus !== "active") {
    throw accessDenied();
  }

  return membership;
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

export function createTenantContext(repository: TenantRepository): TenantContext {
  return {
    getMembership: (userId, businessId) => getMembershipFrom(repository, userId, businessId),
    requireBusinessAccess: (userId, businessId) =>
      requireBusinessAccessFrom(repository, userId, businessId),
  };
}
