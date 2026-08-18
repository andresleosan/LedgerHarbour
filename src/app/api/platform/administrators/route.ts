import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentIdentity } from "../../../../modules/auth/session";
import {
  createPlatformService,
  PlatformError,
  PLATFORM_ERROR_CODES,
} from "../../../../modules/platform/platform-service";
import { getPersistenceContext } from "../../../../modules/persistence/repository-factory";
import { platformRateLimitResponse } from "../../../../modules/platform/platform-route-security";

const addPlatformAdministratorSchema = z.object({
  email: z.string().trim().email().max(320),
  reason: z.string().trim().min(1).max(1000),
}).strict();

function errorResponse(error: unknown): NextResponse {
  if (error instanceof PlatformError) {
    const status = error.code === PLATFORM_ERROR_CODES.PLATFORM_ACCESS_DENIED ? 403 :
      error.code === PLATFORM_ERROR_CODES.PLATFORM_ADMIN_NOT_FOUND ? 404 :
      error.code === PLATFORM_ERROR_CODES.INVALID_PLATFORM_ADMIN_EMAIL || error.code === PLATFORM_ERROR_CODES.REASON_REQUIRED ? 400 :
      error.code === PLATFORM_ERROR_CODES.DUPLICATE_PLATFORM_ADMIN || error.code === PLATFORM_ERROR_CODES.LAST_PLATFORM_ADMIN || error.code === PLATFORM_ERROR_CODES.REPOSITORY_CONFLICT ? 409 : 500;
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status });
  }
  return NextResponse.json({ error: { code: "PLATFORM_REQUEST_FAILED", message: "The platform request could not be completed." } }, { status: 500 });
}

export async function GET(request: Request) {
  const identity = await getCurrentIdentity();
  if (!identity) return NextResponse.json({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } }, { status: 401 });
  const limited = await platformRateLimitResponse(request, identity);
  if (limited) return limited;
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

export async function POST(request: Request) {
  const identity = await getCurrentIdentity();
  if (!identity) return NextResponse.json({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } }, { status: 401 });
  const limited = await platformRateLimitResponse(request, identity);
  if (limited) return limited;
  let body: unknown;
  try { body = await request.json(); } catch { body = null; }
  const parsed = addPlatformAdministratorSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "The request is invalid." } }, { status: 400 });
  try {
    const persistence = getPersistenceContext();
    const platformAdministrator = await createPlatformService({
      tenancyRepository: persistence.tenancyRepository,
      platformRepository: persistence.platformRepository,
    }).addPlatformAdministrator(identity, parsed.data);
    return NextResponse.json({ platformAdministrator }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
