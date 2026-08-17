import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentIdentity } from "../../../../../../modules/auth/session";
import { createProjectService, ProjectError, PROJECT_ERROR_CODES } from "../../../../../../modules/projects/project-service";
import { getPersistenceContext } from "../../../../../../modules/persistence/repository-factory";
import { platformRateLimitResponse } from "../../../../../../modules/platform/platform-route-security";

const inputSchema = z.object({ reason: z.string().trim().min(1).max(1000) }).strict();
type RouteContext = { params: Promise<{ projectId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const identity = await getCurrentIdentity();
  if (!identity) return NextResponse.json({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } }, { status: 401 });
  const limited = await platformRateLimitResponse(request, identity);
  if (limited) return limited;
  let body: unknown;
  try { body = await request.json(); } catch { body = null; }
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: { code: PROJECT_ERROR_CODES.REASON_REQUIRED, message: "A reason is required for this action." } }, { status: 400 });
  try {
    const persistence = getPersistenceContext();
    const project = await createProjectService({ tenancyRepository: persistence.tenancyRepository, projectRepository: persistence.projectRepository, platformRepository: persistence.platformRepository })
      .suspendProject((await context.params).projectId, identity, parsed.data);
    return NextResponse.json({ project });
  } catch (error) {
    if (error instanceof ProjectError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.code === PROJECT_ERROR_CODES.PLATFORM_ACCESS_DENIED ? 403 : error.code === PROJECT_ERROR_CODES.PROJECT_NOT_FOUND ? 404 : 409 });
    return NextResponse.json({ error: { code: "PLATFORM_PROJECT_REQUEST_FAILED", message: "The platform project request could not be completed." } }, { status: 500 });
  }
}
