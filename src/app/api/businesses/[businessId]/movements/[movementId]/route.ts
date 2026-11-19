import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentIdentity } from "../../../../../../modules/auth/session";
import { deleteMovement, updateMovement } from "../../../../../../modules/accounting/money-service";
import { identityRequired, invalidMoneyRequest, moneyDependencies, moneyErrorResponse, readJson } from "../../../../../../modules/accounting/money-route-support";
import type { BusinessId } from "../../../../../../modules/tenancy/types";

type RouteContext = { params: Promise<{ businessId: string; movementId: string }> };

const updateSchema = z.object({
  accountId: z.string().optional(),
  date: z.string().optional(),
  narrative: z.string().optional(),
  headingId: z.string().optional(),
  amount: z.string().optional(),
}).strict().refine((value) => Object.values(value).some((field) => field !== undefined));

export async function PATCH(request: Request, context: RouteContext) {
  const actor = await getCurrentIdentity();
  if (!actor) return identityRequired();
  const json = await readJson(request);
  const parsed = json.ok ? updateSchema.safeParse(json.body) : null;
  if (!parsed?.success) return invalidMoneyRequest();
  try {
    const { businessId, movementId } = await context.params;
    return NextResponse.json(await updateMovement(businessId as BusinessId, movementId, parsed.data, actor, moneyDependencies()));
  } catch (error) { return moneyErrorResponse(error); }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const actor = await getCurrentIdentity();
  if (!actor) return identityRequired();
  try {
    const { businessId, movementId } = await context.params;
    return NextResponse.json(await deleteMovement(businessId as BusinessId, movementId, actor, moneyDependencies()));
  } catch (error) { return moneyErrorResponse(error); }
}
