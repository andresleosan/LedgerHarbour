import { requireCapability } from "../permissions/authorize";
import {
  OnboardingError,
  ONBOARDING_ERROR_CODES,
  type CreateJoinRequestInput,
  type JoinRequest,
  type JoinRequestStatusDto,
  type OnboardingRepository,
  type OnboardingActor,
  resolveOnboardingActor,
  type ReviewJoinRequestInput,
} from "./business-service";
import { createTenantContext } from "./tenant-context";
import { randomUUID } from "node:crypto";
import type { BusinessId, Membership } from "./types";

function validateRequestInput(input: CreateJoinRequestInput): void {
  if (input?.requestedRole !== "administrator") {
    throw new OnboardingError(ONBOARDING_ERROR_CODES.INVALID_REQUEST_ROLE);
  }
}

function assertPending(request: JoinRequest): void {
  if (request.status !== "pending") {
    throw new OnboardingError(ONBOARDING_ERROR_CODES.INVALID_TRANSITION);
  }
}

export interface JoinRequestService {
  requestMembership(input: CreateJoinRequestInput, actor: OnboardingActor): Promise<JoinRequest>;
  listJoinRequests(businessId: BusinessId, actor: OnboardingActor): Promise<JoinRequest[]>;
  listUserJoinRequests(businessId: BusinessId, actor: OnboardingActor): Promise<JoinRequestStatusDto[]>;
  reviewJoinRequest(input: ReviewJoinRequestInput, actor: OnboardingActor): Promise<JoinRequest>;
}

export function createJoinRequestService(repository: OnboardingRepository): JoinRequestService {
  const tenant = createTenantContext(repository);

  return {
    async requestMembership(input, actorId) {
      validateRequestInput(input);
      const business = await repository.findBusiness(input.businessId);
      if (!business) {
        throw new OnboardingError(ONBOARDING_ERROR_CODES.MISSING_BUSINESS);
      }
      if (!business.isActive) {
        throw new OnboardingError(ONBOARDING_ERROR_CODES.INACTIVE_BUSINESS);
      }

      return repository.transaction(async (transaction) => {
        const requesterId = await resolveOnboardingActor(transaction, actorId);
        if (await transaction.findMembership(requesterId, input.businessId)) {
          throw new OnboardingError(ONBOARDING_ERROR_CODES.DUPLICATE_MEMBERSHIP);
        }
        return transaction.createJoinRequest({
          businessId: input.businessId,
          requesterId,
          requestedRole: "administrator",
          status: "pending",
        });
      });
    },

    async listJoinRequests(businessId, actorId) {
      const resolvedActorId = await resolveOnboardingActor(repository, actorId);
      let membership: Membership;
      try {
        membership = await tenant.requireBusinessAccess(resolvedActorId, businessId);
      } catch {
        throw new OnboardingError(ONBOARDING_ERROR_CODES.INSUFFICIENT_CAPABILITY);
      }
      try {
        requireCapability(membership, "approve_administrator");
      } catch {
        throw new OnboardingError(ONBOARDING_ERROR_CODES.INSUFFICIENT_CAPABILITY);
      }
      return repository.listJoinRequests(businessId);
    },

    async listUserJoinRequests(businessId, actorId) {
      const resolvedActorId = await resolveOnboardingActor(repository, actorId);
      const business = await repository.findBusiness(businessId);
      if (!business) {
        throw new OnboardingError(ONBOARDING_ERROR_CODES.MISSING_BUSINESS);
      }
      if (!business.isActive) {
        throw new OnboardingError(ONBOARDING_ERROR_CODES.INACTIVE_BUSINESS);
      }
      const requests = await repository.listUserJoinRequests(businessId, resolvedActorId);
      return requests
        .slice()
        .sort((left, right) => {
          const createdAtOrder = left.createdAt.localeCompare(right.createdAt);
          return createdAtOrder || left.id.localeCompare(right.id, undefined, { numeric: true });
        })
        .map(({ status }) => ({ status }));
    },

    async reviewJoinRequest(input, actorId) {
      const resolvedActorId = await resolveOnboardingActor(repository, actorId);
      if (input?.decision !== "approved" && input?.decision !== "rejected") {
        throw new OnboardingError(ONBOARDING_ERROR_CODES.INVALID_TRANSITION);
      }

      let membership: Membership;
      try {
        membership = await tenant.requireBusinessAccess(resolvedActorId, input.businessId);
      } catch {
        throw new OnboardingError(ONBOARDING_ERROR_CODES.INSUFFICIENT_CAPABILITY);
      }
      try {
        requireCapability(membership, "approve_administrator");
      } catch {
        throw new OnboardingError(ONBOARDING_ERROR_CODES.INSUFFICIENT_CAPABILITY);
      }

      const request = await repository.findJoinRequest(input.joinRequestId);
      if (!request || request.businessId !== input.businessId) {
        throw new OnboardingError(ONBOARDING_ERROR_CODES.HIDDEN_REQUEST);
      }
      assertPending(request);

      return repository.transaction(async (transaction) => {
        const current = await transaction.findJoinRequest(input.joinRequestId);
        if (!current || current.businessId !== input.businessId) {
          throw new OnboardingError(ONBOARDING_ERROR_CODES.HIDDEN_REQUEST);
        }
        if (current.status !== "pending") {
          throw new OnboardingError(ONBOARDING_ERROR_CODES.REPOSITORY_CONFLICT);
        }
        const reviewedAt = new Date().toISOString();
        const reviewed: JoinRequest = {
          ...current,
          status: input.decision,
          reviewerId: resolvedActorId,
          reviewedAt,
        };

        const claimed = await transaction.updateJoinRequest({ ...current, ...reviewed });

        if (input.decision === "approved") {
          if (await transaction.findMembership(current.requesterId, current.businessId)) {
            throw new OnboardingError(ONBOARDING_ERROR_CODES.REPOSITORY_CONFLICT);
          }
          await transaction.createMembership({
            membershipId: randomUUID(),
            userId: current.requesterId,
            businessId: current.businessId,
            role: "administrator",
            isActive: true,
          });
          await transaction.appendAuditEvent({
            businessId: current.businessId,
            actorId: resolvedActorId,
            type: "join_request_approved",
            entityId: current.id,
          });
        } else {
          await transaction.appendAuditEvent({
            businessId: current.businessId,
            actorId: resolvedActorId,
            type: "join_request_rejected",
            entityId: current.id,
          });
        }

        return claimed;
      });
    },
  };
}

export async function requestMembership(
  input: CreateJoinRequestInput,
  actorId: OnboardingActor,
  repository: OnboardingRepository,
): Promise<JoinRequest> {
  return createJoinRequestService(repository).requestMembership(input, actorId);
}

export async function reviewJoinRequest(
  input: ReviewJoinRequestInput,
  actorId: OnboardingActor,
  repository: OnboardingRepository,
): Promise<JoinRequest> {
  return createJoinRequestService(repository).reviewJoinRequest(input, actorId);
}
