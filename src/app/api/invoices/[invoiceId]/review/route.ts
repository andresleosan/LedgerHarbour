import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentIdentity } from "../../../../../modules/auth/session";
import { approveInvoice, getInvoiceReview, updateInvoiceDraft } from "../../../../../modules/invoices/invoice-review-service";
import { InvoiceError, INVOICE_ERROR_CODES } from "../../../../../modules/invoices/invoice-service";
import type { InvoiceId } from "../../../../../modules/invoices/ocr-provider";
import { getPersistenceContext } from "../../../../../modules/persistence/repository-factory";
import { MAX_REVIEW_PATCH_BYTES } from "../../../../../modules/invoices/review-validation";

type RouteContext = { params: Promise<{ invoiceId: string }> };
const REVIEW_FIELD_MAX_LENGTH = 2000;
const reviewField = z.string().max(REVIEW_FIELD_MAX_LENGTH);

const fields = z.object({
  supplier: reviewField.nullable().optional(), invoiceNumber: reviewField.nullable().optional(), invoiceDate: reviewField.nullable().optional(), dueDate: reviewField.nullable().optional(), subtotal: reviewField.nullable().optional(), taxAmount: reviewField.nullable().optional(), total: reviewField.nullable().optional(), currencyReference: reviewField.nullable().optional(), expenseCategoryReference: reviewField.nullable().optional(), notes: reviewField.nullable().optional(),
}).strict();
const patch = z.union([z.object({ action: z.literal("approve") }).strict(), fields]).refine((value) => "action" in value || Object.keys(value).length > 0);

function responseFor(error: unknown): NextResponse {
  if (error instanceof InvoiceError) {
    const status = error.code === INVOICE_ERROR_CODES.INVOICE_NOT_FOUND || error.code === INVOICE_ERROR_CODES.DOCUMENT_NOT_FOUND ? 404 : error.code === INVOICE_ERROR_CODES.BUSINESS_ACCESS_DENIED || error.code === INVOICE_ERROR_CODES.INACTIVE_BUSINESS || error.code === INVOICE_ERROR_CODES.INSUFFICIENT_CAPABILITY ? 403 : error.code === INVOICE_ERROR_CODES.INVALID_STATE || error.code === INVOICE_ERROR_CODES.REPOSITORY_CONFLICT ? 409 : 400;
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status });
  }
  return NextResponse.json({ error: { code: "INVOICE_REVIEW_FAILED", message: "The invoice review request could not be completed." } }, { status: 500 });
}

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

async function actor() { return getCurrentIdentity(); }

async function parseReviewBody(request: Request): Promise<unknown> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number.isFinite(Number(contentLength)) && Number(contentLength) > MAX_REVIEW_PATCH_BYTES) {
    throw new Error("review body too large");
  }
  if (!request.body) return request.json();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > MAX_REVIEW_PATCH_BYTES) throw new Error("review body too large");
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function GET(_request: Request, context: RouteContext) {
  const identity = await actor();
  if (!identity) return noStore(NextResponse.json({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } }, { status: 401 }));
  try {
    const persistence = getPersistenceContext();
    return noStore(NextResponse.json(await getInvoiceReview((await context.params).invoiceId as InvoiceId, identity, {
      tenancyRepository: persistence.tenancyRepository,
      documentRepository: persistence.documentRepository,
      invoices: persistence.invoiceRepository,
    })));
  } catch (error) { return noStore(responseFor(error)); }
}

export async function PATCH(request: Request, context: RouteContext) {
  const identity = await actor();
  if (!identity) return NextResponse.json({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } }, { status: 401 });
  let body: unknown;
  try { body = await parseReviewBody(request); } catch { return NextResponse.json({ error: { code: "INVALID_INVOICE_REVIEW", message: "The invoice review request is invalid." } }, { status: 400 }); }
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
    };
    if ("action" in parsed.data) return NextResponse.json(await approveInvoice(invoiceId, identity, dependencies));
    return NextResponse.json(await updateInvoiceDraft({ invoiceId, fields: parsed.data }, identity, dependencies));
  } catch (error) { return responseFor(error); }
}
