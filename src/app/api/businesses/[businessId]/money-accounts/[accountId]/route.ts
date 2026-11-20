import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentIdentity } from "../../../../../../modules/auth/session";
import { renameMoneyAccount, setMoneyAccountActive, setOpeningBalance } from "../../../../../../modules/accounting/money-service";
import type { MoneyAccount } from "../../../../../../modules/accounting/money-repository";
import { identityRequired, invalidMoneyRequest, moneyDependencies, moneyErrorResponse, readJson } from "../../../../../../modules/accounting/money-route-support";
import type { BusinessId } from "../../../../../../modules/tenancy/types";

type RouteContext = { params: Promise<{ businessId: string; accountId: string }> };

const updateSchema = z.object({
  name: z.string().optional(),
  isActive: z.boolean().optional(),
  openingBalance: z.object({ yearId: z.string(), amount: z.string() }).strict().optional(),
}).strict().refine((value) => value.name !== undefined || value.isActive !== undefined || value.openingBalance !== undefined);

export async function PATCH(request: Request, context: RouteContext) {
  const actor = await getCurrentIdentity();
  if (!actor) return identityRequired();
  const json = await readJson(request);
  const parsed = json.ok ? updateSchema.safeParse(json.body) : null;
  if (!parsed?.success) return invalidMoneyRequest();
  try {
    const dependencies = moneyDependencies();
    const { businessId, accountId } = await context.params;
    const { name, isActive, openingBalance } = parsed.data;
    let account: MoneyAccount | undefined;
    if (isActive !== undefined) account = await setMoneyAccountActive(businessId as BusinessId, accountId, isActive, actor, dependencies);
    if (name !== undefined) account = await renameMoneyAccount(businessId as BusinessId, accountId, name, actor, dependencies);
    if (openingBalance) account = await setOpeningBalance(businessId as BusinessId, accountId, openingBalance.yearId, openingBalance.amount, actor, dependencies);
    return NextResponse.json(account);
  } catch (error) { return moneyErrorResponse(error); }
}
