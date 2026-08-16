import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentIdentity } from "../../../../../modules/auth/session";
import {
  BusinessLifecycleError,
  createBusinessLifecycleService,
  LIFECYCLE_ERROR_CODES,
} from "../../../../../modules/tenancy/business-lifecycle-service";
import type { BusinessId } from "../../../../../modules/tenancy/types";
import { getPersistenceContext } from "../../../../../modules/persistence/repository-factory";

const actionSchema = z.object({
  action: z.union([z.literal("deactivate"), z.literal("reactivate")]),
});
const confirmationSchema = z.object({ confirmationName: z.string().trim().min(1) });
type RouteContext = { params: Promise<{ businessId: string }> };

function responseForError(error: unknown): NextResponse {
  if (error instanceof BusinessLifecycleError) {
    const status = error.code === LIFECYCLE_ERROR_CODES.BUSINESS_NOT_FOUND ? 404 :
      error.code === LIFECYCLE_ERROR_CODES.INSUFFICIENT_CAPABILITY ? 403 :
      error.code === LIFECYCLE_ERROR_CODES.INACTIVE_BUSINESS || error.code === LIFECYCLE_ERROR_CODES.ACTIVE_BUSINESS || error.code === LIFECYCLE_ERROR_CODES.REPOSITORY_CONFLICT ? 409 : 400;
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status });
  }
  return NextResponse.json({ error: { code: "REQUEST_FAILED", message: "The business state could not be changed." } }, { status: 400 });
}

export async function PATCH(request: Request, context: RouteContext) {
  const identity = await getCurrentIdentity();
  if (!identity) return NextResponse.json({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } }, { status: 401 });
  const { businessId } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return responseForError(new BusinessLifecycleError(LIFECYCLE_ERROR_CODES.INVALID_ACTION));
  }
  const action = actionSchema.safeParse(body);
  if (!action.success) {
    return responseForError(new BusinessLifecycleError(LIFECYCLE_ERROR_CODES.INVALID_ACTION));
  }
  const confirmation = confirmationSchema.safeParse(body);
  if (!confirmation.success) {
    return responseForError(new BusinessLifecycleError(LIFECYCLE_ERROR_CODES.CONFIRMATION_REQUIRED));
  }
  try {
    const persistence = getPersistenceContext();
    const service = createBusinessLifecycleService(persistence.tenancyRepository);
    if (action.data.action === "deactivate") {
        await service.deactivateBusiness(businessId as BusinessId, identity, confirmation.data.confirmationName);
    } else {
        await service.reactivateBusiness(businessId as BusinessId, identity, confirmation.data.confirmationName);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return responseForError(error);
  }
}
