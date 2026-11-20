import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentIdentity } from "../../../../../modules/auth/session";
import { approveInvoice, getInvoiceReview, updateInvoiceDraft } from "../../../../../modules/invoices/invoice-review-service";
import { InvoiceError, invoiceErrorStatus, INVOICE_KINDS, MAX_CODING_LINES } from "../../../../../modules/invoices/invoice-service";
import type { InvoiceId } from "../../../../../modules/invoices/ocr-provider";
import { getPersistenceContext } from "../../../../../modules/persistence/repository-factory";
import { readBoundedInvoiceJson } from "../../../../../modules/invoices/invoice-route-support";
import { paymentSchema } from "../../../../../modules/invoices/review-validation";

type RouteContext = { params: Promise<{ invoiceId: string }> };
const REVIEW_FIELD_MAX_LENGTH = 2000;
const reviewField = z.string().max(REVIEW_FIELD_MAX_LENGTH);

const fields = z.object({
  supplier: reviewField.nullable().optional(), invoiceNumber: reviewField.nullable().optional(), invoiceDate: reviewField.nullable().optional(), dueDate: reviewField.nullable().optional(), subtotal: reviewField.nullable().optional(), taxAmount: reviewField.nullable().optional(), total: reviewField.nullable().optional(), currencyReference: reviewField.nullable().optional(), expenseCategoryReference: reviewField.nullable().optional(), notes: reviewField.nullable().optional(),
  kind: z.enum(INVOICE_KINDS).optional(),
  coding: z.array(z.object({ headingId: z.string().min(1).max(200), amount: z.string().max(20) }).strict()).max(MAX_CODING_LINES).optional(),
}).strict();
const patch = z.union([z.object({ action: z.literal("approve"), payment: paymentSchema.optional() }).strict(), fields]).refine((value) => "action" in value || Object.keys(value).length > 0);

function responseFor(error: unknown): NextResponse {
  if (error instanceof InvoiceError) {
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: invoiceErrorStatus(error.code) });
  }
  return NextResponse.json({ error: { code: "INVOICE_REVIEW_FAILED", message: "The invoice review request could not be completed." } }, { status: 500 });
}

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

async function actor() { return getCurrentIdentity(); }

export async function GET(_request: Request, context: RouteContext) {
  const identity = await actor();
  if (!identity) return noStore(NextResponse.json({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } }, { status: 401 }));
  try {
    const persistence = getPersistenceContext();
    return noStore(NextResponse.json(await getInvoiceReview((await context.params).invoiceId as InvoiceId, identity, {
      tenancyRepository: persistence.tenancyRepository,
      documentRepository: persistence.documentRepository,
      invoices: persistence.invoiceRepository,
      codings: persistence.invoiceCodingRepository,
      headings: persistence.headingRepository,
    })));
  } catch (error) { return noStore(responseFor(error)); }
}

export async function PATCH(request: Request, context: RouteContext) {
  const identity = await actor();
  if (!identity) return NextResponse.json({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } }, { status: 401 });
  let body: unknown;
  try { body = await readBoundedInvoiceJson(request); } catch { return NextResponse.json({ error: { code: "INVALID_INVOICE_REVIEW", message: "The invoice review request is invalid." } }, { status: 400 }); }
  const parsed = patch.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_INVOICE_REVIEW", message: "The invoice review request is invalid." } }, { status: 400 });
  try {
    const invoiceId = (await context.params).invoiceId as InvoiceId;
    const persistence = getPersistenceContext();
    const dependencies = {
      tenancyRepository: persistence.tenancyRepository,
      documentRepository: persistence.documentRepository,
      invoices: persistence.invoiceRepository,
      transaction: persistence.transaction,
      codings: persistence.invoiceCodingRepository,
      headings: persistence.headingRepository,
      money: persistence.moneyRepository,
    };
    if ("action" in parsed.data) return NextResponse.json(await approveInvoice(invoiceId, identity, dependencies, parsed.data.payment));
    const { coding, ...fieldChanges } = parsed.data;
    return NextResponse.json(await updateInvoiceDraft({ invoiceId, fields: fieldChanges, coding }, identity, dependencies));
  } catch (error) { return responseFor(error); }
}
