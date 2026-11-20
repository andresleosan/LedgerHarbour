import { NextResponse } from "next/server";

import { getPersistenceContext } from "../persistence/repository-factory";
import { InvoiceError, invoiceErrorStatus, type InvoiceDependencies } from "./invoice-service";
import { MAX_REVIEW_PATCH_BYTES } from "./review-validation";

/** The payment, void and unpaid-list routes: repositories of the configured persistence mode. */
export function invoiceRouteDependencies(): InvoiceDependencies {
  const persistence = getPersistenceContext();
  return {
    tenancyRepository: persistence.tenancyRepository,
    documentRepository: persistence.documentRepository,
    invoices: persistence.invoiceRepository,
    transaction: persistence.transaction,
    codings: persistence.invoiceCodingRepository,
    headings: persistence.headingRepository,
    money: persistence.moneyRepository,
  };
}

export function invoiceErrorResponse(error: unknown): NextResponse {
  if (error instanceof InvoiceError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: invoiceErrorStatus(error.code) });
  return NextResponse.json({ error: { code: "INVOICE_REQUEST_FAILED", message: "The invoice request could not be completed." } }, { status: 500 });
}

/** The request body as JSON, or undefined when it is not JSON or too large (the schema then refuses it). */
export async function readInvoiceJson(request: Request): Promise<unknown> {
  try {
    return await readBoundedInvoiceJson(request);
  } catch {
    return undefined;
  }
}

/** The request body as JSON, refused (thrown) past the review patch size before it is all read. */
export async function readBoundedInvoiceJson(request: Request): Promise<unknown> {
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
