import { NextResponse } from "next/server";

import { getCurrentIdentity } from "../../../../../../../modules/auth/session";
import { identityRequired, moneyDependencies, moneyErrorResponse } from "../../../../../../../modules/accounting/money-route-support";
import { getYearSummary } from "../../../../../../../modules/accounting/year-summary";
import type { BusinessId } from "../../../../../../../modules/tenancy/types";

type RouteContext = { params: Promise<{ businessId: string; yearId: string }> };

/** The year's totals in pence, for members with `read_finance`. */
export async function GET(_request: Request, context: RouteContext) {
  const actor = await getCurrentIdentity();
  if (!actor) return identityRequired();
  try {
    const { businessId, yearId } = await context.params;
    const response = NextResponse.json(await getYearSummary(businessId as BusinessId, yearId, actor, moneyDependencies()));
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) { return moneyErrorResponse(error); }
}
