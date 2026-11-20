import { NextResponse } from "next/server";

import { getCurrentIdentity } from "../../../../../../modules/auth/session";
import { listPrivatelyPaidInvoices, listUnpaidInvoices } from "../../../../../../modules/invoices/invoice-payment-service";
import { invoiceRouteDependencies, invoiceErrorResponse } from "../../../../../../modules/invoices/invoice-route-support";
import type { BusinessId } from "../../../../../../modules/tenancy/types";

type RouteContext = { params: Promise<{ businessId: string }> };

/** Approved invoices that did not go through a business account: the year-end creditors and capital introduced. */
export async function GET(_request: Request, context: RouteContext) {
  const identity = await getCurrentIdentity();
  if (!identity) return NextResponse.json({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } }, { status: 401 });
  try {
    const businessId = (await context.params).businessId as BusinessId;
    const dependencies = invoiceRouteDependencies();
    const unpaid = await listUnpaidInvoices(businessId, identity, dependencies);
    const paidPrivately = await listPrivatelyPaidInvoices(businessId, identity, dependencies);
    const response = NextResponse.json({ unpaid, paidPrivately });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) { return invoiceErrorResponse(error); }
}
