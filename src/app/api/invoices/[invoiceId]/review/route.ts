import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentIdentity } from "../../../../../modules/auth/session";
import { approveInvoice, getInvoiceReview, updateInvoiceDraft } from "../../../../../modules/invoices/invoice-review-service";
import { InvoiceError, INVOICE_ERROR_CODES } from "../../../../../modules/invoices/invoice-service";
import type { InvoiceId } from "../../../../../modules/invoices/ocr-provider";

type RouteContext = { params: Promise<{ invoiceId: string }> };

const fields = z.object({
  supplier: z.string().nullable().optional(), invoiceNumber: z.string().nullable().optional(), invoiceDate: z.string().nullable().optional(), dueDate: z.string().nullable().optional(), subtotal: z.string().nullable().optional(), taxAmount: z.string().nullable().optional(), total: z.string().nullable().optional(), currencyReference: z.string().nullable().optional(), expenseCategoryReference: z.string().nullable().optional(), notes: z.string().nullable().optional(),
}).strict();
const patch = z.union([z.object({ action: z.literal("approve") }).strict(), fields]).refine((value) => "action" in value || Object.keys(value).length > 0);

function responseFor(error: unknown): NextResponse {
  if (error instanceof InvoiceError) {
    const status = error.code === INVOICE_ERROR_CODES.INVOICE_NOT_FOUND || error.code === INVOICE_ERROR_CODES.DOCUMENT_NOT_FOUND ? 404 : error.code === INVOICE_ERROR_CODES.BUSINESS_ACCESS_DENIED || error.code === INVOICE_ERROR_CODES.INACTIVE_BUSINESS || error.code === INVOICE_ERROR_CODES.INSUFFICIENT_CAPABILITY ? 403 : error.code === INVOICE_ERROR_CODES.INVALID_STATE || error.code === INVOICE_ERROR_CODES.REPOSITORY_CONFLICT ? 409 : 400;
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status });
  }
  return NextResponse.json({ error: { code: "INVOICE_REVIEW_FAILED", message: "The invoice review request could not be completed." } }, { status: 500 });
}

function actor() { return getCurrentIdentity(); }

export async function GET(_request: Request, context: RouteContext) {
  const identity = actor();
  if (!identity) return NextResponse.json({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } }, { status: 401 });
  try { return NextResponse.json(await getInvoiceReview((await context.params).invoiceId as InvoiceId, identity)); } catch (error) { return responseFor(error); }
}

export async function PATCH(request: Request, context: RouteContext) {
  const identity = actor();
  if (!identity) return NextResponse.json({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: { code: "INVALID_INVOICE_REVIEW", message: "The invoice review request is invalid." } }, { status: 400 }); }
  const parsed = patch.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_INVOICE_REVIEW", message: "The invoice review request is invalid." } }, { status: 400 });
  try {
    const invoiceId = (await context.params).invoiceId as InvoiceId;
    if ("action" in parsed.data) return NextResponse.json(await approveInvoice(invoiceId, identity));
    return NextResponse.json(await updateInvoiceDraft({ invoiceId, fields: parsed.data }, identity));
  } catch (error) { return responseFor(error); }
}
