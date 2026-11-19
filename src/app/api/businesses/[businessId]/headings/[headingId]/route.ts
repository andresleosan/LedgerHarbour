import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentIdentity } from "../../../../../../modules/auth/session";
import { HeadingError, HEADING_ERROR_CODES, renameHeading, setHeadingActive, type AccountHeading } from "../../../../../../modules/accounting/heading-service";
import type { BusinessId } from "../../../../../../modules/tenancy/types";
import { getPersistenceContext } from "../../../../../../modules/persistence/repository-factory";

type RouteContext = { params: Promise<{ businessId: string; headingId: string }> };

const updateSchema = z.object({ displayName: z.string().trim().min(1).max(100).optional(), isActive: z.boolean().optional() }).strict()
  .refine((value) => value.displayName !== undefined || value.isActive !== undefined);

function responseFor(error: unknown): NextResponse {
  if (error instanceof HeadingError) {
    const status = error.code === HEADING_ERROR_CODES.HEADING_NOT_FOUND || error.code === HEADING_ERROR_CODES.BUSINESS_ACCESS_DENIED ? 404 :
      error.code === HEADING_ERROR_CODES.INSUFFICIENT_CAPABILITY || error.code === HEADING_ERROR_CODES.INACTIVE_BUSINESS ? 403 :
      error.code === HEADING_ERROR_CODES.HEADING_BLOCKED || error.code === HEADING_ERROR_CODES.HEADING_REPOSITORY_CONFLICT ? 409 : 400;
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status });
  }
  return NextResponse.json({ error: { code: "HEADING_REQUEST_FAILED", message: "The heading request could not be completed." } }, { status: 500 });
}

function invalidRequest(): NextResponse {
  return NextResponse.json({ error: { code: "INVALID_HEADING_REQUEST", message: "The heading request is invalid." } }, { status: 400 });
}

export async function PATCH(request: Request, context: RouteContext) {
  const actor = await getCurrentIdentity();
  if (!actor) return NextResponse.json({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return invalidRequest(); }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return invalidRequest();
  try {
    const persistence = getPersistenceContext();
    const dependencies = { tenancyRepository: persistence.tenancyRepository, headings: persistence.headingRepository };
    const { businessId, headingId } = await context.params;
    let heading: AccountHeading | undefined;
    // Activation first: the display name is pre-validated above, so a rename after it cannot fail on input alone.
    if (parsed.data.isActive !== undefined) heading = await setHeadingActive(businessId as BusinessId, headingId, parsed.data.isActive, actor, dependencies);
    if (parsed.data.displayName !== undefined) heading = await renameHeading(businessId as BusinessId, headingId, parsed.data.displayName, actor, dependencies);
    return NextResponse.json(heading);
  } catch (error) { return responseFor(error); }
}
