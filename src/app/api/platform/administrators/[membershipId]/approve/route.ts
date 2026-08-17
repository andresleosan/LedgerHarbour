import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentIdentity } from "../../../../../../modules/auth/session";
import {
  createPlatformService,
  PlatformError,
  PLATFORM_ERROR_CODES,
} from "../../../../../../modules/platform/platform-service";
import { getPersistenceContext } from "../../../../../../modules/persistence/repository-factory";
import { platformRateLimitResponse } from "../../../../../../modules/platform/platform-route-security";

const inputSchema = z.object({ reason: z.string().trim().max(1000).optional() }).strict();
type RouteContext = { params: Promise<{ membershipId: string }> };

function errorResponse(error: unknown): NextResponse {
  if (error instanceof PlatformError) {
    const status = error.code === PLATFORM_ERROR_CODES.PLATFORM_ACCESS_DENIED ? 403 : error.code === PLATFORM_ERROR_CODES.ADMINISTRATOR_NOT_FOUND ? 404 : 409;
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status });
  }
  return NextResponse.json({ error: { code: "PLATFORM_REQUEST_FAILED", message: "The platform request could not be completed." } }, { status: 500 });
}

export async function POST(request: Request, context: RouteContext) {
  const identity = await getCurrentIdentity();
  if (!identity) return NextResponse.json({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } }, { status: 401 });
  const limited = await platformRateLimitResponse(request, identity);
  if (limited) return limited;
  let body: unknown;
  try { body = await request.json(); } catch { body = {}; }
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "The request is invalid." } }, { status: 400 });
  try {
    const persistence = getPersistenceContext();
    const administrator = await createPlatformService({
      tenancyRepository: persistence.tenancyRepository,
      platformRepository: persistence.platformRepository,
    }).approveAdministrator((await context.params).membershipId, identity, parsed.data);
    return NextResponse.json({ administrator });
  } catch (error) {
    return errorResponse(error);
  }
}
