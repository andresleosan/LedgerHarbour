import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentIdentity } from "../../../../../../../modules/auth/session";
import { identityRequired, invalidMoneyRequest, moneyDependencies, moneyErrorResponse, readJson } from "../../../../../../../modules/accounting/money-route-support";
import { codeStatementMovement, deleteStatementMovement } from "../../../../../../../modules/accounting/statement-import-service";
import type { BusinessId } from "../../../../../../../modules/tenancy/types";

type RouteContext = { params: Promise<{ businessId: string; movementId: string }> };

const codeSchema = z.object({ headingId: z.string().min(1).nullable() }).strict();

export async function PATCH(request: Request, context: RouteContext) {
  const actor = await getCurrentIdentity();
  if (!actor) return identityRequired();
  const json = await readJson(request);
  const parsed = json.ok ? codeSchema.safeParse(json.body) : null;
  if (!parsed?.success) return invalidMoneyRequest();
  try {
    const { businessId, movementId } = await context.params;
    return NextResponse.json(await codeStatementMovement(businessId as BusinessId, movementId, parsed.data.headingId, actor, moneyDependencies()));
  } catch (error) { return moneyErrorResponse(error); }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const actor = await getCurrentIdentity();
  if (!actor) return identityRequired();
  try {
    const { businessId, movementId } = await context.params;
    return NextResponse.json(await deleteStatementMovement(businessId as BusinessId, movementId, actor, moneyDependencies()));
  } catch (error) { return moneyErrorResponse(error); }
}
