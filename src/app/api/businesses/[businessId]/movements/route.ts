import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentIdentity } from "../../../../../modules/auth/session";
import { createMovement, listMovements } from "../../../../../modules/accounting/money-service";
import { MOVEMENT_ORIGINS } from "../../../../../modules/accounting/money-repository";
import { identityRequired, invalidMoneyRequest, moneyDependencies, moneyErrorResponse, readJson } from "../../../../../modules/accounting/money-route-support";
import type { BusinessId } from "../../../../../modules/tenancy/types";

type RouteContext = { params: Promise<{ businessId: string }> };

const createSchema = z.object({
  accountId: z.string(),
  date: z.string(),
  narrative: z.string(),
  headingId: z.string(),
  amount: z.string(),
  origin: z.enum(MOVEMENT_ORIGINS).optional(),
}).strict();

export async function GET(request: Request, context: RouteContext) {
  const actor = await getCurrentIdentity();
  if (!actor) return identityRequired();
  const query = new URL(request.url).searchParams;
  const yearId = query.get("yearId");
  if (!yearId) return invalidMoneyRequest();
  try {
    return NextResponse.json(await listMovements((await context.params).businessId as BusinessId, { yearId, accountId: query.get("accountId") ?? undefined }, actor, moneyDependencies()));
  } catch (error) { return moneyErrorResponse(error); }
}

export async function POST(request: Request, context: RouteContext) {
  const actor = await getCurrentIdentity();
  if (!actor) return identityRequired();
  const json = await readJson(request);
  const parsed = json.ok ? createSchema.safeParse(json.body) : null;
  if (!parsed?.success) return invalidMoneyRequest();
  try {
    return NextResponse.json(await createMovement((await context.params).businessId as BusinessId, parsed.data, actor, moneyDependencies()), { status: 201 });
  } catch (error) { return moneyErrorResponse(error); }
}
