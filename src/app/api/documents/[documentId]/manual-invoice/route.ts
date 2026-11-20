import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentIdentity } from "../../../../../modules/auth/session";
import { asJobError, createManualInvoice, JobError, JOB_ERROR_CODES } from "../../../../../modules/jobs/job-service";
import type { DocumentId } from "../../../../../modules/invoices/ocr-provider";
import { getPersistenceContext } from "../../../../../modules/persistence/repository-factory";
import { authenticatedRateLimitResponse } from "../../../../../modules/security/authenticated-rate-limit";

type RouteContext = { params: Promise<{ documentId: string }> };
const requestSchema = z.object({}).strict();

function errorResponse(unknownError: unknown): NextResponse {
  // The invoice repository rejects a second invoice for the document when two requests race.
  const raced = (unknownError as { code?: unknown } | null)?.code === "INVOICE_REPOSITORY_CONFLICT";
  const error = raced ? new JobError(JOB_ERROR_CODES.DOCUMENT_NOT_FAILED) : asJobError(unknownError);
  if (error) {
    const status = error.code === JOB_ERROR_CODES.DOCUMENT_NOT_FOUND ? 404 :
      error.code === JOB_ERROR_CODES.BUSINESS_ACCESS_DENIED || error.code === JOB_ERROR_CODES.INACTIVE_BUSINESS ? 403 :
      error.code === JOB_ERROR_CODES.DOCUMENT_NOT_FAILED ? 409 : 400;
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status });
  }
  return NextResponse.json({ error: { code: "MANUAL_INVOICE_FAILED", message: "The invoice could not be created." } }, { status: 500 });
}

export async function POST(request: Request, context: RouteContext) {
  const identity = await getCurrentIdentity();
  if (!identity) return NextResponse.json({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } }, { status: 401 });
  // Filling a failed reading in by hand is the last step of the OCR flow: it shares the process budget.
  const limited = await authenticatedRateLimitResponse("ocr-process", request, identity);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: JOB_ERROR_CODES.INVALID_JOB_REQUEST, message: "The OCR job request is invalid." } }, { status: 400 });
  }
  if (!requestSchema.safeParse(body).success) {
    return NextResponse.json({ error: { code: JOB_ERROR_CODES.INVALID_JOB_REQUEST, message: "The OCR job request is invalid." } }, { status: 400 });
  }

  try {
    const { documentId } = await context.params;
    const persistence = getPersistenceContext();
    const invoiceId = await createManualInvoice(documentId as DocumentId, identity, {
      tenancyRepository: persistence.tenancyRepository,
      documentRepository: persistence.documentRepository,
      jobs: persistence.jobRepository,
      invoices: persistence.invoiceRepository,
      transaction: persistence.transaction,
    });
    return NextResponse.json({ invoiceId }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
