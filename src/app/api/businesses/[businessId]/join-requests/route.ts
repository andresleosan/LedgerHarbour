import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentIdentity } from "../../../../../modules/auth/session";
import {
  createOnboardingServices,
  OnboardingError,
  ONBOARDING_ERROR_CODES,
} from "../../../../../modules/tenancy/business-service";
import type { BusinessId } from "../../../../../modules/tenancy/types";
import { getPersistenceContext } from "../../../../../modules/persistence/repository-factory";

const requestSchema = z.object({ requestedRole: z.literal("administrator") });
const reviewSchema = z.object({
  joinRequestId: z.string().trim().min(1),
  decision: z.union([z.literal("approved"), z.literal("rejected")]),
});
const listQuerySchema = z.object({ mine: z.literal("true").optional() });

type RouteContext = { params: Promise<{ businessId: string }> };

function responseForError(error: unknown, missingBusinessStatus: 400 | 404 = 404): NextResponse {
  if (error instanceof OnboardingError) {
    const status = error.code === ONBOARDING_ERROR_CODES.INSUFFICIENT_CAPABILITY ? 403 :
      error.code === ONBOARDING_ERROR_CODES.HIDDEN_REQUEST ? 404 :
        error.code === ONBOARDING_ERROR_CODES.MISSING_BUSINESS ? missingBusinessStatus :
        error.code === ONBOARDING_ERROR_CODES.DUPLICATE_MEMBERSHIP ||
        error.code === ONBOARDING_ERROR_CODES.PENDING_REQUEST_CONFLICT ||
        error.code === ONBOARDING_ERROR_CODES.REPOSITORY_CONFLICT ? 409 : 400;
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status });
  }
  return NextResponse.json(
    { error: { code: "REQUEST_FAILED", message: "The request could not be completed." } },
    { status: 400 },
  );
}

async function identityOr401() {
  const identity = await getCurrentIdentity();
  return identity ? { identity } : null;
}

export async function POST(request: Request, context: RouteContext) {
  const session = await identityOr401();
  if (!session) {
    return NextResponse.json(
      { error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } },
      { status: 401 },
    );
  }
  const { businessId } = await context.params;
  let input: z.infer<typeof requestSchema>;
  try {
    input = requestSchema.parse(await request.json());
  } catch {
    return responseForError(new OnboardingError(ONBOARDING_ERROR_CODES.INVALID_REQUEST_ROLE));
  }

  try {
    const persistence = getPersistenceContext();
    const result = await createOnboardingServices(persistence.tenancyRepository).requestMembership(
      { businessId: businessId as BusinessId, requestedRole: input.requestedRole },
      session.identity,
    );
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return responseForError(error, 400);
  }
}

export async function GET(request: Request, context: RouteContext) {
  const session = await identityOr401();
  if (!session) {
    return NextResponse.json(
      { error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } },
      { status: 401 },
    );
  }
  const { businessId } = await context.params;
  const query = listQuerySchema.safeParse({ mine: new URL(request.url).searchParams.get("mine") ?? undefined });
  if (!query.success) {
    return responseForError(new OnboardingError(ONBOARDING_ERROR_CODES.INVALID_TRANSITION));
  }
  try {
    const persistence = getPersistenceContext();
    const services = createOnboardingServices(persistence.tenancyRepository);
    const result = query.data.mine
      ? await services.listUserJoinRequests(businessId as BusinessId, session.identity)
      : await services.listJoinRequests(businessId as BusinessId, session.identity);
    return NextResponse.json(result);
  } catch (error) {
    return responseForError(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const session = await identityOr401();
  if (!session) {
    return NextResponse.json(
      { error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } },
      { status: 401 },
    );
  }
  const { businessId } = await context.params;
  let input: z.infer<typeof reviewSchema>;
  try {
    input = reviewSchema.parse(await request.json());
  } catch {
    return responseForError(new OnboardingError(ONBOARDING_ERROR_CODES.INVALID_TRANSITION));
  }

  try {
    const persistence = getPersistenceContext();
    const result = await createOnboardingServices(persistence.tenancyRepository).reviewJoinRequest(
      { ...input, businessId: businessId as BusinessId },
      session.identity,
    );
    return NextResponse.json(result);
  } catch (error) {
    return responseForError(error);
  }
}
