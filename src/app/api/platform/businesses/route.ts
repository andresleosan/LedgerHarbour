import { NextResponse } from "next/server";

import { getCurrentIdentity } from "../../../../modules/auth/session";
import {
  createPlatformService,
  PlatformError,
  PLATFORM_ERROR_CODES,
} from "../../../../modules/platform/platform-service";
import { getPersistenceContext } from "../../../../modules/persistence/repository-factory";

function errorResponse(error: unknown): NextResponse {
  if (error instanceof PlatformError) {
    const status = error.code === PLATFORM_ERROR_CODES.PLATFORM_ACCESS_DENIED ? 403 : error.code === PLATFORM_ERROR_CODES.BUSINESS_NOT_FOUND ? 404 : 409;
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status });
  }
  return NextResponse.json({ error: { code: "PLATFORM_REQUEST_FAILED", message: "The platform request could not be completed." } }, { status: 500 });
}

export async function GET() {
  const identity = await getCurrentIdentity();
  if (!identity) return NextResponse.json({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } }, { status: 401 });
  try {
    const persistence = getPersistenceContext();
    const businesses = await createPlatformService({
      tenancyRepository: persistence.tenancyRepository,
      platformRepository: persistence.platformRepository,
    }).listBusinesses(identity);
    return NextResponse.json({ businesses }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
