import { NextResponse } from "next/server";

import { getCurrentIdentity } from "../../../../../modules/auth/session";
import { HeadingError, HEADING_ERROR_CODES, listHeadings } from "../../../../../modules/accounting/heading-service";
import type { BusinessId } from "../../../../../modules/tenancy/types";
import { getPersistenceContext } from "../../../../../modules/persistence/repository-factory";

type RouteContext = { params: Promise<{ businessId: string }> };

function responseFor(error: unknown): NextResponse {
  if (error instanceof HeadingError) {
    const status = error.code === HEADING_ERROR_CODES.HEADING_NOT_FOUND || error.code === HEADING_ERROR_CODES.BUSINESS_ACCESS_DENIED ? 404 :
      error.code === HEADING_ERROR_CODES.INSUFFICIENT_CAPABILITY || error.code === HEADING_ERROR_CODES.INACTIVE_BUSINESS ? 403 :
      error.code === HEADING_ERROR_CODES.HEADING_BLOCKED || error.code === HEADING_ERROR_CODES.HEADING_REPOSITORY_CONFLICT ? 409 : 400;
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status });
  }
  return NextResponse.json({ error: { code: "HEADING_REQUEST_FAILED", message: "The heading request could not be completed." } }, { status: 500 });
}

export async function GET(_request: Request, context: RouteContext) {
  const actor = await getCurrentIdentity();
  if (!actor) return NextResponse.json({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } }, { status: 401 });
  try {
    const persistence = getPersistenceContext();
    return NextResponse.json(await listHeadings((await context.params).businessId as BusinessId, actor, {
      tenancyRepository: persistence.tenancyRepository,
      headings: persistence.headingRepository,
    }));
  } catch (error) { return responseFor(error); }
}
