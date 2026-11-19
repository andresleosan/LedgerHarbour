import { defaultOnboardingRepository, resolveOnboardingActor, type OnboardingActor, type OnboardingRepository } from "../tenancy/business-service";
import { BusinessLifecycleError, LIFECYCLE_ERROR_CODES, requireBusinessOperational } from "../tenancy/business-lifecycle-service";
import { createTenantContext } from "../tenancy/tenant-context";
import type { UserId } from "../tenancy/types";
import type { DocumentRepository } from "../documents/document-service";
import {
  createInvoiceFromOcr,
  resolveDefaultDocumentRepository,
  resolveDefaultInvoiceRepository,
  type InvoiceDependencies,
  type InvoiceRepository,
} from "../invoices/invoice-service";
import { OCR_FIELD_NAMES, type DocumentId, type InvoiceId, type OcrResult } from "../invoices/ocr-provider";
export type { DocumentId } from "../invoices/ocr-provider";

export const JOB_STATUSES = ["queued", "processing", "completed", "failed"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** A reading is attempted at most this many times; afterwards the invoice is filled in by hand. */
export const MAX_RETRY_COUNT = 3;

export const JOB_ERROR_CODES = {
  INVALID_JOB_REQUEST: "INVALID_JOB_REQUEST",
  DOCUMENT_NOT_FOUND: "DOCUMENT_NOT_FOUND",
  BUSINESS_ACCESS_DENIED: "BUSINESS_ACCESS_DENIED",
  INACTIVE_BUSINESS: "INACTIVE_BUSINESS",
  OCR_JOB_CONFLICT: "OCR_JOB_CONFLICT",
  JOB_NOT_FOUND: "JOB_NOT_FOUND",
  OCR_RETRIES_EXHAUSTED: "OCR_RETRIES_EXHAUSTED",
  DOCUMENT_NOT_FAILED: "DOCUMENT_NOT_FAILED",
} as const;
export type JobErrorCode = (typeof JOB_ERROR_CODES)[keyof typeof JOB_ERROR_CODES];

const messages: Record<JobErrorCode, string> = {
  INVALID_JOB_REQUEST: "The OCR job request is invalid.",
  DOCUMENT_NOT_FOUND: "Document not found.",
  BUSINESS_ACCESS_DENIED: "Business access denied.",
  INACTIVE_BUSINESS: "This business is inactive.",
  OCR_JOB_CONFLICT: "An OCR job already exists for this document.",
  JOB_NOT_FOUND: "OCR job not found.",
  OCR_RETRIES_EXHAUSTED: "This document could not be read. Fill the invoice in by hand.",
  DOCUMENT_NOT_FAILED: "Only a document whose reading failed can be filled in by hand.",
};

export class JobError extends Error {
  readonly name = "JobError";

  constructor(readonly code: JobErrorCode) {
    super(messages[code]);
  }
}

/**
 * In development every route bundle has its own copy of this module while the in-memory
 * repositories are shared through globalThis, so `instanceof` alone misses their errors.
 */
export function asJobError(error: unknown): JobError | null {
  if (error instanceof JobError) return error;
  const candidate = error as { name?: unknown; code?: unknown } | null;
  if (candidate?.name === "JobError" && typeof candidate.code === "string" && Object.hasOwn(messages, candidate.code)) {
    return new JobError(candidate.code as JobErrorCode);
  }
  return null;
}

export interface Job {
  id: string;
  businessId: string;
  documentId: DocumentId;
  jobType: "ocr";
  status: JobStatus;
  retryCount: number;
  errorSummary: string | null;
  requestedBy: UserId;
  createdAt: string;
  updatedAt: string;
}

export interface JobRepository {
  transaction<T>(operation: () => Promise<T>): Promise<T>;
  create(job: Job): Promise<Job>;
  findById(jobId: string): Promise<Job | null>;
  findByDocumentId(documentId: DocumentId): Promise<Job | null>;
  createOrReuse(factory: () => Job): Promise<Job>;
  claim(jobId: string): Promise<Job | null>;
  update(job: Job): Promise<Job>;
}

export class InMemoryJobRepository implements JobRepository {
  readonly jobs = new Map<string, Job>();
  private nextId = 1;
  private writeTail: Promise<void> = Promise.resolve();

  async transaction<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.writeTail;
    let release!: () => void;
    this.writeTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async create(job: Job): Promise<Job> {
    if ([...this.jobs.values()].some((candidate) => candidate.documentId === job.documentId && candidate.jobType === "ocr")) {
      throw new JobError(JOB_ERROR_CODES.OCR_JOB_CONFLICT);
    }
    this.jobs.set(job.id, { ...job });
    return { ...job };
  }

  async findById(jobId: string): Promise<Job | null> {
    const job = this.jobs.get(jobId);
    return job ? { ...job } : null;
  }

  async findByDocumentId(documentId: DocumentId): Promise<Job | null> {
    const job = [...this.jobs.values()].find((candidate) => candidate.documentId === documentId && candidate.jobType === "ocr");
    return job ? { ...job } : null;
  }

  async createOrReuse(factory: () => Job): Promise<Job> {
    return this.transaction(async () => {
      const candidate = factory();
      const existing = await this.findByDocumentId(candidate.documentId);
      if (existing) {
        if (existing.status === "queued" || existing.status === "processing") return existing;
        if (existing.status === "failed") {
          if (existing.retryCount >= MAX_RETRY_COUNT) throw new JobError(JOB_ERROR_CODES.OCR_RETRIES_EXHAUSTED);
          return this.update({ ...existing, status: "queued", updatedAt: new Date().toISOString() });
        }
        throw new JobError(JOB_ERROR_CODES.OCR_JOB_CONFLICT);
      }
      return this.create(candidate);
    });
  }

  async claim(jobId: string): Promise<Job | null> {
    return this.transaction(async () => {
      const current = this.jobs.get(jobId);
      if (!current || current.status === "completed" || current.status === "processing" || (current.status === "failed" && current.retryCount >= MAX_RETRY_COUNT)) {
        return null;
      }
      const claimed = { ...current, status: "processing" as const, updatedAt: new Date().toISOString() };
      this.jobs.set(jobId, claimed);
      return { ...claimed };
    });
  }

  async update(job: Job): Promise<Job> {
    if (!this.jobs.has(job.id)) throw new JobError(JOB_ERROR_CODES.JOB_NOT_FOUND);
    this.jobs.set(job.id, { ...job });
    return { ...job };
  }

  nextJobId(): string {
    return `ocr-job-${this.nextId++}`;
  }
}

export function createJobRepository(): InMemoryJobRepository {
  return new InMemoryJobRepository();
}

const JOB_REPOSITORY_KEY = Symbol.for("ledgerharbour.task8.inMemoryJobRepository");
type GlobalState = typeof globalThis & { [key: symbol]: unknown };

export function resolveDefaultJobRepository(): JobRepository {
  const state = globalThis as GlobalState;
  const existing = state[JOB_REPOSITORY_KEY] as JobRepository | undefined;
  if (
    existing &&
    typeof existing.transaction === "function" &&
    typeof existing.create === "function" &&
    typeof existing.findById === "function" &&
    typeof existing.findByDocumentId === "function" &&
    typeof existing.createOrReuse === "function" &&
    typeof existing.claim === "function" &&
    typeof existing.update === "function"
  ) return existing;
  const repository = createJobRepository();
  Object.defineProperty(state, JOB_REPOSITORY_KEY, { configurable: false, enumerable: false, writable: false, value: repository });
  return repository;
}

export interface JobServiceDependencies extends InvoiceDependencies {
  tenancyRepository?: OnboardingRepository;
  documentRepository?: DocumentRepository;
  invoices?: InvoiceRepository;
  jobs?: JobRepository;
}

function resolved(input: JobServiceDependencies = {}) {
  return {
    tenancyRepository: input.tenancyRepository ?? defaultOnboardingRepository,
    documentRepository: input.documentRepository ?? resolveDefaultDocumentRepository(),
    jobs: input.jobs ?? resolveDefaultJobRepository(),
  };
}

async function validateDocumentAccess(documentId: DocumentId, actorId: UserId, input: JobServiceDependencies) {
  const deps = resolved(input);
  const document = await deps.documentRepository.findById(documentId);
  if (!document) throw new JobError(JOB_ERROR_CODES.DOCUMENT_NOT_FOUND);
  const membership = await createTenantContext(deps.tenancyRepository).getMembership(actorId, document.businessId);
  if (membership?.status !== "active" || !membership.isActive) throw new JobError(JOB_ERROR_CODES.BUSINESS_ACCESS_DENIED);
  try {
    await requireBusinessOperational(deps.tenancyRepository, document.businessId);
  } catch (error) {
    if (error instanceof BusinessLifecycleError && error.code === LIFECYCLE_ERROR_CODES.INACTIVE_BUSINESS) throw new JobError(JOB_ERROR_CODES.INACTIVE_BUSINESS);
    throw new JobError(JOB_ERROR_CODES.BUSINESS_ACCESS_DENIED);
  }
  return document;
}

export interface JobService {
  queueOcr(documentId: DocumentId, actor: OnboardingActor): Promise<Job>;
}

function idFor(repository: JobRepository): string {
  const candidate = repository as JobRepository & { nextJobId?: () => string };
  return candidate.nextJobId?.() ?? `ocr-job-${Date.now()}`;
}

export function createJobService(input: JobServiceDependencies = {}): JobService {
  return {
    async queueOcr(documentId, actor) {
      if (typeof documentId !== "string" || !documentId.trim()) {
        throw new JobError(JOB_ERROR_CODES.INVALID_JOB_REQUEST);
      }
      const deps = resolved(input);
      let actorId: UserId;
      try {
        actorId = await resolveOnboardingActor(deps.tenancyRepository, actor);
      } catch {
        throw new JobError(JOB_ERROR_CODES.INVALID_JOB_REQUEST);
      }
      const document = await validateDocumentAccess(documentId, actorId, input);
      return deps.jobs.createOrReuse(() => {
        const now = new Date().toISOString();
        return {
          id: idFor(deps.jobs),
          businessId: document.businessId,
          documentId: document.id as DocumentId,
          jobType: "ocr",
          status: "queued",
          retryCount: 0,
          errorSummary: null,
          requestedBy: actorId,
          createdAt: now,
          updatedAt: now,
        };
      });
    },
  };
}

export function queueOcr(documentId: DocumentId, actor: OnboardingActor, input: JobServiceDependencies = {}): Promise<Job> {
  return createJobService(input).queueOcr(documentId, actor);
}

export function getJobDependencies(input: JobServiceDependencies = {}) {
  const deps = resolved(input);
  return { ...deps, input };
}

const EMPTY_READING: OcrResult = {
  fields: Object.fromEntries(OCR_FIELD_NAMES.map((field) => [field, null])) as unknown as OcrResult["fields"],
  confidence: Object.fromEntries(OCR_FIELD_NAMES.map((field) => [field, 0])) as OcrResult["confidence"],
};

/**
 * Creates the document's one invoice with every field empty so it is filled in by hand on the
 * review page. The job ends as "completed": the reading step is over and no longer blocks the invoice.
 */
export async function createManualInvoice(documentId: DocumentId, actor: OnboardingActor, input: JobServiceDependencies = {}): Promise<InvoiceId> {
  if (typeof documentId !== "string" || !documentId.trim()) throw new JobError(JOB_ERROR_CODES.INVALID_JOB_REQUEST);
  const deps = resolved(input);
  let actorId: UserId;
  try {
    actorId = await resolveOnboardingActor(deps.tenancyRepository, actor);
  } catch {
    throw new JobError(JOB_ERROR_CODES.INVALID_JOB_REQUEST);
  }
  const document = await validateDocumentAccess(documentId, actorId, input);
  const invoices = input.invoices ?? resolveDefaultInvoiceRepository();
  // The PostgreSQL tenancy transaction only passes through the error types it knows.
  let rejection: JobError | undefined;

  const createInTransaction = async (tenancy: OnboardingRepository): Promise<InvoiceId> => {
    const current = await deps.documentRepository.findById(documentId);
    if (current?.status !== "failed" || await invoices.findByDocumentId(documentId)) {
      rejection = new JobError(JOB_ERROR_CODES.DOCUMENT_NOT_FAILED);
      throw rejection;
    }
    const job = await deps.jobs.findByDocumentId(documentId);
    const invoice = await createInvoiceFromOcr(document.businessId, documentId, EMPTY_READING, { ...input, invoices });
    try {
      await deps.documentRepository.setStatus(documentId, "needs_review");
      if (job) await deps.jobs.update({ ...job, status: "completed", errorSummary: null, updatedAt: new Date().toISOString() });
      await tenancy.appendAuditEvent({ businessId: document.businessId, actorId, type: "invoice_created_manually", entityId: invoice.id });
    } catch (error) {
      await deps.documentRepository.setStatus(documentId, "failed");
      if (job) await deps.jobs.update(job);
      throw error;
    }
    return invoice.id;
  };

  try {
    if (input.transaction) return await input.transaction(createInTransaction);
    return await invoices.transaction(() => deps.tenancyRepository.transaction((transaction) => createInTransaction(transaction)));
  } catch (error) {
    throw rejection ?? error;
  }
}
