import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentIdentity } from "../../../../../modules/auth/session";
import { createTransfer } from "../../../../../modules/accounting/money-service";
import { identityRequired, invalidMoneyRequest, moneyDependencies, moneyErrorResponse, readJson } from "../../../../../modules/accounting/money-route-support";
import type { BusinessId } from "../../../../../modules/tenancy/types";

type RouteContext = { params: Promise<{ businessId: string }> };

const createSchema = z.object({
  fromAccountId: z.string(),
  toAccountId: z.string(),
  date: z.string(),
  amount: z.string(),
  headingId: z.string(),
  narrative: z.string().optional(),
}).strict();

export async function POST(request: Request, context: RouteContext) {
  const actor = await getCurrentIdentity();
  if (!actor) return identityRequired();
  const json = await readJson(request);
  const parsed = json.ok ? createSchema.safeParse(json.body) : null;
  if (!parsed?.success) return invalidMoneyRequest();
  try {
    return NextResponse.json(await createTransfer((await context.params).businessId as BusinessId, parsed.data, actor, moneyDependencies()), { status: 201 });
  } catch (error) { return moneyErrorResponse(error); }
}
