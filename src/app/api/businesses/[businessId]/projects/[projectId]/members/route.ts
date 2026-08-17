import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentIdentity } from "../../../../../../../modules/auth/session";
import { authenticatedRateLimitResponse } from "../../../../../../../modules/security/authenticated-rate-limit";
import { getPersistenceContext } from "../../../../../../../modules/persistence/repository-factory";
import { createProjectService, ProjectError, PROJECT_ERROR_CODES } from "../../../../../../../modules/projects/project-service";
import type { BusinessId, UserId } from "../../../../../../../modules/tenancy/types";

const memberSchema = z.object({ userId: z.string().trim().min(1).max(200), role: z.literal("member") }).strict();
type RouteContext = { params: Promise<{ businessId: string; projectId: string }> };

function errorResponse(error: unknown): NextResponse {
  if (error instanceof ProjectError) {
    const status = error.code === PROJECT_ERROR_CODES.BUSINESS_ACCESS_DENIED ? 403 :
      error.code === PROJECT_ERROR_CODES.PROJECT_NOT_FOUND ? 404 :
      error.code === PROJECT_ERROR_CODES.REPOSITORY_CONFLICT ? 409 : 400;
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status });
  }
  return NextResponse.json({ error: { code: "PROJECT_MEMBER_REQUEST_FAILED", message: "The project membership request could not be completed." } }, { status: 500 });
}

export async function GET(_request: Request, context: RouteContext) {
  const identity = await getCurrentIdentity();
  if (!identity) return NextResponse.json({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } }, { status: 401 });
  try {
    const params = await context.params;
    const persistence = getPersistenceContext();
    const members = await createProjectService({
      tenancyRepository: persistence.tenancyRepository,
      projectRepository: persistence.projectRepository,
      platformRepository: persistence.platformRepository,
    }).listProjectMembers(params.businessId as BusinessId, params.projectId, identity);
    return NextResponse.json({ members }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const identity = await getCurrentIdentity();
  if (!identity) return NextResponse.json({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } }, { status: 401 });
  const limited = await authenticatedRateLimitResponse("project-membership", request, identity);
  if (limited) return limited;
  let body: unknown;
  try { body = await request.json(); } catch { body = null; }
  const parsed = memberSchema.safeParse(body);
  if (!parsed.success) return errorResponse(new ProjectError(PROJECT_ERROR_CODES.INVALID_MEMBER));
  try {
    const params = await context.params;
    const persistence = getPersistenceContext();
    const member = await createProjectService({
      tenancyRepository: persistence.tenancyRepository,
      projectRepository: persistence.projectRepository,
      platformRepository: persistence.platformRepository,
    }).addProjectMember(params.businessId as BusinessId, params.projectId, identity, { ...parsed.data, userId: parsed.data.userId as UserId });
    return NextResponse.json(member, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
