import { requireCapability } from "../permissions/authorize";
import {
  defaultOnboardingRepository,
  resolveOnboardingActor,
  type OnboardingActor,
  type OnboardingRepository,
} from "./business-service";
import { createTenantContext } from "./tenant-context";
import type { BusinessId, Membership, UserId } from "./types";
import {
  BusinessLifecycleError,
  LIFECYCLE_ERROR_CODES,
  requireBusinessOperational,
} from "./business-lifecycle-service";

export const MEMBERSHIP_ERROR_CODES = {
  INVALID_ACTION: "INVALID_ACTION",
  INVALID_TARGET: "INVALID_TARGET",
  MEMBER_NOT_FOUND: "MEMBER_NOT_FOUND",
  INSUFFICIENT_CAPABILITY: "INSUFFICIENT_CAPABILITY",
  INACTIVE_BUSINESS: "INACTIVE_BUSINESS",
  CONFIRMATION_REQUIRED: "CONFIRMATION_REQUIRED",
  INVARIANT_CONFLICT: "INVARIANT_CONFLICT",
  OWNER_PROTECTED: "OWNER_PROTECTED",
  REPOSITORY_CONFLICT: "REPOSITORY_CONFLICT",
} as const;

export type MembershipErrorCode = (typeof MEMBERSHIP_ERROR_CODES)[keyof typeof MEMBERSHIP_ERROR_CODES];

const publicMessages: Record<MembershipErrorCode, string> = {
  INVALID_ACTION: "This membership action is not available.",
  INVALID_TARGET: "This membership target is not valid.",
  MEMBER_NOT_FOUND: "Member not found.",
  INSUFFICIENT_CAPABILITY: "You do not have permission to manage members.",
  INACTIVE_BUSINESS: "This business is inactive.",
  CONFIRMATION_REQUIRED: "Enter the exact business name and reauthenticate within five minutes.",
  INVARIANT_CONFLICT: "The business must retain exactly one active Owner Admin.",
  OWNER_PROTECTED: "The current Owner Admin cannot be removed here.",
  REPOSITORY_CONFLICT: "The requested membership change conflicts with current state.",
};

const isoConfirmationTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export type MembershipAction = "set_general_admin" | "remove_general_admin" | "remove_administrator" | "transfer_ownership";
export type SafeMembershipDto = Membership & { capabilities: readonly MembershipAction[] };

export class MembershipAdministrationError extends Error {
  readonly name = "MembershipAdministrationError";

  constructor(readonly code: MembershipErrorCode) {
    super(publicMessages[code]);
  }
}

export interface SetGeneralAdminInput {
  businessId: BusinessId;
  membershipId: string;
}

export interface RemoveAdministratorInput {
  businessId: BusinessId;
  membershipId: string;
}

export interface TransferOwnershipInput {
  businessId: BusinessId;
  targetMembershipId: string;
  confirmationName: string;
  reauthenticatedAt: string;
}

function requireActor(actorId: UserId): void {
  if (typeof actorId !== "string" || !actorId.trim()) {
    throw new MembershipAdministrationError(MEMBERSHIP_ERROR_CODES.INSUFFICIENT_CAPABILITY);
  }
}

async function activeOwners(repository: OnboardingRepository, businessId: BusinessId): Promise<Membership[]> {
  return (await repository.listMemberships(businessId)).filter(
    (membership) => membership.businessId === businessId && membership.isActive && membership.role === "owner_admin",
  );
}

async function ensureOwnerInvariant(repository: OnboardingRepository, businessId: BusinessId): Promise<void> {
  if ((await activeOwners(repository, businessId)).length !== 1) {
    throw new MembershipAdministrationError(MEMBERSHIP_ERROR_CODES.INVARIANT_CONFLICT);
  }
}

async function requireActiveBusiness(repository: OnboardingRepository, businessId: BusinessId): Promise<void> {
  try {
    await requireBusinessOperational(repository, businessId);
  } catch (error) {
    if (error instanceof BusinessLifecycleError && error.code === LIFECYCLE_ERROR_CODES.BUSINESS_NOT_FOUND) {
      throw new MembershipAdministrationError(MEMBERSHIP_ERROR_CODES.MEMBER_NOT_FOUND);
    }
    if (error instanceof BusinessLifecycleError && error.code === LIFECYCLE_ERROR_CODES.INACTIVE_BUSINESS) {
      throw new MembershipAdministrationError(MEMBERSHIP_ERROR_CODES.INACTIVE_BUSINESS);
    }
    throw error;
  }
}

