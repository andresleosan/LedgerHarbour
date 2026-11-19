import { NextResponse } from "next/server";

import { getCurrentIdentity } from "../../../../../../../../modules/auth/session";
import { getExportReport } from "../../../../../../../../modules/accounting/export-service";
import { exportErrorResponse, identityRequired, moneyDependencies } from "../../../../../../../../modules/accounting/money-route-support";
import { getPersistenceContext } from "../../../../../../../../modules/persistence/repository-factory";
import type { BusinessId } from "../../../../../../../../modules/tenancy/types";

type RouteContext = { params: Promise<{ businessId: string; yearId: string }> };

/** The control report, blocked or not. */
export async function GET(_request: Request, context: RouteContext) {
  const actor = await getCurrentIdentity();
  if (!actor) return identityRequired();
  try {
    const { businessId, yearId } = await context.params;
    return NextResponse.json(await getExportReport(businessId as BusinessId, yearId, actor, { ...moneyDependencies(), storage: getPersistenceContext().storage }));
  } catch (error) { return exportErrorResponse(error); }
}
