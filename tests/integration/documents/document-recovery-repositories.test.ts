import { describe, expect, it } from "vitest";

import { auditEvents } from "../../../src/db/schema";
import { createTestDatabase } from "../../../src/db/test-database";
import type { AuthIdentity } from "../../../src/modules/auth/auth-provider";
import { createDocument, createDocumentRepository, type DocumentRepository } from "../../../src/modules/documents/document-service";
import type { StorageAdapter } from "../../../src/modules/documents/storage-adapter";
import { createInvoiceRepository, type InvoiceRepository } from "../../../src/modules/invoices/invoice-service";
import type { DocumentId } from "../../../src/modules/invoices/ocr-provider";
import { createJobRepository, createManualInvoice, MAX_RETRY_COUNT, type Job, type JobRepository } from "../../../src/modules/jobs/job-service";
import { createPersistenceContext } from "../../../src/modules/persistence/repository-factory";
import { createInMemoryOnboardingRepository, type OnboardingRepository } from "../../../src/modules/tenancy/business-service";
import type { BusinessId, UserId } from "../../../src/modules/tenancy/types";
import { createApprovedBusiness } from "../../helpers/business-fixtures";

const identity = (providerUserId: string): AuthIdentity => ({
  providerUserId,
  email: `${providerUserId}@example.com`,
  displayName: providerUserId,
  emailVerified: true,
});

class RecordingStorage implements StorageAdapter {
  readonly objects = new Set<string>();
  async put(input: { objectKey: string; data: Uint8Array }) {
    this.objects.add(input.objectKey);
    return { objectKey: input.objectKey, sizeBytes: input.data.byteLength };
  }
  async get(): Promise<ReadableStream<Uint8Array>> { throw new Error("unused"); }
  async delete(objectKey: string) { this.objects.delete(objectKey); }
}

interface Mode {
  tenancyRepository: OnboardingRepository;
  documentRepository: DocumentRepository;
  jobs: JobRepository;
  invoices: InvoiceRepository;
  transaction?: <T>(operation: (tenancy: OnboardingRepository) => Promise<T>) => Promise<T>;
  auditActions(): Promise<string[]>;
  close(): Promise<void>;
}

async function memoryMode(): Promise<Mode> {
  const tenancyRepository = createInMemoryOnboardingRepository();
  return {
    tenancyRepository,
    documentRepository: createDocumentRepository(),
    jobs: createJobRepository(),
    invoices: createInvoiceRepository(),
    auditActions: async () => tenancyRepository.auditEvents.map((event) => event.type),
    close: async () => {},
  };
}

async function postgresMode(): Promise<Mode> {
  const state = await createTestDatabase();
  const context = createPersistenceContext({ mode: "postgres", database: state.db });
  return {
    tenancyRepository: context.tenancyRepository,
    documentRepository: context.documentRepository,
    jobs: context.jobRepository,
    invoices: context.invoiceRepository,
    transaction: context.transaction,
    auditActions: async () => (await state.db.select().from(auditEvents)).map((event) => event.action),
    close: state.close,
  };
}

const upload = (checksum: string, name = "invoice.pdf") => ({
  originalFileName: name,
  originalMimeType: "application/pdf",
  originalSizeBytes: 4,
  checksum,
  data: new Uint8Array([1, 2, 3, 4]),
  format: "pdf" as const,
});

async function fixture(create: () => Promise<Mode>) {
  const mode = await create();
  const business = await createApprovedBusiness(mode.tenancyRepository, "Recovery Books", identity("owner"));
  const other = await createApprovedBusiness(mode.tenancyRepository, "Other Books", identity("other-owner"));
  const storage = new RecordingStorage();
  const dependencies = { ...mode, storage };
  const ownerId = business.createdBy as UserId;

  async function failedDocument(checksum: string, retryCount = MAX_RETRY_COUNT) {
    const document = await createDocument({ businessId: business.id, upload: upload(checksum) }, identity("owner"), dependencies);
    await mode.documentRepository.setStatus(document.id, "failed");
    const now = new Date().toISOString();
    const job: Job = {
      id: `job-${checksum}`,
      businessId: business.id,
      documentId: document.id as DocumentId,
      jobType: "ocr",
      status: "failed",
      retryCount,
      errorSummary: "OCR processing failed.",
      requestedBy: ownerId,
      createdAt: now,
      updatedAt: now,
    };
    await mode.jobs.create(job);
    return { document: (await mode.documentRepository.findById(document.id))!, job };
  }

  return { ...mode, business, other, storage, dependencies, ownerId, failedDocument };
}

