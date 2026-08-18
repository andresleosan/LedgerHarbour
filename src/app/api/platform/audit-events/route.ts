import { NextResponse } from "next/server";

import { getCurrentIdentity } from "../../../../modules/auth/session";
import { platformRateLimitResponse } from "../../../../modules/platform/platform-route-security";
import { listPlatformAuditEvents } from "../../../../modules/platform/platform-summary";
import { PlatformError, PLATFORM_ERROR_CODES } from "../../../../modules/platform/platform-service";
import { getPersistenceContext } from "../../../../modules/persistence/repository-factory";

export async function GET(request: Request) {
  const identity = await getCurrentIdentity();
  if (!identity) return NextResponse.json({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } }, { status: 401 });
  const limited = await platformRateLimitResponse(request, identity);
  if (limited) return limited;
  try {
    const persistence = getPersistenceContext();
    const events = await listPlatformAuditEvents(identity, persistence.platformRepository, persistence.tenancyRepository);
    return NextResponse.json({ events }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof PlatformError && error.code === PLATFORM_ERROR_CODES.PLATFORM_ACCESS_DENIED) {
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: 403 });
    }
    return NextResponse.json({ error: { code: "PLATFORM_REQUEST_FAILED", message: "The platform request could not be completed." } }, { status: 500 });
  }
}