async function requireOwner(repository: OnboardingRepository, businessId: BusinessId, actorId: UserId): Promise<Membership> {
  requireActor(actorId);
  const membership = await createTenantContext(repository).getMembership(actorId, businessId);
  try {
    requireCapability(membership as Membership, "manage_general_admin");
  } catch {
    throw new MembershipAdministrationError(MEMBERSHIP_ERROR_CODES.INSUFFICIENT_CAPABILITY);
  }
  if (membership?.role !== "owner_admin" || !membership.isActive) {
    throw new MembershipAdministrationError(MEMBERSHIP_ERROR_CODES.INSUFFICIENT_CAPABILITY);
  }
  return membership;
}

async function requireMutationActor(
  repository: OnboardingRepository,
  businessId: BusinessId,
  actorId: UserId,
): Promise<Membership> {
  requireActor(actorId);
  const membership = await createTenantContext(repository).getMembership(actorId, businessId);
  if (!membership?.isActive) {
    throw new MembershipAdministrationError(MEMBERSHIP_ERROR_CODES.INSUFFICIENT_CAPABILITY);
  }
  try {
    requireCapability(membership, "remove_administrator");
  } catch {
    throw new MembershipAdministrationError(MEMBERSHIP_ERROR_CODES.INSUFFICIENT_CAPABILITY);
  }
  return membership;
}

async function findTarget(repository: OnboardingRepository, businessId: BusinessId, membershipId: string): Promise<Membership> {
  const target = (await repository.listMemberships(businessId)).find(
    (membership) => membership.businessId === businessId && membership.membershipId === membershipId,
  );
  if (!target) {
    throw new MembershipAdministrationError(MEMBERSHIP_ERROR_CODES.MEMBER_NOT_FOUND);
  }
  return target;
}

function validateConfirmation(
  input: TransferOwnershipInput,
  businessName: string,
  now = Date.now(),
): void {
  const reauthenticatedAt = Date.parse(input.reauthenticatedAt);
  if (
    input.confirmationName !== businessName ||
    !isoConfirmationTimestamp.test(input.reauthenticatedAt) ||
    !Number.isFinite(reauthenticatedAt) ||
    reauthenticatedAt > now ||
    now - reauthenticatedAt > 5 * 60 * 1000 ||
    new Date(reauthenticatedAt).toISOString() !== input.reauthenticatedAt
  ) {
    throw new MembershipAdministrationError(MEMBERSHIP_ERROR_CODES.CONFIRMATION_REQUIRED);
  }
}

export interface MembershipService {
  setGeneralAdmin(input: SetGeneralAdminInput, actor: OnboardingActor): Promise<Membership>;
  removeAdministrator(input: RemoveAdministratorInput, actor: OnboardingActor, expectedRole?: "administrator" | "general_admin"): Promise<void>;
  transferOwnership(input: TransferOwnershipInput, actor: OnboardingActor): Promise<void>;
  listMemberships(businessId: BusinessId, actor: OnboardingActor): Promise<SafeMembershipDto[]>;
}

function capabilitiesFor(actor: Membership, target: Membership): readonly MembershipAction[] {
  if (!actor.isActive || !target.isActive || target.role === "owner_admin") return [];
  if (actor.role === "general_admin") {
    return target.role === "administrator" ? ["remove_administrator"] : [];
  }
  if (actor.role !== "owner_admin") return [];
  if (target.role === "administrator") return ["set_general_admin", "remove_administrator", "transfer_ownership"];
  if (target.role === "general_admin") return ["remove_general_admin", "transfer_ownership"];
  return [];
}

