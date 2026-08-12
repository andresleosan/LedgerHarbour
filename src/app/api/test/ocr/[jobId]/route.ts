import { NextResponse } from "next/server";

import { getCurrentIdentity } from "../../../../../modules/auth/session";
import { FakeOcrProvider } from "../../../../../modules/invoices/fake-ocr-provider";
import { resolveDefaultInvoiceRepository } from "../../../../../modules/invoices/invoice-service";
import { getJobDependencies } from "../../../../../modules/jobs/job-service";
import { processOcrJob } from "../../../../../modules/jobs/ocr-worker";
import { resolveOnboardingActor } from "../../../../../modules/tenancy/business-service";

type RouteContext = { params: Promise<{ jobId: string }> };

export async function POST(_request: Request, context: RouteContext) {
  if (process.env.AUTH_MODE !== "development" && process.env.AUTH_MODE !== "test") {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found." } }, { status: 404 });
  }

  const identity = getCurrentIdentity();
  if (!identity) return NextResponse.json({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } }, { status: 401 });

  const { jobId } = await context.params;
  const jobs = getJobDependencies().jobs;
  const job = await jobs.findById(jobId);
  const localUserId = await resolveOnboardingActor(getJobDependencies().tenancyRepository, identity);
  if (!job || job.requestedBy !== localUserId) {
    return NextResponse.json({ error: { code: "JOB_NOT_FOUND", message: "OCR job not found." } }, { status: 404 });
  }

  await processOcrJob(job.id, { ocrProvider: new FakeOcrProvider() });
  const processedJob = await jobs.findById(job.id);
  const invoice = processedJob?.status === "completed"
    ? await resolveDefaultInvoiceRepository().findByDocumentId(job.documentId)
    : null;
  if (!processedJob || processedJob.status !== "completed" || !invoice) {
    return NextResponse.json({ error: { code: "OCR_PROCESSING_FAILED", message: "The OCR request could not be processed." } }, { status: 500 });
  }

  return NextResponse.json({ job: processedJob, invoice });
}
