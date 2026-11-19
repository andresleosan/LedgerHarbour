import { NextResponse } from "next/server";

import { getPersistenceContext } from "../persistence/repository-factory";
import { InvoiceError, invoiceErrorStatus, type InvoiceDependencies } from "./invoice-service";

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

/** The request body as JSON, or undefined when it is not JSON (the schema then refuses it). */
export async function readInvoiceJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}
