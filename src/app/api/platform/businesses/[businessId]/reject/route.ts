import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentIdentity } from "../../../../../../modules/auth/session";
import { createPlatformService, PlatformError, PLATFORM_ERROR_CODES, toPlatformBusinessDto } from "../../../../../../modules/platform/platform-service";
import { getPersistenceContext } from "../../../../../../modules/persistence/repository-factory";
import { platformRateLimitResponse } from "../../../../../../modules/platform/platform-route-security";
import type { BusinessId } from "../../../../../../modules/tenancy/types";

const inputSchema = z.object({ reason: z.string().trim().min(1).max(1000) }).strict();
type RouteContext = { params: Promise<{ businessId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const identity = await getCurrentIdentity();
  if (!identity) return NextResponse.json({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } }, { status: 401 });
  const limited = await platformRateLimitResponse(request, identity);
  if (limited) return limited;
  let body: unknown;
  try { body = await request.json(); } catch { body = null; }
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: { code: PLATFORM_ERROR_CODES.REASON_REQUIRED, message: "A reason is required for this action." } }, { status: 400 });
  try {
    const persistence = getPersistenceContext();
    const business = await createPlatformService({ tenancyRepository: persistence.tenancyRepository, platformRepository: persistence.platformRepository })
      .rejectBusiness((await context.params).businessId as BusinessId, identity, parsed.data);
    return NextResponse.json({ business: toPlatformBusinessDto(business) });
  } catch (error) {
    if (error instanceof PlatformError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.code === PLATFORM_ERROR_CODES.PLATFORM_ACCESS_DENIED ? 403 : 409 });
    return NextResponse.json({ error: { code: "PLATFORM_REQUEST_FAILED", message: "The platform request could not be completed." } }, { status: 500 });
  }
}
