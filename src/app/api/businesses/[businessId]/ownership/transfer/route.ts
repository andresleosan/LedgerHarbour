import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentIdentity } from "../../../../../../modules/auth/session";
import {
  createMembershipService,
  MembershipAdministrationError,
  MEMBERSHIP_ERROR_CODES,
} from "../../../../../../modules/tenancy/membership-service";
import type { BusinessId } from "../../../../../../modules/tenancy/types";

const transferSchema = z.object({
  targetMembershipId: z.string().trim().min(1),
  confirmationName: z.string(),
  reauthenticatedAt: z.string(),
});

type RouteContext = { params: Promise<{ businessId: string }> };

function responseForError(error: unknown): NextResponse {
  if (error instanceof MembershipAdministrationError) {
    const status = error.code === MEMBERSHIP_ERROR_CODES.MEMBER_NOT_FOUND ? 404 :
      error.code === MEMBERSHIP_ERROR_CODES.INSUFFICIENT_CAPABILITY ? 403 :
      error.code === MEMBERSHIP_ERROR_CODES.INACTIVE_BUSINESS || error.code === MEMBERSHIP_ERROR_CODES.INVARIANT_CONFLICT || error.code === MEMBERSHIP_ERROR_CODES.REPOSITORY_CONFLICT ? 409 : 400;
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status });
  }
  return NextResponse.json({ error: { code: "REQUEST_FAILED", message: "The ownership change could not be completed." } }, { status: 400 });
}

export async function POST(request: Request, context: RouteContext) {
  const identity = getCurrentIdentity();
  if (!identity) return NextResponse.json({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } }, { status: 401 });
  const { businessId } = await context.params;
  let input: z.infer<typeof transferSchema>;
  try {
    input = transferSchema.parse(await request.json());
  } catch {
    return responseForError(new MembershipAdministrationError(MEMBERSHIP_ERROR_CODES.CONFIRMATION_REQUIRED));
  }
  try {
    await createMembershipService().transferOwnership(
      { ...input, businessId: businessId as BusinessId },
       identity,
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return responseForError(error);
  }
}
