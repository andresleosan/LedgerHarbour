import { describe, expect, it } from "vitest";

import {
  AuthorizationError,
  AUTHORIZATION_ERROR_CODES,
  InfrastructureAuthorizationError,
  can,
  requireCapability,
} from "../../../src/modules/permissions/authorize";
import { Capability } from "../../../src/modules/permissions/capabilities";
import { MembershipRole, PlatformRole } from "../../../src/modules/permissions/roles";
import type { Membership } from "../../../src/modules/tenancy/types";

const userId = "user-1" as Membership["userId"];
const businessId = "business-1" as Membership["businessId"];

const membershipFor = (role: MembershipRole, isActive = true): Membership => ({
  membershipId: `membership-${role}`,
  userId,
  businessId,
  role,
  isActive,
  status: isActive ? "active" : "pending",
});

const capabilities: Capability[] = [
  "read_finance",
  "edit_finance",
  "approve_administrator",
  "remove_administrator",
  "manage_general_admin",
  "transfer_ownership",
  "deactivate_business",
  "reactivate_business",
];

const platformCapabilities: Capability[] = ["suspend_administrator", "revoke_administrator"];

const expectedCapabilities: Record<MembershipRole, Capability[]> = {
  owner_admin: capabilities,
  general_admin: [
    "read_finance",
    "edit_finance",
    "approve_administrator",
    "remove_administrator",
  ],
  administrator: ["read_finance", "edit_finance"],
};

describe("authorization capability policy", () => {
  it("gives equivalent global capabilities to every platform administrator", () => {
    for (const capability of platformCapabilities) {
      expect(can(PlatformRole[0], capability)).toBe(true);
    }
    expect(can("platform_admin", "approve_administrator")).toBe(true);
    expect(can("administrator", "suspend_administrator")).toBe(false);
  });

  it.each(
    Object.entries(expectedCapabilities).flatMap(([role, allowed]) =>
      capabilities.map((capability) => ({
        role: role as MembershipRole,
        capability,
        allowed: allowed.includes(capability),
      })),
    ),
  )("handles $role -> $capability as $allowed", ({ role, capability, allowed }) => {
    const membership = membershipFor(role);

    if (allowed) {
      expect(() => requireCapability(membership, capability)).not.toThrow();
    } else {
      expect(() => requireCapability(membership, capability)).toThrowError(
        expect.objectContaining({
          code: AUTHORIZATION_ERROR_CODES.CAPABILITY_REQUIRED,
        }),
      );
    }
  });

  it("rejects an inactive membership with the membership error code", () => {
    expect(() => requireCapability(membershipFor("owner_admin", false), "read_finance")).toThrowError(
      expect.objectContaining({
        code: AUTHORIZATION_ERROR_CODES.MEMBERSHIP_REQUIRED,
      }),
    );
  });

  it.each([
    { status: "suspended" as const, isActive: true },
    { status: "active" as const, isActive: false },
  ])("rejects inconsistent lifecycle state $status/$isActive", ({ status, isActive }) => {
    expect(() => requireCapability({ ...membershipFor("owner_admin"), status, isActive }, "read_finance")).toThrowError(
      expect.objectContaining({ code: AUTHORIZATION_ERROR_CODES.MEMBERSHIP_REQUIRED }),
    );
  });

  it("uses a typed error and keeps membership and capability codes distinct", () => {
    let inactiveError: unknown;
    let capabilityError: unknown;

    try {
      requireCapability(membershipFor("administrator", false), "read_finance");
    } catch (error) {
      inactiveError = error;
    }

    try {
      requireCapability(membershipFor("administrator"), "approve_administrator");
    } catch (error) {
      capabilityError = error;
    }

    expect(inactiveError).toBeInstanceOf(AuthorizationError);
    expect(capabilityError).toBeInstanceOf(AuthorizationError);
    expect((inactiveError as AuthorizationError).code).toBe(
      AUTHORIZATION_ERROR_CODES.MEMBERSHIP_REQUIRED,
    );
    expect((capabilityError as AuthorizationError).code).toBe(
      AUTHORIZATION_ERROR_CODES.CAPABILITY_REQUIRED,
    );
  });

  it("does not reveal a business identifier for a missing membership", () => {
    let missingError: AuthorizationError | undefined;

    try {
      requireCapability(null as unknown as Membership, "read_finance");
    } catch (error) {
      missingError = error as AuthorizationError;
    }

    expect(missingError).toBeInstanceOf(AuthorizationError);
    expect(missingError?.code).toBe(AUTHORIZATION_ERROR_CODES.MEMBERSHIP_REQUIRED);
    expect(missingError?.message).not.toContain(businessId);
    expect(missingError?.message).toBe("Business access denied");
  });

  it("does not reveal the requested business in a capability denial", () => {
    expect(() => requireCapability(membershipFor("administrator"), "approve_administrator")).toThrowError(
      expect.objectContaining({
        code: AUTHORIZATION_ERROR_CODES.CAPABILITY_REQUIRED,
        message: "Required capability is not granted",
      }),
    );
  });

  it("keeps infrastructure authorization errors generic while preserving an internal cause", () => {
    const cause = new Error("database connection string and password");
    const error = new InfrastructureAuthorizationError(cause);

    expect(error.code).toBe(AUTHORIZATION_ERROR_CODES.INFRASTRUCTURE_FAILURE);
    expect(error.message).toBe("Business access temporarily unavailable");
    expect(error.message).not.toContain("database");
    expect(error.cause).toBe(cause);
    expect(Object.keys(error)).not.toContain("cause");
    expect(JSON.stringify(error)).not.toContain("password");
  });
});
