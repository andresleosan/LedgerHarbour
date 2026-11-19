import { NextResponse } from "next/server";

import { getCurrentIdentity } from "../../../../../../modules/auth/session";
import { identityRequired, invalidMoneyRequest, moneyDependencies, readJson } from "../../../../../../modules/accounting/money-route-support";
import { previewStatement } from "../../../../../../modules/accounting/statement-import-service";
import type { BusinessId } from "../../../../../../modules/tenancy/types";
import { guardStatementUpload, statementBodySchema, statementErrorResponse } from "../support";

type RouteContext = { params: Promise<{ businessId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const actor = await getCurrentIdentity();
  if (!actor) return identityRequired();
  const refused = await guardStatementUpload(request, actor);
  if (refused) return refused;
  const json = await readJson(request);
  const parsed = json.ok ? statementBodySchema.safeParse(json.body) : null;
  if (!parsed?.success) return invalidMoneyRequest();
  try {
    return NextResponse.json(await previewStatement((await context.params).businessId as BusinessId, parsed.data, actor, moneyDependencies()));
  } catch (error) { return statementErrorResponse(error); }
}