describe.each([
  ["memory", memoryMode],
  ["postgres", postgresMode],
] as const)("document recovery repositories (%s)", (_name, create) => {
  it("finds a document by checksum within its business and replaces only a failed upload", async () => {
    const state = await fixture(create);
    try {
      const { document } = await state.failedDocument("checksum-replace");
      const repository = state.documentRepository;

      await expect(repository.findByChecksum!(state.business.id, "checksum-replace")).resolves.toMatchObject({ id: document.id });
      await expect(repository.findByChecksum!(state.other.id as BusinessId, "checksum-replace")).resolves.toBeNull();

      const replacement = { privateObjectKey: `business/${state.business.id}/documents/replacement`, originalFileName: "again.png", originalMimeType: "image/png", originalSizeBytes: 9 };
      await expect(repository.replaceFailedUpload!(document.id, replacement)).resolves.toMatchObject({ ...replacement, id: document.id, status: "uploaded", checksum: "checksum-replace" });
      await expect(repository.replaceFailedUpload!(document.id, { ...replacement, privateObjectKey: "second" })).resolves.toBeNull();
      await expect(repository.findById(document.id)).resolves.toMatchObject({ privateObjectKey: replacement.privateObjectKey });
    } finally {
      await state.close();
    }
  }, 30_000);

  it("re-queues the same failed job while attempts remain and refuses once they are used up", async () => {
    const state = await fixture(create);
    try {
      const { job } = await state.failedDocument("checksum-retry", 1);
      const candidate = () => ({ ...job, id: "job-should-not-be-created", status: "queued" as const, retryCount: 0 });

      const requeued = await Promise.all([state.jobs.createOrReuse(candidate), state.jobs.createOrReuse(candidate)]);

      expect(requeued.map((value) => value.id)).toEqual([job.id, job.id]);
      expect(requeued.map((value) => value.status)).toEqual(["queued", "queued"]);
      await expect(state.jobs.findById(job.id)).resolves.toMatchObject({ status: "queued", retryCount: 1 });

      await state.jobs.update({ ...job, status: "failed", retryCount: MAX_RETRY_COUNT });
      await expect(state.jobs.createOrReuse(candidate)).rejects.toMatchObject({ code: "OCR_RETRIES_EXHAUSTED" });
      await expect(state.jobs.findById("job-should-not-be-created")).resolves.toBeNull();
    } finally {
      await state.close();
    }
  }, 30_000);

  it("re-uploads a failed file onto the same document with a fresh reading", async () => {
    const state = await fixture(create);
    try {
      const { document, job } = await state.failedDocument("checksum-reupload");
      expect(state.storage.objects.has(document.privateObjectKey)).toBe(true);

      const reuploaded = await createDocument({ businessId: state.business.id, upload: upload("checksum-reupload", "photo-again.pdf") }, identity("owner"), state.dependencies);

      expect(reuploaded).toMatchObject({ id: document.id, status: "uploaded", originalFileName: "photo-again.pdf" });
      expect(reuploaded.privateObjectKey).not.toBe(document.privateObjectKey);
      expect([...state.storage.objects]).toEqual([reuploaded.privateObjectKey]);
      await expect(state.jobs.findById(job.id)).resolves.toMatchObject({ status: "queued", retryCount: 0, errorSummary: null });
      await expect(state.documentRepository.listByBusinessId(state.business.id)).resolves.toHaveLength(1);

      await expect(createDocument({ businessId: state.business.id, upload: upload("checksum-reupload") }, identity("owner"), state.dependencies))
        .rejects.toMatchObject({ code: "DOCUMENT_DUPLICATE_CHECKSUM" });
      expect([...state.storage.objects]).toEqual([reuploaded.privateObjectKey]);
    } finally {
      await state.close();
    }
  }, 30_000);

  it("lets only one of two simultaneous re-uploads of a failed file win", async () => {
    const state = await fixture(create);
    try {
      const { document } = await state.failedDocument("checksum-race");

      const results = await Promise.allSettled([
        createDocument({ businessId: state.business.id, upload: upload("checksum-race") }, identity("owner"), state.dependencies),
        createDocument({ businessId: state.business.id, upload: upload("checksum-race") }, identity("owner"), state.dependencies),
      ]);

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "DOCUMENT_DUPLICATE_CHECKSUM" } });
      const current = await state.documentRepository.findById(document.id);
      expect([...state.storage.objects]).toEqual([current!.privateObjectKey]);
    } finally {
      await state.close();
    }
  }, 30_000);

  it("creates one empty invoice by hand for a failed document and audits it", async () => {
    const state = await fixture(create);
    try {
      const { document, job } = await state.failedDocument("checksum-manual");
      const documentId = document.id as DocumentId;

      await expect(createManualInvoice(documentId, identity("other-owner"), state.dependencies)).rejects.toMatchObject({ code: "BUSINESS_ACCESS_DENIED" });

      const invoiceId = await createManualInvoice(documentId, identity("owner"), state.dependencies);

      await expect(state.invoices.findById(invoiceId)).resolves.toMatchObject({ documentId, supplier: null, total: null, reviewState: "needs_review" });
      await expect(state.documentRepository.getStatus(documentId)).resolves.toBe("needs_review");
      await expect(state.jobs.findById(job.id)).resolves.toMatchObject({ status: "completed" });
      await expect(state.auditActions()).resolves.toContain("invoice_created_manually");
      await expect(createManualInvoice(documentId, identity("owner"), state.dependencies)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FAILED" });
      await expect(state.invoices.listByBusinessId(state.business.id)).resolves.toHaveLength(1);
    } finally {
      await state.close();
    }
  }, 30_000);
});
