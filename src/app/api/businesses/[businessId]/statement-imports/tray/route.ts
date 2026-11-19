import { NextResponse } from "next/server";

import { getCurrentIdentity } from "../../../../../../modules/auth/session";
import { identityRequired, invalidMoneyRequest, moneyDependencies, moneyErrorResponse } from "../../../../../../modules/accounting/money-route-support";
import { listUncodedStatementMovements } from "../../../../../../modules/accounting/statement-import-service";
import type { BusinessId } from "../../../../../../modules/tenancy/types";

type RouteContext = { params: Promise<{ businessId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const actor = await getCurrentIdentity();
  if (!actor) return identityRequired();
  const yearId = new URL(request.url).searchParams.get("yearId");
  if (!yearId) return invalidMoneyRequest();
  try {
    return NextResponse.json(await listUncodedStatementMovements((await context.params).businessId as BusinessId, yearId, actor, moneyDependencies()));
  } catch (error) { return moneyErrorResponse(error); }
}
