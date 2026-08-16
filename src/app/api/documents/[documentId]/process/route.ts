import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentIdentity } from "../../../../../modules/auth/session";
import { JobError, JOB_ERROR_CODES, queueOcr } from "../../../../../modules/jobs/job-service";
import { processOcrJob } from "../../../../../modules/jobs/ocr-worker";
import type { DocumentId } from "../../../../../modules/invoices/ocr-provider";
import { getPersistenceContext } from "../../../../../modules/persistence/repository-factory";

type RouteContext = { params: Promise<{ documentId: string }> };
const requestSchema = z.object({}).strict();

function errorResponse(error: unknown): NextResponse {
  if (error instanceof JobError) {
    const status = error.code === JOB_ERROR_CODES.DOCUMENT_NOT_FOUND || error.code === JOB_ERROR_CODES.JOB_NOT_FOUND ? 404 :
      error.code === JOB_ERROR_CODES.BUSINESS_ACCESS_DENIED || error.code === JOB_ERROR_CODES.INACTIVE_BUSINESS ? 403 :
      error.code === JOB_ERROR_CODES.OCR_JOB_CONFLICT ? 409 : 400;
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status });
  }
  return NextResponse.json({ error: { code: "OCR_PROCESSING_FAILED", message: "The OCR request could not be processed." } }, { status: 500 });
}

export async function POST(request: Request, context: RouteContext) {
  const identity = await getCurrentIdentity();
  if (!identity) return NextResponse.json({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } }, { status: 401 });

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
    const job = await queueOcr(documentId as DocumentId, identity, {
      tenancyRepository: persistence.tenancyRepository,
      documentRepository: persistence.documentRepository,
      jobs: persistence.jobRepository,
      invoices: persistence.invoiceRepository,
    });
    if (job.status === "processing") {
      return errorResponse(new JobError(JOB_ERROR_CODES.OCR_JOB_CONFLICT));
    }
    await processOcrJob(job.id, {
      tenancyRepository: persistence.tenancyRepository,
      documentRepository: persistence.documentRepository,
      jobs: persistence.jobRepository,
      invoices: persistence.invoiceRepository,
      storage: persistence.storage,
    });
    const finalJob = await persistence.jobRepository.findById(job.id);
    if (!finalJob) return errorResponse(new JobError(JOB_ERROR_CODES.JOB_NOT_FOUND));
    if (finalJob.status === "failed") {
      return NextResponse.json({ error: { code: "OCR_PROCESSING_FAILED", message: "The OCR request could not be processed." } }, { status: 502 });
    }
    return NextResponse.json({ job: finalJob }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
