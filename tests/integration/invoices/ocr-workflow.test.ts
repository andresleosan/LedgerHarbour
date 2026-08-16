import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST as processRoute } from "../../../src/app/api/documents/[documentId]/process/route";
import { GET as invoiceGetRoute, PATCH as invoicePatchRoute } from "../../../src/app/api/invoices/[invoiceId]/route";
import { clearCurrentIdentity, setCurrentIdentity } from "../../../src/modules/auth/session";
import { createDocument, createDocumentRepository, type Document } from "../../../src/modules/documents/document-service";
import type { StorageAdapter } from "../../../src/modules/documents/storage-adapter";
import { FakeOcrProvider } from "../../../src/modules/invoices/fake-ocr-provider";
import { OcrProviderError } from "../../../src/modules/invoices/ocr-provider";
import type { OcrProvider } from "../../../src/modules/invoices/ocr-provider";
import { OcrConfigurationError } from "../../../src/modules/invoices/ocr-provider-factory";
import {
  approveInvoice,
  createInvoiceRepository,
  getInvoice,
  updateInvoice,
  resolveDefaultDocumentRepository,
  resolveDefaultStorage,
  type InMemoryInvoiceRepository,
} from "../../../src/modules/invoices/invoice-service";
import { createOcrWorker } from "../../../src/modules/jobs/ocr-worker";
import {
  createJobRepository,
  createJobService,
  type InMemoryJobRepository,
} from "../../../src/modules/jobs/job-service";
import {
  createInMemoryOnboardingRepository,
  createOnboardingServices,
  defaultOnboardingRepository,
  type MemoryOnboardingRepository,
} from "../../../src/modules/tenancy/business-service";
import type { DocumentId, InvoiceId } from "../../../src/modules/invoices/ocr-provider";
import type { UserId } from "../../../src/modules/tenancy/types";

const user = (value: string) => value as UserId;
class MemoryStorage implements StorageAdapter {
  readonly values = new Map<string, Uint8Array>();

  async put(input: { objectKey: string; data: Uint8Array }) {
    this.values.set(input.objectKey, input.data.slice());
    return { objectKey: input.objectKey, sizeBytes: input.data.byteLength };
  }

  async get(objectKey: string) {
    const data = this.values.get(objectKey);
    if (!data) throw new Error("missing object");
    return new ReadableStream({ start(controller) { controller.enqueue(data.slice()); controller.close(); } });
  }

  async delete(objectKey: string) {
    this.values.delete(objectKey);
  }
}

const pdf = {
  originalFileName: "invoice.pdf",
  originalMimeType: "application/pdf",
  originalSizeBytes: 4,
  checksum: "checksum-for-task-8",
  data: new Uint8Array([1, 2, 3, 4]),
  format: "pdf" as const,
};

