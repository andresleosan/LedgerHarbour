import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentIdentity } from "../../../../modules/auth/session";
import {
  approveInvoice,
  getInvoice,
  InvoiceError,
  invoiceErrorStatus,
  updateInvoice,
} from "../../../../modules/invoices/invoice-service";
import type { InvoiceId } from "../../../../modules/invoices/ocr-provider";
import { readBoundedInvoiceJson } from "../../../../modules/invoices/invoice-route-support";
import { getPersistenceContext } from "../../../../modules/persistence/repository-factory";
import { paymentSchema } from "../../../../modules/invoices/review-validation";

type RouteContext = { params: Promise<{ invoiceId: string }> };

const fieldSchema = z.object({
  supplier: z.string().nullable().optional(),
  invoiceNumber: z.string().nullable().optional(),
  invoiceDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  subtotal: z.string().nullable().optional(),
  taxAmount: z.string().nullable().optional(),
  total: z.string().nullable().optional(),
  currencyReference: z.string().nullable().optional(),
  expenseCategoryReference: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});
const patchSchema = fieldSchema.extend({ action: z.literal("approve").optional(), payment: paymentSchema.optional() }).strict();

function errorResponse(error: unknown): NextResponse {
  if (error instanceof InvoiceError) {
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: invoiceErrorStatus(error.code) });
  }
  return NextResponse.json({ error: { code: "INVOICE_REQUEST_FAILED", message: "The invoice request could not be completed." } }, { status: 500 });
}

async function actorId() {
  return getCurrentIdentity();
}

export async function GET(_request: Request, context: RouteContext) {
  const actor = await actorId();
  if (!actor) return NextResponse.json({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } }, { status: 401 });
  try {
    const persistence = getPersistenceContext();
    return NextResponse.json(await getInvoice((await context.params).invoiceId as InvoiceId, actor, {
      tenancyRepository: persistence.tenancyRepository,
      documentRepository: persistence.documentRepository,
      invoices: persistence.invoiceRepository,
    }));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const actor = await actorId();
  if (!actor) return NextResponse.json({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } }, { status: 401 });
  let body: unknown;
  try {
    body = await readBoundedInvoiceJson(request);
  } catch {
    return NextResponse.json({ error: { code: "INVALID_INVOICE_UPDATE", message: "The invoice update is invalid." } }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "INVALID_INVOICE_UPDATE", message: "The invoice update is invalid." } }, { status: 400 });
  }
  // Without an action, at least one field must change: a payment alone, or nothing, only bumps `updatedAt`.
  const { action, payment, ...fields } = parsed.data;
  if (action === undefined && Object.keys(fields).length === 0) {
    return NextResponse.json({ error: { code: "INVALID_INVOICE_UPDATE", message: "The invoice update is invalid." } }, { status: 400 });
  }
  try {
    const { invoiceId } = await context.params;
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
    if (action === "approve") return NextResponse.json(await approveInvoice(invoiceId as InvoiceId, actor, dependencies, payment));
    return NextResponse.json(await updateInvoice(invoiceId as InvoiceId, actor, fields, dependencies));
  } catch (error) {
    return errorResponse(error);
  }
}
