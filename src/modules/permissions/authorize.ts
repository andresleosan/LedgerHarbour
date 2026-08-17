import type { Capability } from "./capabilities";
import type { AuthorizationRole } from "./roles";
import type { Membership } from "../tenancy/types";

export const AUTHORIZATION_ERROR_CODES = {
  MEMBERSHIP_REQUIRED: "MEMBERSHIP_REQUIRED",
  CAPABILITY_REQUIRED: "CAPABILITY_REQUIRED",
  BUSINESS_ACCESS_DENIED: "BUSINESS_ACCESS_DENIED",
  INFRASTRUCTURE_FAILURE: "AUTHORIZATION_INFRASTRUCTURE_FAILURE",
} as const;

export type AuthorizationErrorCode = (typeof AUTHORIZATION_ERROR_CODES)[keyof typeof AUTHORIZATION_ERROR_CODES];

export class AuthorizationError extends Error {
  readonly name: string = "AuthorizationError";

  constructor(readonly code: AuthorizationErrorCode, message: string, readonly reason?: string) {
    super(message);
  }
}

export class InfrastructureAuthorizationError extends AuthorizationError {
  readonly name = "InfrastructureAuthorizationError";
  readonly cause: unknown;

  constructor(cause: unknown) {
    super(
      AUTHORIZATION_ERROR_CODES.INFRASTRUCTURE_FAILURE,
      "Business access temporarily unavailable",
    );
    this.cause = cause;
    Object.defineProperty(this, "cause", { enumerable: false });
  }
}

const capabilityMatrix: Record<AuthorizationRole, readonly Capability[]> = {
  owner_admin: [
    "read_finance",
    "edit_finance",
    "approve_administrator",
    "remove_administrator",
    "manage_general_admin",
    "transfer_ownership",
    "deactivate_business",
    "reactivate_business",
  ],
  general_admin: [
    "read_finance",
    "edit_finance",
    "approve_administrator",
    "remove_administrator",
  ],
  administrator: ["read_finance", "edit_finance"],
  platform_admin: ["approve_administrator", "suspend_administrator", "revoke_administrator"],
};

export function can(role: AuthorizationRole, capability: Capability): boolean {
  return capabilityMatrix[role]?.includes(capability) ?? false;
}

export function requireCapability(membership: Membership, capability: Capability): void {
  if (!membership || !membership.isActive) {
    throw new AuthorizationError(
      AUTHORIZATION_ERROR_CODES.MEMBERSHIP_REQUIRED,
      "Business access denied",
    );
  }

  if (!can(membership.role, capability)) {
    throw new AuthorizationError(
      AUTHORIZATION_ERROR_CODES.CAPABILITY_REQUIRED,
      "Required capability is not granted",
    );
  }
}