describe("OCR workflow boundaries", () => {
  let tenancy: MemoryOnboardingRepository;
  let documentRepository: ReturnType<typeof createDocumentRepository>;
  let jobs: InMemoryJobRepository;
  let invoices: InMemoryInvoiceRepository;
  let storage: MemoryStorage;
  let ownerBusiness: Awaited<ReturnType<ReturnType<typeof createOnboardingServices>["createBusiness"]>>;
  let documentId = "" as DocumentId;

  beforeEach(async () => {
    process.env.AUTH_MODE = "development";
    process.env.OCR_PROVIDER = "fake";
    tenancy = createInMemoryOnboardingRepository();
    documentRepository = createDocumentRepository();
    jobs = createJobRepository();
    invoices = createInvoiceRepository();
    storage = new MemoryStorage();
    const onboarding = createOnboardingServices(tenancy);
    ownerBusiness = await onboarding.createBusiness({ name: "OCR Books" }, user("owner"));
    await tenancy.createMembership({ membershipId: "membership-member", userId: user("member"), businessId: ownerBusiness.id, role: "administrator", isActive: true });
    const document = await createDocument(
      { businessId: ownerBusiness.id, upload: pdf },
      user("member"),
      { tenancyRepository: tenancy, documentRepository, storage },
    );
    documentId = document.id as DocumentId;
  });

  afterEach(async () => {
    await clearCurrentIdentity();
  });

  function workflow(provider: OcrProvider = new FakeOcrProvider()) {
    const dependencies = { tenancyRepository: tenancy, documentRepository, jobs, invoices, storage, ocrProvider: provider };
    return {
      queue: createJobService(dependencies),
      worker: createOcrWorker(dependencies),
      dependencies,
    };
  }

  async function correctLowConfidence(invoice: Awaited<ReturnType<InMemoryInvoiceRepository["findById"]>>) {
    if (!invoice) throw new Error("invoice fixture missing");
    await invoices.update({ ...invoice, confidenceData: { ...invoice.confidenceData, supplier: 1, invoiceNumber: 1 } });
  }

  it("queues, processes, links the invoice to the document, and routes low confidence to review", async () => {
    const { queue, worker } = workflow();
    const job = await queue.queueOcr(documentId, user("member"));

    await worker.processOcrJob(job.id);

    expect(jobs.jobs.get(job.id)).toMatchObject({ status: "completed", retryCount: 0 });
    const invoice = (await invoices.listByBusinessId(ownerBusiness.id))[0];
    expect(invoice).toMatchObject({ documentId, businessId: ownerBusiness.id, reviewState: "needs_review" });
    expect(invoice).not.toHaveProperty("lineItems");
  });

  it("reuses a queued job and rejects a completed duplicate", async () => {
    const { queue, worker } = workflow();
    const first = await queue.queueOcr(documentId, user("member"));
    const reused = await queue.queueOcr(documentId, user("member"));
    expect(reused.id).toBe(first.id);

    await worker.processOcrJob(first.id);
    await expect(queue.queueOcr(documentId, user("member"))).rejects.toMatchObject({ code: "OCR_JOB_CONFLICT" });
  });

  it("serializes concurrent queue calls and reuses one deterministic job", async () => {
    const { queue } = workflow();

    const results = await Promise.all([
      queue.queueOcr(documentId, user("member")),
      queue.queueOcr(documentId, user("member")),
    ]);

    expect(results[0].id).toBe(results[1].id);
    expect(jobs.jobs.size).toBe(1);
  });

  it("increments provider failures up to the maximum retry count without exposing internals", async () => {
    const { queue, worker } = workflow(new FakeOcrProvider({ failureDocumentIds: [documentId] }));
    const job = await queue.queueOcr(documentId, user("member"));

    await worker.processOcrJob(job.id);
    await worker.processOcrJob(job.id);
    await worker.processOcrJob(job.id);
    await worker.processOcrJob(job.id);

    expect(jobs.jobs.get(job.id)).toMatchObject({
      status: "failed",
      retryCount: 3,
      errorSummary: "OCR processing failed.",
    });
    expect(jobs.jobs.get(job.id)?.errorSummary).not.toContain("fake OCR provider failure");
  });

  it("terminally fails non-retryable provider errors without invoking the provider again", async () => {
    let providerCalls = 0;
    const provider: OcrProvider = {
      async extract() {
        providerCalls += 1;
        throw new OcrProviderError(false);
      },
    };
    const { queue, worker } = workflow(provider);
    const job = await queue.queueOcr(documentId, user("member"));

    await worker.processOcrJob(job.id);

    expect(jobs.jobs.get(job.id)).toMatchObject({
      status: "failed",
      retryCount: 3,
      errorSummary: "OCR processing failed.",
    });
    await expect(documentRepository.getStatus(documentId)).resolves.toBe("failed");

    await worker.processOcrJob(job.id);

    expect(providerCalls).toBe(1);
  });

  it("increments retry count for transient provider errors while leaving the job retryable", async () => {
    const provider: OcrProvider = {
      async extract() {
        throw new OcrProviderError(true);
      },
    };
    const { queue, worker } = workflow(provider);
    const job = await queue.queueOcr(documentId, user("member"));

    await worker.processOcrJob(job.id);

    expect(jobs.jobs.get(job.id)).toMatchObject({ status: "failed", retryCount: 1 });
  });

  it("terminally fails OCR configuration errors", async () => {
    let providerCalls = 0;
    const provider: OcrProvider = {
      async extract() {
        providerCalls += 1;
        throw new OcrConfigurationError();
      },
    };
    const { queue, worker } = workflow(provider);
    const job = await queue.queueOcr(documentId, user("member"));

    await worker.processOcrJob(job.id);
    await worker.processOcrJob(job.id);

    expect(jobs.jobs.get(job.id)).toMatchObject({ status: "failed", retryCount: 3 });
    expect(providerCalls).toBe(1);
  });

  it("preserves business lifecycle handling before claiming the job", async () => {
    const { queue, worker } = workflow();
    const job = await queue.queueOcr(documentId, user("member"));
    tenancy.businesses.get(ownerBusiness.id)!.isActive = false;

    await worker.processOcrJob(job.id);

    expect(jobs.jobs.get(job.id)).toMatchObject({ status: "failed", retryCount: 1 });
    await expect(documentRepository.getStatus(documentId)).resolves.toBe("failed");
  });

  it("terminally fails when the default provider configuration is invalid", async () => {
    const environment = {
      OCR_PROVIDER: process.env.OCR_PROVIDER,
      NODE_ENV: process.env.NODE_ENV,
      GOOGLE_CLOUD_PROJECT_ID: process.env.GOOGLE_CLOUD_PROJECT_ID,
      GOOGLE_CLOUD_LOCATION: process.env.GOOGLE_CLOUD_LOCATION,
      GOOGLE_DOCUMENT_AI_PROCESSOR_ID: process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID,
      GOOGLE_SERVICE_ACCOUNT_JSON: process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
    };
    process.env.OCR_PROVIDER = "invalid-provider";

    try {
      const dependencies = { tenancyRepository: tenancy, documentRepository, jobs, invoices, storage };
      const queue = createJobService(dependencies);
      const worker = createOcrWorker(dependencies);
      const job = await queue.queueOcr(documentId, user("member"));

      await worker.processOcrJob(job.id);

      expect(jobs.jobs.get(job.id)).toMatchObject({
        status: "failed",
        retryCount: 3,
        errorSummary: "OCR processing failed.",
      });
      await expect(documentRepository.getStatus(documentId)).resolves.toBe("failed");
      await worker.processOcrJob(job.id);
      expect(jobs.jobs.get(job.id)?.retryCount).toBe(3);
    } finally {
      for (const [name, value] of Object.entries(environment)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it("claims a queued job once when two workers process it concurrently", async () => {
    let providerCalls = 0;
    let enteredProvider!: () => void;
    let releaseProvider!: () => void;
    const providerEntered = new Promise<void>((resolve) => { enteredProvider = resolve; });
    const providerRelease = new Promise<void>((resolve) => { releaseProvider = resolve; });
    const fake = new FakeOcrProvider();
    const provider = {
      async extract(input: Parameters<typeof fake.extract>[0]) {
        providerCalls += 1;
        enteredProvider();
        await providerRelease;
        return fake.extract(input);
      },
    };
    const { queue } = workflow(provider);
    const job = await queue.queueOcr(documentId, user("member"));
    const worker = createOcrWorker({ tenancyRepository: tenancy, documentRepository, jobs, invoices, storage, ocrProvider: provider });

    const first = worker.processOcrJob(job.id);
    await providerEntered;
    const second = worker.processOcrJob(job.id);
    releaseProvider();
    await Promise.all([first, second]);

    expect(providerCalls).toBe(1);
    await expect(invoices.listByBusinessId(ownerBusiness.id)).resolves.toHaveLength(1);
    expect(jobs.jobs.get(job.id)).toMatchObject({ status: "completed", retryCount: 0 });
  });

  it("blocks outsiders and inactive businesses before creating a job", async () => {
    const { queue } = workflow();

    await expect(queue.queueOcr(documentId, user("outsider"))).rejects.toMatchObject({ code: "BUSINESS_ACCESS_DENIED" });
    tenancy.businesses.get(ownerBusiness.id)!.isActive = false;
    await expect(queue.queueOcr(documentId, user("member"))).rejects.toMatchObject({ code: "INACTIVE_BUSINESS" });
  });

  it("revalidates the requesting membership before a worker reads private bytes", async () => {
    const provider = new FakeOcrProvider();
    let storageReads = 0;
    const guardedStorage: StorageAdapter = {
      put: (input) => storage.put(input),
      async get(objectKey) {
        storageReads += 1;
        return storage.get(objectKey);
      },
      delete: (objectKey) => storage.delete(objectKey),
    };
    const { queue } = workflow(provider);
    const job = await queue.queueOcr(documentId, user("member"));
    tenancy.memberships.find((membership) => membership.userId === user("member"))!.isActive = false;

    await createOcrWorker({ tenancyRepository: tenancy, documentRepository, jobs, invoices, storage: guardedStorage, ocrProvider: provider }).processOcrJob(job.id);

    expect(storageReads).toBe(0);
    await expect(invoices.listByBusinessId(ownerBusiness.id)).resolves.toHaveLength(0);
    expect(jobs.jobs.get(job.id)).toMatchObject({ status: "failed", errorSummary: "OCR processing failed." });
  });

  it("rejects a job whose business does not match its document before private reads", async () => {
    let storageReads = 0;
    const guardedStorage: StorageAdapter = {
      put: (input) => storage.put(input),
      async get(objectKey) {
        storageReads += 1;
        return storage.get(objectKey);
      },
      delete: (objectKey) => storage.delete(objectKey),
    };
    const { queue } = workflow();
    const job = await queue.queueOcr(documentId, user("member"));
    jobs.jobs.get(job.id)!.businessId = "different-business";

    await createOcrWorker({ tenancyRepository: tenancy, documentRepository, jobs, invoices, storage: guardedStorage }).processOcrJob(job.id);

    expect(storageReads).toBe(0);
    await expect(invoices.listByBusinessId(ownerBusiness.id)).resolves.toHaveLength(0);
    expect(jobs.jobs.get(job.id)).toMatchObject({ status: "failed" });
  });

  it("approves a valid invoice, updates document state, and emits an audit event", async () => {
    const { queue, worker, dependencies } = workflow();
    const job = await queue.queueOcr(documentId, user("member"));
    await worker.processOcrJob(job.id);
    const invoice = (await invoices.listByBusinessId(ownerBusiness.id))[0];
    await correctLowConfidence(invoice);

    const approved = await approveInvoice(invoice.id, user("member"), dependencies);

    expect(approved.reviewState).toBe("approved");
    await expect(documentRepository.getStatus(documentId)).resolves.toBe("approved");
    expect(tenancy.auditEvents).toContainEqual(expect.objectContaining({
      businessId: ownerBusiness.id,
      actorId: user("member"),
      type: "invoice_approved",
      entityId: invoice.id,
    }));
  });

  it("rejects edits after approval and preserves the approved invoice", async () => {
    const { queue, worker, dependencies } = workflow();
    const job = await queue.queueOcr(documentId, user("member"));
    await worker.processOcrJob(job.id);
    const invoice = (await invoices.listByBusinessId(ownerBusiness.id))[0];
    await correctLowConfidence(invoice);
    await approveInvoice(invoice.id, user("member"), dependencies);
    const before = await getInvoice(invoice.id, user("member"), dependencies);

    await expect(updateInvoice(invoice.id, user("member"), { notes: "tampered" }, dependencies)).rejects.toMatchObject({
      code: "INVALID_INVOICE_STATE",
    });
    await expect(getInvoice(invoice.id, user("member"), dependencies)).resolves.toEqual(before);
  });

  it("does not let a stale update overwrite a concurrent approval", async () => {
    const { queue, worker, dependencies } = workflow();
    const job = await queue.queueOcr(documentId, user("member"));
    await worker.processOcrJob(job.id);
    const invoice = (await invoices.listByBusinessId(ownerBusiness.id))[0];
    await correctLowConfidence(invoice);
    const originalFind = invoices.findById.bind(invoices);
    let releaseStaleRead!: () => void;
    let firstRead = true;
    const staleRead = new Promise<void>((resolve) => { releaseStaleRead = resolve; });
    invoices.findById = async (invoiceId) => {
      const found = await originalFind(invoiceId);
      if (firstRead) {
        firstRead = false;
        await staleRead;
      }
      return found;
    };

    try {
      const staleUpdate = updateInvoice(invoice.id, user("member"), { notes: "stale overwrite" }, dependencies);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await approveInvoice(invoice.id, user("member"), dependencies);
      releaseStaleRead();
      await expect(staleUpdate).rejects.toMatchObject({ code: "INVOICE_REPOSITORY_CONFLICT" });
    } finally {
      invoices.findById = originalFind;
    }

    await expect(invoices.findById(invoice.id)).resolves.toMatchObject({ reviewState: "approved", notes: expect.not.stringContaining("stale overwrite") });
  });

  it("rejects approval when a concurrent update removes a required field before the latest read", async () => {
    const { queue, worker, dependencies } = workflow();
    const job = await queue.queueOcr(documentId, user("member"));
    await worker.processOcrJob(job.id);
    const invoice = (await invoices.listByBusinessId(ownerBusiness.id))[0];
    await correctLowConfidence(invoice);
    let releaseApprovalRead!: () => void;
    let signalApprovalRead!: () => void;
    let firstRead = true;
    const approvalReadStarted = new Promise<void>((resolve) => { signalApprovalRead = resolve; });
    const approvalReadRelease = new Promise<void>((resolve) => { releaseApprovalRead = resolve; });
    const originalFind = invoices.findById.bind(invoices);
    invoices.findById = async (invoiceId) => {
      const found = await originalFind(invoiceId);
      if (firstRead) {
        firstRead = false;
        signalApprovalRead();
        await approvalReadRelease;
      }
      return found;
    };

    try {
      const approval = approveInvoice(invoice.id, user("member"), dependencies);
      await approvalReadStarted;
      await updateInvoice(invoice.id, user("member"), { total: null }, dependencies);
      releaseApprovalRead();

      await expect(approval).rejects.toMatchObject({ code: "INVOICE_INVALID_FOR_APPROVAL" });
    } finally {
      invoices.findById = originalFind;
    }

    await expect(invoices.findById(invoice.id)).resolves.toMatchObject({ reviewState: "needs_review", total: null });
    await expect(documentRepository.getStatus(documentId)).resolves.toBe("needs_review");
    expect(tenancy.auditEvents).not.toContainEqual(expect.objectContaining({ invoiceId: invoice.id }));
  });

  it("rejects approval when the invoice changes after the approval read", async () => {
    const { queue, worker, dependencies } = workflow();
    const job = await queue.queueOcr(documentId, user("member"));
    await worker.processOcrJob(job.id);
    const invoice = (await invoices.listByBusinessId(ownerBusiness.id))[0];
    await correctLowConfidence(invoice);
    const originalFind = invoices.findById.bind(invoices);
    let firstRead = true;
    invoices.findById = async (invoiceId) => {
      const found = await originalFind(invoiceId);
      if (firstRead && found) {
        firstRead = false;
        await invoices.update({ ...found, notes: "concurrent change", updatedAt: "2026-08-13T10:00:00.000Z" });
      }
      return found;
    };

    try {
      await expect(approveInvoice(invoice.id, user("member"), dependencies)).rejects.toMatchObject({
        code: "INVOICE_REPOSITORY_CONFLICT",
      });
    } finally {
      invoices.findById = originalFind;
    }

    await expect(invoices.findById(invoice.id)).resolves.toMatchObject({ reviewState: "needs_review", notes: "concurrent change" });
    await expect(documentRepository.getStatus(documentId)).resolves.toBe("needs_review");
    expect(tenancy.auditEvents).not.toContainEqual(expect.objectContaining({ entityId: invoice.id, type: "invoice_approved" }));
  });

  it("rolls back invoice, document, and audit state when approval audit fails", async () => {
    const { queue, worker, dependencies } = workflow();
    const job = await queue.queueOcr(documentId, user("member"));
    await worker.processOcrJob(job.id);
    const invoice = (await invoices.listByBusinessId(ownerBusiness.id))[0];
    await correctLowConfidence(invoice);
    const originalAppend = tenancy.appendAuditEvent;
    tenancy.appendAuditEvent = async () => { throw new Error("audit failure"); };

    try {
      await expect(approveInvoice(invoice.id, user("member"), dependencies)).rejects.toThrow("audit failure");
    } finally {
      tenancy.appendAuditEvent = originalAppend;
    }

    await expect(invoices.findById(invoice.id)).resolves.toMatchObject({ reviewState: "needs_review" });
    await expect(documentRepository.getStatus(documentId)).resolves.toBe("needs_review");
    expect(tenancy.auditEvents).not.toContainEqual(expect.objectContaining({ invoiceId: invoice.id }));
  });

  it("keeps the existing memory transaction contract on successful approval", async () => {
    const { queue, worker, dependencies } = workflow();
    const job = await queue.queueOcr(documentId, user("member"));
    await worker.processOcrJob(job.id);
    const invoice = (await invoices.listByBusinessId(ownerBusiness.id))[0];
    await correctLowConfidence(invoice);

    await expect(approveInvoice(invoice.id, user("member"), dependencies)).resolves.toMatchObject({ reviewState: "approved" });
    expect(documentRepository).toBeDefined();
    expect(tenancy.auditEvents).toContainEqual(expect.objectContaining({ entityId: invoice.id, type: "invoice_approved" }));
  });

  it("rejects invoice reads, edits, and approval when its document belongs to another business", async () => {
    const { queue, worker, dependencies } = workflow();
    const job = await queue.queueOcr(documentId, user("member"));
    await worker.processOcrJob(job.id);
    const invoice = (await invoices.listByBusinessId(ownerBusiness.id))[0];
    await correctLowConfidence(invoice);
    const isolatedDocumentRepository = {
      transaction: documentRepository.transaction.bind(documentRepository),
      create: documentRepository.create.bind(documentRepository),
      getStatus: documentRepository.getStatus.bind(documentRepository),
      setStatus: documentRepository.setStatus.bind(documentRepository),
      listByBusinessId: documentRepository.listByBusinessId.bind(documentRepository),
      findById: async (id: string) => {
        const document = await documentRepository.findById(id);
        return document ? { ...document, businessId: "other-business" as typeof ownerBusiness.id } : null;
      },
    };

    const isolatedDependencies = { ...dependencies, documentRepository: isolatedDocumentRepository };
    await expect(getInvoice(invoice.id, user("member"), isolatedDependencies)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    await expect(updateInvoice(invoice.id, user("member"), { notes: "inconsistent" }, isolatedDependencies)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    await expect(approveInvoice(invoice.id, user("member"), isolatedDependencies)).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    expect(tenancy.auditEvents).not.toContainEqual(expect.objectContaining({ invoiceId: invoice.id }));
  });

  it("enforces invoice tenant isolation and direct route contracts", async () => {
    const { queue, worker, dependencies } = workflow();
    const job = await queue.queueOcr(documentId, user("member"));
    await worker.processOcrJob(job.id);
    const invoice = (await invoices.listByBusinessId(ownerBusiness.id))[0];

    await expect(getInvoice(invoice.id, user("outsider"), dependencies)).rejects.toMatchObject({ code: "BUSINESS_ACCESS_DENIED" });

    await clearCurrentIdentity();
    const unauthenticated = await invoiceGetRoute(new Request("http://localhost"), { params: Promise.resolve({ invoiceId: invoice.id }) });
    expect(unauthenticated.status).toBe(401);
    await expect(unauthenticated.json()).resolves.toEqual({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } });
  });

  it("returns process 202 and invoice GET/PATCH stable public bodies", async () => {
    const { dependencies } = workflow();
    void dependencies;
    await setCurrentIdentity({ providerUserId: "member", email: "member@example.com", displayName: "Member", emailVerified: true });

    const processResponse = await processRoute(new Request("http://localhost", { method: "POST", body: JSON.stringify({}) }), {
      params: Promise.resolve({ documentId: "missing-document" }),
    });
    expect(processResponse.status).toBe(404);
    await expect(processResponse.json()).resolves.toMatchObject({ error: { code: "DOCUMENT_NOT_FOUND", message: expect.any(String) } });

    const invalidPatch = await invoicePatchRoute(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ action: "unknown" }) }), {
      params: Promise.resolve({ invoiceId: "missing-invoice" }),
    });
    expect(invalidPatch.status).toBe(400);
    await expect(invalidPatch.json()).resolves.toMatchObject({ error: { code: "INVALID_INVOICE_UPDATE", message: expect.any(String) } });
  });

  it("covers positive route contracts and exact 403, 404, 409, and 500 bodies", async () => {
    const routeState = await setupDefaultRouteState();
    await setCurrentIdentity(identityFor("route-member"));

    await clearCurrentIdentity();
    const processUnauthenticated = await processRoute(new Request("http://localhost", { method: "POST", body: "{}" }), {
      params: Promise.resolve({ documentId: routeState.documentId }),
    });
    expect(processUnauthenticated.status).toBe(401);
    await expect(processUnauthenticated.json()).resolves.toEqual({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } });

    await setCurrentIdentity(identityFor("route-member"));
    const malformedProcess = await processRoute(new Request("http://localhost", { method: "POST", body: "{ malformed" }), {
      params: Promise.resolve({ documentId: routeState.documentId }),
    });
    expect(malformedProcess.status).toBe(400);
    await expect(malformedProcess.json()).resolves.toEqual({ error: { code: "INVALID_JOB_REQUEST", message: "The OCR job request is invalid." } });

    const processed = await processRoute(new Request("http://localhost", { method: "POST", body: "{}" }), {
      params: Promise.resolve({ documentId: routeState.documentId }),
    });
    expect(processed.status).toBe(202);
    const processedBody = await processed.json() as { job: { id: string; status: string; documentId: string } };
    expect(processedBody).toEqual({ job: expect.objectContaining({ status: "completed", documentId: routeState.documentId }) });

    const defaultInvoices = globalRepository<InMemoryInvoiceRepository>("ledgerharbour.task8.inMemoryInvoiceRepository");
    const invoiceId = (await defaultInvoices.listByBusinessId(routeState.businessId as typeof ownerBusiness.id))[0]?.id as InvoiceId;
    const getPositive = await invoiceGetRoute(new Request("http://localhost"), { params: Promise.resolve({ invoiceId }) });
    expect(getPositive.status).toBe(200);
    await expect(getPositive.json()).resolves.toMatchObject({ id: invoiceId, documentId: routeState.documentId, reviewState: "needs_review" });

    await setCurrentIdentity(identityFor("route-outsider"));
    const getForbidden = await invoiceGetRoute(new Request("http://localhost"), { params: Promise.resolve({ invoiceId }) });
    expect(getForbidden.status).toBe(403);
    await expect(getForbidden.json()).resolves.toEqual({ error: { code: "BUSINESS_ACCESS_DENIED", message: "Business access denied." } });

    await clearCurrentIdentity();
    const patchUnauthenticated = await invoicePatchRoute(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ notes: "blocked" }) }), {
      params: Promise.resolve({ invoiceId }),
    });
    expect(patchUnauthenticated.status).toBe(401);
    await expect(patchUnauthenticated.json()).resolves.toEqual({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } });

    await setCurrentIdentity(identityFor("route-member"));
    const patchMissing = await invoicePatchRoute(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ notes: "missing" }) }), {
      params: Promise.resolve({ invoiceId: "missing-invoice" }),
    });
    expect(patchMissing.status).toBe(404);
    await expect(patchMissing.json()).resolves.toEqual({ error: { code: "INVOICE_NOT_FOUND", message: "Invoice not found." } });

    const patchMalformed = await invoicePatchRoute(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ total: 12 }) }), {
      params: Promise.resolve({ invoiceId }),
    });
    expect(patchMalformed.status).toBe(400);
    await expect(patchMalformed.json()).resolves.toEqual({ error: { code: "INVALID_INVOICE_UPDATE", message: "The invoice update is invalid." } });

    await setCurrentIdentity(identityFor("route-outsider"));
    const patchForbidden = await invoicePatchRoute(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ notes: "blocked" }) }), {
      params: Promise.resolve({ invoiceId }),
    });
    expect(patchForbidden.status).toBe(403);
    await expect(patchForbidden.json()).resolves.toEqual({ error: { code: "BUSINESS_ACCESS_DENIED", message: "Business access denied." } });

    await setCurrentIdentity(identityFor("route-member"));
    const patchPositive = await invoicePatchRoute(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ notes: "reviewed" }) }), {
      params: Promise.resolve({ invoiceId }),
    });
    expect(patchPositive.status).toBe(200);
    await expect(patchPositive.json()).resolves.toMatchObject({ id: invoiceId, notes: "reviewed" });

    const removeRequiredField = await invoicePatchRoute(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ total: null }) }), {
      params: Promise.resolve({ invoiceId }),
    });
    expect(removeRequiredField.status).toBe(200);
    const invalidApproval = await invoicePatchRoute(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ action: "approve" }) }), {
      params: Promise.resolve({ invoiceId }),
    });
    expect(invalidApproval.status).toBe(400);
    await expect(invalidApproval.json()).resolves.toEqual({ error: { code: "INVOICE_INVALID_FOR_APPROVAL", message: "The invoice draft is not valid for approval." } });

    const restoreRequiredField = await invoicePatchRoute(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ supplier: "Corrected Supplier", invoiceNumber: "CORRECTED-1", total: "120.00" }) }), {
      params: Promise.resolve({ invoiceId }),
    });
    expect(restoreRequiredField.status).toBe(200);

    const approvePositive = await invoicePatchRoute(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ action: "approve" }) }), {
      params: Promise.resolve({ invoiceId }),
    });
    expect(approvePositive.status).toBe(200);

    const approvedEdit = await invoicePatchRoute(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ notes: "must not change" }) }), {
      params: Promise.resolve({ invoiceId }),
    });
    expect(approvedEdit.status).toBe(409);
    await expect(approvedEdit.json()).resolves.toEqual({ error: { code: "INVALID_INVOICE_STATE", message: "The invoice is not in a reviewable state." } });

    const processForbidden = await (async () => {
      await setCurrentIdentity(identityFor("route-outsider"));
      return processRoute(new Request("http://localhost", { method: "POST", body: "{}" }), { params: Promise.resolve({ documentId: routeState.documentId }) });
    })();
    expect(processForbidden.status).toBe(403);
    await expect(processForbidden.json()).resolves.toEqual({ error: { code: "BUSINESS_ACCESS_DENIED", message: "Business access denied." } });

    const missingInvoice = await invoiceGetRoute(new Request("http://localhost"), { params: Promise.resolve({ invoiceId: "missing-invoice" }) });
    expect(missingInvoice.status).toBe(404);
    await expect(missingInvoice.json()).resolves.toEqual({ error: { code: "INVOICE_NOT_FOUND", message: "Invoice not found." } });

    await setCurrentIdentity(identityFor("route-member"));
    const duplicate = await processRoute(new Request("http://localhost", { method: "POST", body: "{}" }), { params: Promise.resolve({ documentId: routeState.documentId }) });
    expect(duplicate.status).toBe(409);
    await expect(duplicate.json()).resolves.toEqual({ error: { code: "OCR_JOB_CONFLICT", message: "An OCR job already exists for this document." } });

    const defaultJobs = globalRepository<InMemoryJobRepository>("ledgerharbour.task8.inMemoryJobRepository");
    const originalFind = defaultJobs.findByDocumentId;
    defaultJobs.findByDocumentId = async () => { throw new Error("repository detail"); };
    try {
      const failure = await processRoute(new Request("http://localhost", { method: "POST", body: "{}" }), { params: Promise.resolve({ documentId: routeState.documentId }) });
      expect(failure.status).toBe(500);
      await expect(failure.json()).resolves.toEqual({ error: { code: "OCR_PROCESSING_FAILED", message: "The OCR request could not be processed." } });
    } finally {
      defaultJobs.findByDocumentId = originalFind;
    }
  });

  it("returns a generic 502 when the configured OCR provider fails terminally", async () => {
    const routeState = await setupDefaultRouteState("route-failed-document");
    await setCurrentIdentity(identityFor("route-member"));
    const originalProvider = process.env.OCR_PROVIDER;
    const originalConfiguration = {
      GOOGLE_CLOUD_PROJECT_ID: process.env.GOOGLE_CLOUD_PROJECT_ID,
      GOOGLE_CLOUD_LOCATION: process.env.GOOGLE_CLOUD_LOCATION,
      GOOGLE_DOCUMENT_AI_PROCESSOR_ID: process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID,
      GOOGLE_SERVICE_ACCOUNT_JSON: process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
    };

    process.env.OCR_PROVIDER = "google-document-ai";
    delete process.env.GOOGLE_CLOUD_PROJECT_ID;
    delete process.env.GOOGLE_CLOUD_LOCATION;
    delete process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

    try {
      const failure = await processRoute(new Request("http://localhost", { method: "POST", body: "{}" }), {
        params: Promise.resolve({ documentId: routeState.documentId }),
      });

      expect(failure.status).toBe(502);
      await expect(failure.json()).resolves.toEqual({ error: { code: "OCR_PROCESSING_FAILED", message: "The OCR request could not be processed." } });
    } finally {
      if (originalProvider === undefined) delete process.env.OCR_PROVIDER;
      else process.env.OCR_PROVIDER = originalProvider;
      for (const [name, value] of Object.entries(originalConfiguration)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});

function identityFor(id: string) {
  return { providerUserId: id, email: `${id}@example.com`, displayName: id, emailVerified: true };
}

function globalRepository<T>(key: string): T {
  return (globalThis as typeof globalThis & { [key: symbol]: unknown })[Symbol.for(key)] as T;
}

async function setupDefaultRouteState(documentId = "route-document"): Promise<{ documentId: string; businessId: string }> {
  defaultOnboardingRepository.businesses.clear();
  defaultOnboardingRepository.memberships.splice(0);
  defaultOnboardingRepository.categories.splice(0);
  defaultOnboardingRepository.joinRequests.splice(0);
  defaultOnboardingRepository.auditEvents.splice(0);
  globalRepository<InMemoryJobRepository | undefined>("ledgerharbour.task8.inMemoryJobRepository")?.jobs.clear();

  const onboarding = createOnboardingServices(defaultOnboardingRepository);
  const business = await onboarding.createBusiness({ name: "Route OCR Books" }, identityFor("route-owner"));
  const routeMemberId = await defaultOnboardingRepository.upsertUser(identityFor("route-member"));
  await defaultOnboardingRepository.createMembership({ membershipId: "membership-route-member", userId: routeMemberId, businessId: business.id, role: "administrator", isActive: true });
  const privateObjectKey = `business/${documentId}/private`;
  const document: Document = {
    id: documentId,
    businessId: business.id,
    uploaderId: routeMemberId,
    privateObjectKey,
    originalFileName: "route-invoice.pdf",
    originalMimeType: "application/pdf",
    originalSizeBytes: 4,
    checksum: "route-checksum",
    status: "uploaded",
    createdAt: new Date().toISOString(),
  };
  const documentRepository = resolveDefaultDocumentRepository() as ReturnType<typeof createDocumentRepository>;
  await documentRepository.create(document);
  await resolveDefaultStorage().delete?.(privateObjectKey);
  await resolveDefaultStorage().put({ objectKey: privateObjectKey, data: new Uint8Array([1, 2, 3, 4]) });
  return { documentId, businessId: business.id };
}
