import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentIdentity } from "../../../../../../modules/auth/session";
import {
  createPlatformService,
  PlatformError,
  PLATFORM_ERROR_CODES,
} from "../../../../../../modules/platform/platform-service";
import { getPersistenceContext } from "../../../../../../modules/persistence/repository-factory";
import { enforceAuthenticatedRateLimit } from "../../../../../../modules/security/authenticated-rate-limit";
import {
  AuthenticatedRateLimitError,
  AuthenticatedRateLimitUnavailableError,
} from "../../../../../../modules/security/rate-limit-errors";

const inputSchema = z.object({
  action: z.union([z.literal("suspend"), z.literal("revoke")]),
  reason: z.string().trim().min(1).max(1000),
}).strict();
type RouteContext = { params: Promise<{ membershipId: string }> };

function errorResponse(error: unknown): NextResponse {
  if (error instanceof PlatformError) {
    const status = error.code === PLATFORM_ERROR_CODES.PLATFORM_ACCESS_DENIED ? 403 : error.code === PLATFORM_ERROR_CODES.ADMINISTRATOR_NOT_FOUND ? 404 : error.code === PLATFORM_ERROR_CODES.REASON_REQUIRED ? 400 : 409;
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status });
  }
  return NextResponse.json({ error: { code: "PLATFORM_REQUEST_FAILED", message: "The platform request could not be completed." } }, { status: 500 });
}

export async function POST(request: Request, context: RouteContext) {
  const identity = await getCurrentIdentity();
  if (!identity) return NextResponse.json({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } }, { status: 401 });
  try {
    await enforceAuthenticatedRateLimit("platform-administration", identity.providerUserId, request.headers);
  } catch (error) {
    if (error instanceof AuthenticatedRateLimitError) return NextResponse.json({ error: { code: "RATE_LIMITED", message: "Too many requests." } }, { status: 429 });
    if (error instanceof AuthenticatedRateLimitUnavailableError) return NextResponse.json({ error: { code: "RATE_LIMIT_UNAVAILABLE", message: "Platform protection is temporarily unavailable." } }, { status: 503 });
    return NextResponse.json({ error: { code: "RATE_LIMIT_UNAVAILABLE", message: "Platform protection is temporarily unavailable." } }, { status: 503 });
  }
  let body: unknown;
  try { body = await request.json(); } catch { body = null; }
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: { code: PLATFORM_ERROR_CODES.REASON_REQUIRED, message: "A reason is required for this action." } }, { status: 400 });
  try {
    const persistence = getPersistenceContext();
    const administrator = await createPlatformService({
      tenancyRepository: persistence.tenancyRepository,
      platformRepository: persistence.platformRepository,
    }).suspendAdministrator((await context.params).membershipId, identity, parsed.data);
    return NextResponse.json({ administrator });
  } catch (error) {
    return errorResponse(error);
  }
}
