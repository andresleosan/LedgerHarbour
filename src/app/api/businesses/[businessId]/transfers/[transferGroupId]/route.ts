import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentIdentity } from "../../../../../../modules/auth/session";
import { deleteTransfer, updateTransfer } from "../../../../../../modules/accounting/money-service";
import { identityRequired, invalidMoneyRequest, moneyDependencies, moneyErrorResponse, readJson } from "../../../../../../modules/accounting/money-route-support";
import type { BusinessId } from "../../../../../../modules/tenancy/types";

type RouteContext = { params: Promise<{ businessId: string; transferGroupId: string }> };

const updateSchema = z.object({
  fromAccountId: z.string().optional(),
  toAccountId: z.string().optional(),
  date: z.string().optional(),
  amount: z.string().optional(),
  headingId: z.string().optional(),
  narrative: z.string().optional(),
}).strict().refine((value) => Object.values(value).some((field) => field !== undefined));

export async function PATCH(request: Request, context: RouteContext) {
  const actor = await getCurrentIdentity();
  if (!actor) return identityRequired();
  const json = await readJson(request);
  const parsed = json.ok ? updateSchema.safeParse(json.body) : null;
  if (!parsed?.success) return invalidMoneyRequest();
  try {
    const { businessId, transferGroupId } = await context.params;
    return NextResponse.json(await updateTransfer(businessId as BusinessId, transferGroupId, parsed.data, actor, moneyDependencies()));
  } catch (error) { return moneyErrorResponse(error); }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const actor = await getCurrentIdentity();
  if (!actor) return identityRequired();
  try {
    const { businessId, transferGroupId } = await context.params;
    return NextResponse.json(await deleteTransfer(businessId as BusinessId, transferGroupId, actor, moneyDependencies()));
  } catch (error) { return moneyErrorResponse(error); }
}
