import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentIdentity } from "../../../../../../modules/auth/session";
import { closeFinancialYear, reopenFinancialYear, updateFinancialYearDates } from "../../../../../../modules/accounting/money-service";
import type { FinancialYear } from "../../../../../../modules/accounting/money-repository";
import { identityRequired, invalidMoneyRequest, moneyDependencies, moneyErrorResponse, readJson } from "../../../../../../modules/accounting/money-route-support";
import type { BusinessId } from "../../../../../../modules/tenancy/types";

type RouteContext = { params: Promise<{ businessId: string; yearId: string }> };

const updateSchema = z.object({ startDate: z.string().optional(), endDate: z.string().optional(), status: z.enum(["open", "closed"]).optional() }).strict()
  .refine((value) => value.startDate !== undefined || value.endDate !== undefined || value.status !== undefined);

export async function PATCH(request: Request, context: RouteContext) {
  const actor = await getCurrentIdentity();
  if (!actor) return identityRequired();
  const json = await readJson(request);
  const parsed = json.ok ? updateSchema.safeParse(json.body) : null;
  if (!parsed?.success) return invalidMoneyRequest();
  try {
    const dependencies = moneyDependencies();
    const { businessId, yearId } = await context.params;
    const { startDate, endDate, status } = parsed.data;
    let year: FinancialYear | undefined;
    if (startDate !== undefined || endDate !== undefined) year = await updateFinancialYearDates(businessId as BusinessId, yearId, { startDate, endDate }, actor, dependencies);
    if (status === "closed") year = await closeFinancialYear(businessId as BusinessId, yearId, actor, dependencies);
    if (status === "open") year = await reopenFinancialYear(businessId as BusinessId, yearId, actor, dependencies);
    return NextResponse.json(year);
  } catch (error) { return moneyErrorResponse(error); }
}
