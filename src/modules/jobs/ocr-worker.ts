import type { OcrProvider } from "../invoices/ocr-provider";
import { FakeOcrProvider } from "../invoices/fake-ocr-provider";
import {
  createInvoiceFromOcr,
  resolveDefaultDocumentRepository,
  resolveDefaultStorage,
  setDocumentState,
  type InvoiceRepository,
} from "../invoices/invoice-service";
import type { DocumentRepository } from "../documents/document-service";
import type { StorageAdapter } from "../documents/storage-adapter";
import { defaultOnboardingRepository, type OnboardingRepository } from "../tenancy/business-service";
import { BusinessLifecycleError, requireBusinessOperational } from "../tenancy/business-lifecycle-service";
import { createTenantContext } from "../tenancy/tenant-context";
import {
  getJobDependencies,
  JOB_ERROR_CODES,
  JobError,
  type Job,
  type JobRepository,
  type JobServiceDependencies,
} from "./job-service";

const MAX_RETRY_COUNT = 3;
const GENERIC_FAILURE = "OCR processing failed.";

export interface OcrWorkerDependencies extends JobServiceDependencies {
  tenancyRepository?: OnboardingRepository;
  documentRepository?: DocumentRepository;
  invoices?: InvoiceRepository;
  jobs?: JobRepository;
  storage?: StorageAdapter;
  ocrProvider?: OcrProvider;
}

function bytesFrom(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Response(stream).arrayBuffer().then((buffer) => new Uint8Array(buffer));
}

async function failJob(job: Job, jobs: JobRepository): Promise<void> {
  const nextRetryCount = Math.min(MAX_RETRY_COUNT, job.retryCount + 1);
  await jobs.update({ ...job, status: "failed", retryCount: nextRetryCount, errorSummary: GENERIC_FAILURE, updatedAt: new Date().toISOString() });
}

export interface OcrWorker {
  processOcrJob(jobId: string): Promise<void>;
}

export function createOcrWorker(input: OcrWorkerDependencies = {}): OcrWorker {
  return {
    async processOcrJob(jobId) {
      const deps = getJobDependencies(input);
      const jobs = deps.jobs;
      const job = await jobs.findById(jobId);
      if (!job) throw new JobError(JOB_ERROR_CODES.JOB_NOT_FOUND);
      if (job.status === "completed" || (job.status === "failed" && job.retryCount >= MAX_RETRY_COUNT)) return;

      const document = await deps.documentRepository.findById(job.documentId);
      if (!document) {
        await failJob(job, jobs);
        return;
      }

      let processing: Job | null = null;
      try {
        if (job.businessId !== document.businessId) throw new Error("job business mismatch");
        const requesterMembership = await createTenantContext(deps.tenancyRepository).getMembership(job.requestedBy, document.businessId);
        if (!requesterMembership?.isActive) throw new Error("requester membership inactive");
        await requireBusinessOperational(deps.tenancyRepository, document.businessId);
        processing = await jobs.claim(job.id);
        if (!processing) return;
        const storage = input.storage ?? resolveDefaultStorage();
        const data = await bytesFrom(await storage.get(document.privateObjectKey));
        const provider = input.ocrProvider ?? new FakeOcrProvider();
        const result = await provider.extract({
          documentId: document.id,
          fileName: document.originalFileName,
          mimeType: document.originalMimeType,
          data,
        });
        const invoice = await createInvoiceFromOcr(document.businessId, document.id as import("../invoices/ocr-provider").DocumentId, result, {
          tenancyRepository: input.tenancyRepository ?? defaultOnboardingRepository,
          documentRepository: input.documentRepository ?? resolveDefaultDocumentRepository(),
          invoices: input.invoices,
        });
         await setDocumentState(deps.documentRepository, document.id as import("../invoices/ocr-provider").DocumentId, invoice.reviewState === "approved" ? "approved" : "needs_review");
        await jobs.update({ ...processing, status: "completed", errorSummary: null, updatedAt: new Date().toISOString() });
      } catch (error) {
        await setDocumentState(deps.documentRepository, document.id as import("../invoices/ocr-provider").DocumentId, "failed");
        if (error instanceof BusinessLifecycleError) {
          await failJob(processing ?? job, jobs);
          return;
        }
        await failJob(processing ?? job, jobs);
      }
    },
  };
}

export function processOcrJob(jobId: string, input: OcrWorkerDependencies = {}): Promise<void> {
  return createOcrWorker(input).processOcrJob(jobId);
}
