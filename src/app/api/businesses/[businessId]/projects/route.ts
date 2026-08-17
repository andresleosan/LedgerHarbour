import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentIdentity } from "../../../../../modules/auth/session";
import {
  createProjectService,
  ProjectError,
  PROJECT_ERROR_CODES,
} from "../../../../../modules/projects/project-service";
import { getPersistenceContext } from "../../../../../modules/persistence/repository-factory";
import type { BusinessId } from "../../../../../modules/tenancy/types";

const projectSchema = z.object({ name: z.string().trim().min(1).max(160) }).strict();
type RouteContext = { params: Promise<{ businessId: string }> };

function errorResponse(error: unknown): NextResponse {
  if (error instanceof ProjectError) {
    const status = error.code === PROJECT_ERROR_CODES.BUSINESS_ACCESS_DENIED ? 403 :
      error.code === PROJECT_ERROR_CODES.PROJECT_NOT_FOUND || error.code === PROJECT_ERROR_CODES.BUSINESS_NOT_FOUND ? 404 :
      error.code === PROJECT_ERROR_CODES.BUSINESS_INACTIVE ? 409 : 400;
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status });
  }
  return NextResponse.json({ error: { code: "PROJECT_REQUEST_FAILED", message: "The project request could not be completed." } }, { status: 500 });
}

export async function GET(_request: Request, context: RouteContext) {
  const identity = await getCurrentIdentity();
  if (!identity) return NextResponse.json({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } }, { status: 401 });
  try {
    const persistence = getPersistenceContext();
    const projects = await createProjectService({
      tenancyRepository: persistence.tenancyRepository,
      projectRepository: persistence.projectRepository,
      platformRepository: persistence.platformRepository,
    }).listProjectsForBusiness((await context.params).businessId as BusinessId, identity);
    return NextResponse.json({ projects }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const identity = await getCurrentIdentity();
  if (!identity) return NextResponse.json({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { body = null; }
  const parsed = projectSchema.safeParse(body);
  if (!parsed.success) return errorResponse(new ProjectError(PROJECT_ERROR_CODES.INVALID_PROJECT_NAME));
  try {
    const persistence = getPersistenceContext();
    const project = await createProjectService({
      tenancyRepository: persistence.tenancyRepository,
      projectRepository: persistence.projectRepository,
      platformRepository: persistence.platformRepository,
    }).createProjectRequest((await context.params).businessId as BusinessId, identity, parsed.data);
    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
