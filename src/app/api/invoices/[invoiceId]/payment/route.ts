import { NextResponse } from "next/server";

import { getCurrentIdentity } from "../../../../../modules/auth/session";
import { changeInvoicePayment } from "../../../../../modules/invoices/invoice-payment-service";
import { invoiceRouteDependencies, invoiceErrorResponse, readInvoiceJson } from "../../../../../modules/invoices/invoice-route-support";
import type { InvoiceId } from "../../../../../modules/invoices/ocr-provider";
import { paymentSchema } from "../../../../../modules/invoices/review-validation";

type RouteContext = { params: Promise<{ invoiceId: string }> };

/** Changes how an approved invoice was paid; its movements follow in the same transaction. */
export async function PATCH(request: Request, context: RouteContext) {
  const identity = await getCurrentIdentity();
  if (!identity) return NextResponse.json({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } }, { status: 401 });
  const parsed = paymentSchema.safeParse(await readInvoiceJson(request));
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_INVOICE_PAYMENT", message: "The invoice payment request is invalid." } }, { status: 400 });
  try {
    return NextResponse.json(await changeInvoicePayment((await context.params).invoiceId as InvoiceId, identity, parsed.data, invoiceRouteDependencies()));
  } catch (error) { return invoiceErrorResponse(error); }
}
