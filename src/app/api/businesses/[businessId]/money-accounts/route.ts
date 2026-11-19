import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentIdentity } from "../../../../../modules/auth/session";
import { createMoneyAccount, listMoneyAccounts } from "../../../../../modules/accounting/money-service";
import { MONEY_ACCOUNT_KINDS } from "../../../../../modules/accounting/money-repository";
import { identityRequired, invalidMoneyRequest, moneyDependencies, moneyErrorResponse, readJson } from "../../../../../modules/accounting/money-route-support";
import type { BusinessId } from "../../../../../modules/tenancy/types";

type RouteContext = { params: Promise<{ businessId: string }> };

const createSchema = z.object({ name: z.string(), kind: z.enum(MONEY_ACCOUNT_KINDS), sheetName: z.string() }).strict();

export async function GET(request: Request, context: RouteContext) {
  const actor = await getCurrentIdentity();
  if (!actor) return identityRequired();
  const yearId = new URL(request.url).searchParams.get("yearId") ?? undefined;
  try {
    return NextResponse.json(await listMoneyAccounts((await context.params).businessId as BusinessId, { yearId }, actor, moneyDependencies()));
  } catch (error) { return moneyErrorResponse(error); }
}

export async function POST(request: Request, context: RouteContext) {
  const actor = await getCurrentIdentity();
  if (!actor) return identityRequired();
  const json = await readJson(request);
  const parsed = json.ok ? createSchema.safeParse(json.body) : null;
  if (!parsed?.success) return invalidMoneyRequest();
  try {
    return NextResponse.json(await createMoneyAccount((await context.params).businessId as BusinessId, parsed.data, actor, moneyDependencies()), { status: 201 });
  } catch (error) { return moneyErrorResponse(error); }
}
