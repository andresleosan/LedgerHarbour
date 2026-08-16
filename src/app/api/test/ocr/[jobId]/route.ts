import { NextResponse } from "next/server";

import { getCurrentIdentity } from "../../../../../modules/auth/session";
import { FakeOcrProvider } from "../../../../../modules/invoices/fake-ocr-provider";
import { getJobDependencies } from "../../../../../modules/jobs/job-service";
import { processOcrJob } from "../../../../../modules/jobs/ocr-worker";
import { resolveOnboardingActor } from "../../../../../modules/tenancy/business-service";
import { getPersistenceContext } from "../../../../../modules/persistence/repository-factory";

type RouteContext = { params: Promise<{ jobId: string }> };

export async function POST(_request: Request, context: RouteContext) {
  if (process.env.AUTH_MODE !== "development" && process.env.AUTH_MODE !== "test") {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found." } }, { status: 404 });
  }

  const identity = await getCurrentIdentity();
  if (!identity) return NextResponse.json({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } }, { status: 401 });

  const { jobId } = await context.params;
  const persistence = getPersistenceContext();
  const dependencies = {
    tenancyRepository: persistence.tenancyRepository,
    documentRepository: persistence.documentRepository,
    invoices: persistence.invoiceRepository,
    jobs: persistence.jobRepository,
    storage: persistence.storage,
  };
  const jobs = getJobDependencies(dependencies).jobs;
  const job = await jobs.findById(jobId);
  const localUserId = await resolveOnboardingActor(persistence.tenancyRepository, identity);
  if (!job || job.requestedBy !== localUserId) {
    return NextResponse.json({ error: { code: "JOB_NOT_FOUND", message: "OCR job not found." } }, { status: 404 });
  }

  await processOcrJob(job.id, { ...dependencies, ocrProvider: new FakeOcrProvider() });
  const processedJob = await jobs.findById(job.id);
  const invoice = processedJob?.status === "completed"
    ? await persistence.invoiceRepository.findByDocumentId(job.documentId)
    : null;
  if (!processedJob || processedJob.status !== "completed" || !invoice) {
    return NextResponse.json({ error: { code: "OCR_PROCESSING_FAILED", message: "The OCR request could not be processed." } }, { status: 500 });
  }

  return NextResponse.json({ job: processedJob, invoice });
}
