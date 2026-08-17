import { NextResponse } from "next/server";

import { getCurrentIdentity } from "../../../../modules/auth/session";
import {
  createPlatformService,
  PlatformError,
  PLATFORM_ERROR_CODES,
} from "../../../../modules/platform/platform-service";
import { getPersistenceContext } from "../../../../modules/persistence/repository-factory";
import { enforceAuthenticatedRateLimit } from "../../../../modules/security/authenticated-rate-limit";
import {
  AuthenticatedRateLimitError,
  AuthenticatedRateLimitUnavailableError,
} from "../../../../modules/security/rate-limit-errors";

function errorResponse(error: unknown): NextResponse {
  if (error instanceof PlatformError) {
    const status = error.code === PLATFORM_ERROR_CODES.PLATFORM_ACCESS_DENIED ? 403 : 500;
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status });
  }
  return NextResponse.json({ error: { code: "PLATFORM_REQUEST_FAILED", message: "The platform request could not be completed." } }, { status: 500 });
}

export async function GET(request: Request) {
  const identity = await getCurrentIdentity();
  if (!identity) return NextResponse.json({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } }, { status: 401 });
  try {
    await enforceAuthenticatedRateLimit("platform-administration", identity.providerUserId, request.headers);
  } catch (error) {
    if (error instanceof AuthenticatedRateLimitError) return NextResponse.json({ error: { code: "RATE_LIMITED", message: "Too many requests." } }, { status: 429 });
    if (error instanceof AuthenticatedRateLimitUnavailableError) return NextResponse.json({ error: { code: "RATE_LIMIT_UNAVAILABLE", message: "Platform protection is temporarily unavailable." } }, { status: 503 });
    return NextResponse.json({ error: { code: "RATE_LIMIT_UNAVAILABLE", message: "Platform protection is temporarily unavailable." } }, { status: 503 });
  }
  try {
    const persistence = getPersistenceContext();
    const administrators = await createPlatformService({
      tenancyRepository: persistence.tenancyRepository,
      platformRepository: persistence.platformRepository,
    }).listAdministrators(identity);
    return NextResponse.json({ administrators }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
