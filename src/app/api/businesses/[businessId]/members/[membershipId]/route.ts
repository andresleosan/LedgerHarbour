import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentIdentity } from "../../../../../../modules/auth/session";
import {
  createMembershipService,
  MembershipAdministrationError,
  MEMBERSHIP_ERROR_CODES,
} from "../../../../../../modules/tenancy/membership-service";
import type { BusinessId } from "../../../../../../modules/tenancy/types";

const actionSchema = z.object({
  action: z.union([
    z.literal("set_general_admin"),
    z.literal("remove_general_admin"),
    z.literal("remove_administrator"),
  ]),
});

type RouteContext = { params: Promise<{ businessId: string; membershipId: string }> };

function errorResponse(error: unknown): NextResponse {
  if (error instanceof MembershipAdministrationError) {
    const status = error.code === MEMBERSHIP_ERROR_CODES.MEMBER_NOT_FOUND ? 404 :
      error.code === MEMBERSHIP_ERROR_CODES.INSUFFICIENT_CAPABILITY ? 403 :
      error.code === MEMBERSHIP_ERROR_CODES.INACTIVE_BUSINESS || error.code === MEMBERSHIP_ERROR_CODES.INVARIANT_CONFLICT || error.code === MEMBERSHIP_ERROR_CODES.REPOSITORY_CONFLICT ? 409 : 400;
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status });
  }
  return NextResponse.json({ error: { code: "REQUEST_FAILED", message: "The membership change could not be completed." } }, { status: 400 });
}

function identityOr401() {
  return getCurrentIdentity();
}

export async function GET(_request: Request, context: RouteContext) {
   const actor = identityOr401();
   if (!actor) return NextResponse.json({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } }, { status: 401 });
  const { businessId } = await context.params;
  try {
     const members = await createMembershipService().listMemberships(businessId as BusinessId, actor);
    return NextResponse.json(members);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
   const actor = identityOr401();
   if (!actor) return NextResponse.json({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } }, { status: 401 });
  const { businessId, membershipId } = await context.params;
  let input: z.infer<typeof actionSchema>;
  try {
    input = actionSchema.parse(await request.json());
  } catch {
    return errorResponse(new MembershipAdministrationError(MEMBERSHIP_ERROR_CODES.INVALID_ACTION));
  }

  try {
    const service = createMembershipService();
    if (input.action === "set_general_admin") {
       const membership = await service.setGeneralAdmin({ businessId: businessId as BusinessId, membershipId }, actor);
      return NextResponse.json(membership);
    }
    await service.removeAdministrator(
      { businessId: businessId as BusinessId, membershipId },
       actor,
      input.action === "remove_general_admin" ? "general_admin" : "administrator",
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
