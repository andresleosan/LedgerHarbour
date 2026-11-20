import { NextResponse } from "next/server";

import { getCurrentIdentity } from "../../../../../../modules/auth/session";
import { suggestTransferHeading } from "../../../../../../modules/accounting/money-service";
import { identityRequired, moneyDependencies, moneyErrorResponse } from "../../../../../../modules/accounting/money-route-support";
import type { BusinessId } from "../../../../../../modules/tenancy/types";

type RouteContext = { params: Promise<{ businessId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const actor = await getCurrentIdentity();
  if (!actor) return identityRequired();
  try {
    return NextResponse.json(await suggestTransferHeading((await context.params).businessId as BusinessId, actor, moneyDependencies()));
  } catch (error) { return moneyErrorResponse(error); }
}
