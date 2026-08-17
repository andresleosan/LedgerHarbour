import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentIdentity } from "../../../../modules/auth/session";
import { createProjectService, ProjectError, PROJECT_ERROR_CODES, ProjectStatus } from "../../../../modules/projects/project-service";
import { getPersistenceContext } from "../../../../modules/persistence/repository-factory";
import { platformRateLimitResponse } from "../../../../modules/platform/platform-route-security";

const statusSchema = z.enum(ProjectStatus);

function errorResponse(error: unknown): NextResponse {
  if (error instanceof ProjectError) {
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.code === PROJECT_ERROR_CODES.PLATFORM_ACCESS_DENIED ? 403 : 409 });
  }
  return NextResponse.json({ error: { code: "PLATFORM_PROJECT_REQUEST_FAILED", message: "The platform project request could not be completed." } }, { status: 500 });
}

export async function GET(request: Request) {
  const identity = await getCurrentIdentity();
  if (!identity) return NextResponse.json({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } }, { status: 401 });
  const limited = await platformRateLimitResponse(request, identity);
  if (limited) return limited;
  const rawStatus = new URL(request.url).searchParams.get("status") ?? undefined;
  const status = rawStatus === undefined ? undefined : statusSchema.safeParse(rawStatus);
  if (status && !status.success) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "The request is invalid." } }, { status: 400 });
  try {
    const persistence = getPersistenceContext();
    const projects = await createProjectService({
      tenancyRepository: persistence.tenancyRepository,
      projectRepository: persistence.projectRepository,
      platformRepository: persistence.platformRepository,
    }).listProjects(identity, status && status.success ? status.data : undefined);
    return NextResponse.json({ projects }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