export function createMembershipService(repository: OnboardingRepository = defaultOnboardingRepository): MembershipService {
  return {
    async setGeneralAdmin(input, actor) {
      const actorId = await resolveOnboardingActor(repository, actor);
      await requireActiveBusiness(repository, input.businessId);
      await requireOwner(repository, input.businessId, actorId);
      const target = await findTarget(repository, input.businessId, input.membershipId);
      if (target.role !== "administrator" || !target.isActive) {
        throw new MembershipAdministrationError(MEMBERSHIP_ERROR_CODES.INVALID_TARGET);
      }

      return repository.transaction(async (transaction) => {
        await ensureOwnerInvariant(transaction, input.businessId);
        const current = await findTarget(transaction, input.businessId, input.membershipId);
        if (current.role !== "administrator" || !current.isActive) {
          throw new MembershipAdministrationError(MEMBERSHIP_ERROR_CODES.REPOSITORY_CONFLICT);
        }
        current.role = "general_admin";
        await transaction.updateMembership(current);
        await transaction.appendAuditEvent({ businessId: input.businessId, actorId, type: "membership_role_changed", entityId: current.membershipId });
        return { ...current };
      });
    },

    async removeAdministrator(input, actor, expectedRole) {
      const actorId = await resolveOnboardingActor(repository, actor);
      await requireActiveBusiness(repository, input.businessId);
      const actorMembership = await requireMutationActor(repository, input.businessId, actorId);
      const target = await findTarget(repository, input.businessId, input.membershipId);
      if (target.role === "owner_admin") {
        throw new MembershipAdministrationError(MEMBERSHIP_ERROR_CODES.OWNER_PROTECTED);
      }
      if (expectedRole && target.role !== expectedRole) {
        throw new MembershipAdministrationError(MEMBERSHIP_ERROR_CODES.INVALID_TARGET);
      }
      if (target.role === "general_admin" && actorMembership.role !== "owner_admin") {
        throw new MembershipAdministrationError(MEMBERSHIP_ERROR_CODES.INSUFFICIENT_CAPABILITY);
      }
      if (target.role !== "administrator" && target.role !== "general_admin") {
        throw new MembershipAdministrationError(MEMBERSHIP_ERROR_CODES.INVALID_TARGET);
      }

      await repository.transaction(async (transaction) => {
        await ensureOwnerInvariant(transaction, input.businessId);
        const current = await findTarget(transaction, input.businessId, input.membershipId).catch(() => null);
        if (!current) {
          throw new MembershipAdministrationError(MEMBERSHIP_ERROR_CODES.REPOSITORY_CONFLICT);
        }
        if (current.role === "owner_admin") {
          throw new MembershipAdministrationError(MEMBERSHIP_ERROR_CODES.OWNER_PROTECTED);
        }
        if (expectedRole && current.role !== expectedRole) {
          throw new MembershipAdministrationError(MEMBERSHIP_ERROR_CODES.REPOSITORY_CONFLICT);
        }
        if (current.role === "general_admin" && actorMembership.role !== "owner_admin") {
          throw new MembershipAdministrationError(MEMBERSHIP_ERROR_CODES.INSUFFICIENT_CAPABILITY);
        }
        await transaction.deleteMembership(current.membershipId);
        await transaction.appendAuditEvent({ businessId: input.businessId, actorId, type: "membership_removed", entityId: current.membershipId });
      });
    },

    async transferOwnership(input, actor) {
      const actorId = await resolveOnboardingActor(repository, actor);
      await requireActiveBusiness(repository, input.businessId);
      await requireOwner(repository, input.businessId, actorId);
      const business = await repository.findBusiness(input.businessId);
      if (!business) {
        throw new MembershipAdministrationError(MEMBERSHIP_ERROR_CODES.MEMBER_NOT_FOUND);
      }
      validateConfirmation(input, business.name);
      const target = await findTarget(repository, input.businessId, input.targetMembershipId);
      if (!target.isActive || (target.role !== "administrator" && target.role !== "general_admin")) {
        throw new MembershipAdministrationError(MEMBERSHIP_ERROR_CODES.INVALID_TARGET);
      }

      await repository.transaction(async (transaction) => {
        await ensureOwnerInvariant(transaction, input.businessId);
        const owner = (await transaction.listMemberships(input.businessId)).find(
          (membership) => membership.userId === actorId,
        );
        const currentTarget = await findTarget(transaction, input.businessId, input.targetMembershipId);
        if (!owner || owner.role !== "owner_admin" || !owner.isActive || !currentTarget.isActive || currentTarget.role === "owner_admin") {
          throw new MembershipAdministrationError(MEMBERSHIP_ERROR_CODES.REPOSITORY_CONFLICT);
        }
        owner.role = "administrator";
        currentTarget.role = "owner_admin";
        await transaction.updateMembership(owner);
        await transaction.updateMembership(currentTarget);
        await ensureOwnerInvariant(transaction, input.businessId);
        await transaction.appendAuditEvent({ businessId: input.businessId, actorId, type: "ownership_transferred", entityId: currentTarget.membershipId });
      });
    },

    async listMemberships(businessId, actor) {
      const actorId = await resolveOnboardingActor(repository, actor);
      await requireActiveBusiness(repository, businessId);
      const actorMembership = await requireMutationActor(repository, businessId, actorId);
      if (actorMembership.role !== "owner_admin" && actorMembership.role !== "general_admin") {
        throw new MembershipAdministrationError(MEMBERSHIP_ERROR_CODES.INSUFFICIENT_CAPABILITY);
      }
      return (await repository.listMemberships(businessId))
        .map((membership) => ({ ...membership, capabilities: capabilitiesFor(actorMembership, membership) }));
    },
  };
}

export const setGeneralAdmin = (input: SetGeneralAdminInput, actor: OnboardingActor, repository = defaultOnboardingRepository) =>
  createMembershipService(repository).setGeneralAdmin(input, actor);
export const removeAdministrator = (input: RemoveAdministratorInput, actor: OnboardingActor, repository = defaultOnboardingRepository) =>
  createMembershipService(repository).removeAdministrator(input, actor);
export const transferOwnership = (input: TransferOwnershipInput, actor: OnboardingActor, repository = defaultOnboardingRepository) =>
  createMembershipService(repository).transferOwnership(input, actor);
