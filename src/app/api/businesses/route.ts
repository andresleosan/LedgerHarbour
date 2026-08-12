import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentIdentity } from "../../../modules/auth/session";
import {
  createBusiness,
  OnboardingError,
  ONBOARDING_ERROR_CODES,
  type CreateBusinessInput,
} from "../../../modules/tenancy/business-service";

const createBusinessSchema = z.object({ name: z.string() });

function errorResponse(error: unknown): NextResponse {
  if (error instanceof OnboardingError) {
    const status = error.code === ONBOARDING_ERROR_CODES.DUPLICATE_MEMBERSHIP ||
      error.code === ONBOARDING_ERROR_CODES.PENDING_REQUEST_CONFLICT ||
      error.code === ONBOARDING_ERROR_CODES.REPOSITORY_CONFLICT ? 409 : 400;
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status });
  }
  return NextResponse.json(
    { error: { code: "INVALID_REQUEST", message: "The request could not be completed." } },
    { status: 400 },
  );
}

export async function POST(request: Request) {
  const identity = getCurrentIdentity();
  if (!identity) {
    return NextResponse.json(
      { error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } },
      { status: 401 },
    );
  }

  let input: CreateBusinessInput;
  try {
    input = createBusinessSchema.parse(await request.json());
  } catch {
    return errorResponse(new OnboardingError(ONBOARDING_ERROR_CODES.INVALID_BUSINESS_NAME));
  }

  try {
    const business = await createBusiness(input, identity);
    return NextResponse.json(business, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
