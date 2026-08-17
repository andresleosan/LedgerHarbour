import { describe, expect, it } from "vitest";

import { createTestDatabase } from "../../../src/db/test-database";
import { currencies } from "../../../src/db/schema";
import type { AuthIdentity } from "../../../src/modules/auth/auth-provider";
import {
  DOCUMENT_ERROR_CODES,
  DocumentError,
  type Document,
} from "../../../src/modules/documents/document-service";
import { createPostgresDocumentRepository } from "../../../src/modules/documents/postgres-document-repository";
import {
  INVOICE_ERROR_CODES,
  type Invoice,
} from "../../../src/modules/invoices/invoice-service";
import { createPostgresInvoiceRepository } from "../../../src/modules/invoices/postgres-invoice-repository";
import {
  createPostgresJobRepository,
} from "../../../src/modules/jobs/postgres-job-repository";
import type { Job } from "../../../src/modules/jobs/job-service";
import { createPostgresOnboardingRepository } from "../../../src/modules/tenancy/postgres-tenancy-repository";
import { approveInvoice } from "../../../src/modules/invoices/invoice-service";
import { createPersistenceContext } from "../../../src/modules/persistence/repository-factory";
import type { BusinessId, UserId } from "../../../src/modules/tenancy/types";
import type { DocumentId, InvoiceId } from "../../../src/modules/invoices/ocr-provider";
import { createApprovedBusiness } from "../../helpers/business-fixtures";

const user = (value: string) => value as UserId;
const business = (value: string) => value as BusinessId;
const documentId = (value: string) => value as DocumentId;
const invoiceId = (value: string) => value as InvoiceId;

const identity = (providerUserId: string): AuthIdentity => ({
  providerUserId,
  email: `${providerUserId}@example.com`,
  displayName: providerUserId,
  emailVerified: true,
});

function makeDocument(input: Partial<Document> = {}): Document {
  return {
    id: input.id ?? "document-1",
    businessId: input.businessId ?? business("business-1"),
    uploaderId: input.uploaderId ?? user("owner-1"),
    privateObjectKey: input.privateObjectKey ?? "business/business-1/documents/private-1",
    originalFileName: input.originalFileName ?? "invoice.pdf",
    originalMimeType: input.originalMimeType ?? "application/pdf",
    originalSizeBytes: input.originalSizeBytes ?? 128,
    checksum: input.checksum ?? "checksum-1",
    status: input.status ?? "uploaded",
    createdAt: input.createdAt ?? "2026-08-12T10:00:00.000Z",
  };
}

function makeInvoice(input: Partial<Invoice> = {}): Invoice {
  return {
    id: input.id ?? invoiceId("invoice-1"),
    businessId: input.businessId ?? business("business-1"),
    documentId: input.documentId ?? documentId("document-1"),
    supplier: input.supplier ?? "Supplier Ltd",
    invoiceNumber: input.invoiceNumber ?? "INV-1",
    invoiceDate: input.invoiceDate ?? "2026-08-11",
    dueDate: input.dueDate ?? "2026-09-11",
    subtotal: input.subtotal ?? "100.25",
    taxAmount: input.taxAmount ?? "20.05",
    total: input.total ?? "120.30",
    currencyReference: input.currencyReference ?? "GBP",
    expenseCategoryReference: input.expenseCategoryReference ?? null,
    notes: input.notes ?? "Imported",
    confidenceData: input.confidenceData ?? {
      supplier: 0.91,
      invoiceNumber: 0.92,
      invoiceDate: 0.93,
      dueDate: 0.94,
      subtotal: 0.95,
      taxAmount: 0.96,
      total: 0.97,
      currencyReference: 0.98,
      expenseCategoryReference: 0.99,
      notes: 0.9,
    },
    reviewState: input.reviewState ?? "needs_review",
    createdAt: input.createdAt ?? "2026-08-12T10:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-08-12T10:00:00.000Z",
  };
}

function makeJob(input: Partial<Job> = {}): Job {
  return {
    id: input.id ?? "job-1",
    businessId: input.businessId ?? "business-1",
    documentId: input.documentId ?? documentId("document-1"),
    jobType: "ocr",
    status: input.status ?? "queued",
    retryCount: input.retryCount ?? 0,
    errorSummary: input.errorSummary ?? null,
    requestedBy: input.requestedBy ?? user("owner-1"),
    createdAt: input.createdAt ?? "2026-08-12T10:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-08-12T10:00:00.000Z",
  };
}

