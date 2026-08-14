import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentIdentity } from "../../../../modules/auth/session";
import {
  approveInvoice,
  getInvoice,
  InvoiceError,
  INVOICE_ERROR_CODES,
  updateInvoice,
} from "../../../../modules/invoices/invoice-service";
import type { InvoiceId } from "../../../../modules/invoices/ocr-provider";
import { getPersistenceContext } from "../../../../modules/persistence/repository-factory";

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
const patchSchema = fieldSchema.extend({ action: z.literal("approve").optional() }).strict();

function errorResponse(error: unknown): NextResponse {
  if (error instanceof InvoiceError) {
    const status = error.code === INVOICE_ERROR_CODES.INVOICE_NOT_FOUND || error.code === INVOICE_ERROR_CODES.DOCUMENT_NOT_FOUND ? 404 :
      error.code === INVOICE_ERROR_CODES.BUSINESS_ACCESS_DENIED || error.code === INVOICE_ERROR_CODES.INACTIVE_BUSINESS || error.code === INVOICE_ERROR_CODES.INSUFFICIENT_CAPABILITY ? 403 :
      error.code === INVOICE_ERROR_CODES.INVALID_STATE || error.code === INVOICE_ERROR_CODES.REPOSITORY_CONFLICT ? 409 : 400;
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status });
  }
  return NextResponse.json({ error: { code: "INVOICE_REQUEST_FAILED", message: "The invoice request could not be completed." } }, { status: 500 });
}

function actorId() {
  return getCurrentIdentity();
}

export async function GET(_request: Request, context: RouteContext) {
  const actor = actorId();
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
  const actor = actorId();
  if (!actor) return NextResponse.json({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } }, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "INVALID_INVOICE_UPDATE", message: "The invoice update is invalid." } }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success || (parsed.data.action === undefined && Object.keys(parsed.data).length === 0)) {
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
    };
    if (parsed.data.action === "approve") return NextResponse.json(await approveInvoice(invoiceId as InvoiceId, actor, dependencies));
    const fields = { ...parsed.data };
    delete fields.action;
    return NextResponse.json(await updateInvoice(invoiceId as InvoiceId, actor, fields, dependencies));
  } catch (error) {
    return errorResponse(error);
  }
}
