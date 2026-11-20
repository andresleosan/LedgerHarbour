import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentIdentity } from "../../../../../modules/auth/session";
import { voidInvoice } from "../../../../../modules/invoices/invoice-payment-service";
import { invoiceRouteDependencies, invoiceErrorResponse, readInvoiceJson } from "../../../../../modules/invoices/invoice-route-support";
import type { InvoiceId } from "../../../../../modules/invoices/ocr-provider";

type RouteContext = { params: Promise<{ invoiceId: string }> };
const body = z.object({}).strict();

/** Voids an approved invoice for good and removes its movements. Voiding twice changes nothing. */
export async function POST(request: Request, context: RouteContext) {
  const identity = await getCurrentIdentity();
  if (!identity) return NextResponse.json({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } }, { status: 401 });
  if (!body.safeParse(await readInvoiceJson(request)).success) return NextResponse.json({ error: { code: "INVALID_INVOICE_VOID", message: "The invoice void request is invalid." } }, { status: 400 });
  try {
    return NextResponse.json(await voidInvoice((await context.params).invoiceId as InvoiceId, identity, invoiceRouteDependencies()));
  } catch (error) { return invoiceErrorResponse(error); }
}