async function fixture() {
  const state = await createTestDatabase();
  const tenancy = createPostgresOnboardingRepository(state.db);
  const createdBusiness = await createApprovedBusiness(tenancy, "Postgres Finance", identity("owner-1"));
  const memberId = await tenancy.upsertUser(identity("member-1"));
  await tenancy.createMembership({
    membershipId: "membership-member-1",
    userId: memberId,
    businessId: createdBusiness.id,
    role: "administrator",
    isActive: true,
    status: "active",
  });
  await state.db.insert(currencies).values({
    id: "currency-gbp",
    businessId: createdBusiness.id,
    name: "Pound",
    isoCode: "GBP",
    symbol: "GBP",
    decimalCount: 2,
    isStandard: true,
    isActive: true,
  });

  return {
    ...state,
    businessId: createdBusiness.id,
    ownerId: createdBusiness.createdBy,
    documentRepository: createPostgresDocumentRepository(state.db),
    invoiceRepository: createPostgresInvoiceRepository(state.db),
    jobRepository: createPostgresJobRepository(state.db),
  };
}

describe("PostgreSQL finance repositories", () => {
  it("persists documents without bytes and maps duplicate checksums per business", async () => {
    const state = await fixture();
    try {
      const first = await state.documentRepository.create(makeDocument({ businessId: state.businessId, uploaderId: state.ownerId }));
      await expect(state.documentRepository.findById(first.id)).resolves.toMatchObject({
        id: first.id,
        privateObjectKey: first.privateObjectKey,
        status: "uploaded",
      });
      await expect(state.documentRepository.listByBusinessId(state.businessId)).resolves.toHaveLength(1);
      await expect(state.documentRepository.create(makeDocument({ id: "document-duplicate", businessId: state.businessId, uploaderId: state.ownerId }))).rejects.toMatchObject({
        code: DOCUMENT_ERROR_CODES.DUPLICATE_CHECKSUM,
      });
      await expect(state.documentRepository.create(makeDocument({ id: "document-object-key-duplicate", businessId: state.businessId, uploaderId: state.ownerId, checksum: "different-checksum" }))).rejects.toMatchObject({
        code: "DOCUMENT_STORAGE_FAILURE",
      });
      await expect(state.documentRepository.findById(first.id)).resolves.not.toHaveProperty("data");
    } finally {
      await state.close();
    }
  }, 30_000);

  it("maps a concurrent checksum race to one duplicate domain error", async () => {
    const state = await fixture();
    try {
      const documentRepository = state.documentRepository;
      const first = makeDocument({ id: "document-concurrent-1", businessId: state.businessId, uploaderId: state.ownerId, privateObjectKey: "private/concurrent-1", checksum: "checksum-concurrent" });
      const second = makeDocument({ id: "document-concurrent-2", businessId: state.businessId, uploaderId: state.ownerId, privateObjectKey: "private/concurrent-2", checksum: "checksum-concurrent" });
      const results = await Promise.allSettled([documentRepository.create(first), documentRepository.create(second)]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
      expect(results.find((result) => result.status === "rejected")).toMatchObject({
        reason: { code: DOCUMENT_ERROR_CODES.DUPLICATE_CHECKSUM },
      });
    } finally {
      await state.close();
    }
  }, 30_000);

  it("rolls back a document transaction and preserves domain errors", async () => {
    const state = await fixture();
    try {
      const document = makeDocument({ businessId: state.businessId, uploaderId: state.ownerId });
      await expect(state.documentRepository.transaction(async () => {
        await state.documentRepository.create(document);
        throw new DocumentError(DOCUMENT_ERROR_CODES.DUPLICATE_CHECKSUM);
      })).rejects.toBeInstanceOf(DocumentError);
      await expect(state.documentRepository.findById(document.id)).resolves.toBeNull();
    } finally {
      await state.close();
    }
  }, 30_000);

  it("maps invoice dates, numerics, jsonb and composite tenant foreign keys", async () => {
    const state = await fixture();
    try {
      await state.documentRepository.create(makeDocument({ businessId: state.businessId, uploaderId: state.ownerId }));
      const invoice = makeInvoice({ businessId: state.businessId });
      const saved = await state.invoiceRepository.create(invoice);
      expect(saved).toMatchObject(invoice);
      await expect(state.invoiceRepository.findByDocumentId(invoice.documentId)).resolves.toMatchObject({
        invoiceDate: "2026-08-11",
        dueDate: "2026-09-11",
        subtotal: "100.25",
        total: "120.30",
        confidenceData: invoice.confidenceData,
        currencyReference: "GBP",
      });
      await expect(state.invoiceRepository.listByBusinessId(state.businessId)).resolves.toHaveLength(1);
      await expect(state.invoiceRepository.create(makeInvoice({
        id: invoiceId("invoice-wrong-tenant"),
        businessId: business("other-business"),
        documentId: invoice.documentId,
      }))).rejects.toMatchObject({ code: INVOICE_ERROR_CODES.REPOSITORY_CONFLICT });
      await expect(state.invoiceRepository.findById(invoice.id)).resolves.not.toHaveProperty("password");
    } finally {
      await state.close();
    }
  }, 30_000);

  it("rejects an invoice transaction and leaves no persisted row", async () => {
    const state = await fixture();
    try {
      await state.documentRepository.create(makeDocument({ businessId: state.businessId, uploaderId: state.ownerId }));
      const invoice = makeInvoice({ businessId: state.businessId });
      await expect(state.invoiceRepository.transaction(async () => {
        await state.invoiceRepository.create(invoice);
        throw new Error("invoice rollback sentinel");
      })).rejects.toMatchObject({ code: INVOICE_ERROR_CODES.REPOSITORY_CONFLICT });
      await expect(state.invoiceRepository.findById(invoice.id)).resolves.toBeNull();
    } finally {
      await state.close();
    }
  }, 30_000);

  it("rolls back invoice, document, and audit together when approval fails after audit commit", async () => {
    const state = await fixture();
    try {
      const context = createPersistenceContext({ mode: "postgres", database: state.db });
      const document = makeDocument({ id: "approval-document", businessId: state.businessId, uploaderId: state.ownerId, status: "needs_review" });
      await context.documentRepository.create(document);
      const invoice = await context.invoiceRepository.create(makeInvoice({ id: invoiceId("approval-invoice"), businessId: state.businessId, documentId: documentId(document.id) }));
      const transaction = async (operation: Parameters<NonNullable<typeof context.transaction>>[0]) => {
        return context.tenancyRepository.transaction(async (transactionTenancy) => {
          await operation(transactionTenancy);
          throw new Error("cross-repository rollback sentinel");
        });
      };

      await expect(approveInvoice(invoice.id, state.ownerId, {
        tenancyRepository: context.tenancyRepository,
        documentRepository: context.documentRepository,
        invoices: context.invoiceRepository,
        transaction,
      })).rejects.toThrow("cross-repository rollback sentinel");

      await expect(context.invoiceRepository.findById(invoice.id)).resolves.toMatchObject({ reviewState: "needs_review" });
      await expect(context.documentRepository.getStatus(document.id)).resolves.toBe("needs_review");
      await expect(context.tenancyRepository.listAuditEvents(state.businessId)).resolves.not.toContainEqual(expect.objectContaining({ entityId: invoice.id }));
    } finally {
      await state.close();
    }
  }, 30_000);

  it("commits invoice, document, and audit together on approval", async () => {
    const state = await fixture();
    try {
      const context = createPersistenceContext({ mode: "postgres", database: state.db });
      const document = makeDocument({ id: "approval-commit-document", businessId: state.businessId, uploaderId: state.ownerId, status: "needs_review" });
      await context.documentRepository.create(document);
      const invoice = await context.invoiceRepository.create(makeInvoice({ id: invoiceId("approval-commit-invoice"), businessId: state.businessId, documentId: documentId(document.id) }));

      await expect(approveInvoice(invoice.id, state.ownerId, {
        tenancyRepository: context.tenancyRepository,
        documentRepository: context.documentRepository,
        invoices: context.invoiceRepository,
        transaction: context.transaction,
      })).resolves.toMatchObject({ reviewState: "approved" });

      await expect(context.invoiceRepository.findById(invoice.id)).resolves.toMatchObject({ reviewState: "approved" });
      await expect(context.documentRepository.getStatus(document.id)).resolves.toBe("approved");
      await expect(context.tenancyRepository.listAuditEvents(state.businessId)).resolves.toContainEqual(expect.objectContaining({ entityId: invoice.id, type: "invoice_approved" }));
    } finally {
      await state.close();
    }
  }, 30_000);

  it("updates only when review state and updatedAt still match", async () => {
    const state = await fixture();
    try {
      await state.documentRepository.create(makeDocument({ businessId: state.businessId, uploaderId: state.ownerId }));
      const invoice = await state.invoiceRepository.create(makeInvoice({ businessId: state.businessId }));
      const updated = { ...invoice, notes: "updated", updatedAt: "2026-08-12T10:01:00.000Z" };
      await expect(state.invoiceRepository.updateIfUnchanged(updated, invoice.reviewState, invoice.updatedAt)).resolves.toMatchObject({ notes: "updated" });
      await expect(state.invoiceRepository.updateIfUnchanged({ ...updated, notes: "stale" }, invoice.reviewState, invoice.updatedAt)).rejects.toMatchObject({
        code: INVOICE_ERROR_CODES.REPOSITORY_CONFLICT,
      });
    } finally {
      await state.close();
    }
  }, 30_000);

  it("rejects editing an approved invoice at the existing service boundary", async () => {
    const state = await fixture();
    try {
      await state.documentRepository.create(makeDocument({ businessId: state.businessId, uploaderId: state.ownerId }));
      const invoice = await state.invoiceRepository.create(makeInvoice({ businessId: state.businessId, reviewState: "approved" }));
      const { updateInvoice } = await import("../../../src/modules/invoices/invoice-service");
      await expect(updateInvoice(invoice.id, state.ownerId, { notes: "tampered" }, {
        tenancyRepository: createPostgresOnboardingRepository(state.db),
        documentRepository: state.documentRepository,
        invoices: state.invoiceRepository,
      })).rejects.toMatchObject({ code: INVOICE_ERROR_CODES.INVALID_STATE });
    } finally {
      await state.close();
    }
  }, 30_000);

  it("persists and reuses an OCR job through the tenant-aware dedupe constraint", async () => {
    const state = await fixture();
    try {
      await state.documentRepository.create(makeDocument({ businessId: state.businessId, uploaderId: state.ownerId }));
      const first = makeJob({ businessId: state.businessId, requestedBy: state.ownerId });
      await expect(state.jobRepository.createOrReuse(() => first)).resolves.toMatchObject({ requestedBy: state.ownerId });
      await expect(state.jobRepository.findByDocumentId(first.documentId)).resolves.toMatchObject({ id: first.id, requestedBy: state.ownerId });
      await expect(state.jobRepository.createOrReuse(() => makeJob({ id: "job-2", businessId: state.businessId, requestedBy: state.ownerId }))).resolves.toMatchObject({ id: first.id });
      const concurrent = await Promise.all([
        state.jobRepository.createOrReuse(() => makeJob({ id: "job-concurrent-1", businessId: state.businessId, requestedBy: state.ownerId, documentId: first.documentId })),
        state.jobRepository.createOrReuse(() => makeJob({ id: "job-concurrent-2", businessId: state.businessId, requestedBy: state.ownerId, documentId: first.documentId })),
      ]);
      expect(concurrent[0].id).toBe(first.id);
      expect(concurrent[1].id).toBe(first.id);
    } finally {
      await state.close();
    }
  }, 30_000);

  it("updates jobs and maps missing jobs to the public domain error", async () => {
    const state = await fixture();
    try {
      await state.documentRepository.create(makeDocument({ businessId: state.businessId, uploaderId: state.ownerId }));
      const job = await state.jobRepository.create(makeJob({ businessId: state.businessId, requestedBy: state.ownerId }));
      await expect(state.jobRepository.update({ ...job, status: "failed", retryCount: 1, errorSummary: "OCR processing failed." })).resolves.toMatchObject({ status: "failed", retryCount: 1 });
      await expect(state.jobRepository.findById("missing")).resolves.toBeNull();
    } finally {
      await state.close();
    }
  }, 30_000);

  it("rolls back a job transaction and rejects a requestedBy from another business", async () => {
    const state = await fixture();
    try {
      await state.documentRepository.create(makeDocument({ businessId: state.businessId, uploaderId: state.ownerId }));
      const other = await createApprovedBusiness(createPostgresOnboardingRepository(state.db), "Other Finance", identity("other-owner"));
      await expect(state.jobRepository.create(makeJob({ businessId: state.businessId, requestedBy: other.createdBy }))).rejects.toMatchObject({ code: "OCR_JOB_CONFLICT" });
      const job = makeJob({ businessId: state.businessId, requestedBy: state.ownerId });
      await expect(state.jobRepository.transaction(async () => {
        await state.jobRepository.create(job);
        throw new Error("job rollback sentinel");
      })).rejects.toMatchObject({ code: "OCR_JOB_CONFLICT" });
      await expect(state.jobRepository.findById(job.id)).resolves.toBeNull();
    } finally {
      await state.close();
    }
  }, 30_000);

  it("allows only one concurrent claim winner", async () => {
    const state = await fixture();
    try {
      await state.documentRepository.create(makeDocument({ businessId: state.businessId, uploaderId: state.ownerId }));
      const job = await state.jobRepository.create(makeJob({ businessId: state.businessId, requestedBy: state.ownerId }));
      const claims = await Promise.all([state.jobRepository.claim(job.id), state.jobRepository.claim(job.id)]);
      expect(claims.filter(Boolean)).toHaveLength(1);
      expect(claims.filter((value) => value === null)).toHaveLength(1);
      await expect(state.jobRepository.findById(job.id)).resolves.toMatchObject({ status: "processing" });
    } finally {
      await state.close();
    }
  }, 30_000);
});
