import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentIdentity } from "../../../../../modules/auth/session";
import { createFinancialYear, listFinancialYears } from "../../../../../modules/accounting/money-service";
import { identityRequired, invalidMoneyRequest, moneyDependencies, moneyErrorResponse, readJson } from "../../../../../modules/accounting/money-route-support";
import type { BusinessId } from "../../../../../modules/tenancy/types";

type RouteContext = { params: Promise<{ businessId: string }> };

const createSchema = z.object({ startDate: z.string(), endDate: z.string() }).strict();

export async function GET(_request: Request, context: RouteContext) {
  const actor = await getCurrentIdentity();
  if (!actor) return identityRequired();
  try {
    return NextResponse.json(await listFinancialYears((await context.params).businessId as BusinessId, actor, moneyDependencies()));
  } catch (error) { return moneyErrorResponse(error); }
}

export async function POST(request: Request, context: RouteContext) {
  const actor = await getCurrentIdentity();
  if (!actor) return identityRequired();
  const json = await readJson(request);
  const parsed = json.ok ? createSchema.safeParse(json.body) : null;
  if (!parsed?.success) return invalidMoneyRequest();
  try {
    return NextResponse.json(await createFinancialYear((await context.params).businessId as BusinessId, parsed.data, actor, moneyDependencies()), { status: 201 });
  } catch (error) { return moneyErrorResponse(error); }
}
