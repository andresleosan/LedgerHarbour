import { beforeEach, describe, expect, it } from "vitest";

import {
  approveInvoice,
  createInvoiceRepository,
  getInvoice,
  type Invoice,
  type InvoiceRepository,
  updateInvoice,
} from "../../src/modules/invoices/invoice-service";
import { getInvoiceReview } from "../../src/modules/invoices/invoice-review-service";
import {
  createDocumentRepository,
  getDocumentForDownload,
  type Document,
   type InMemoryDocumentRepository,
} from "../../src/modules/documents/document-service";
import {
  createInMemoryOnboardingRepository,
  createOnboardingServices,
  type OnboardingRepository,
} from "../../src/modules/tenancy/business-service";
import { getBusinessDashboard } from "../../src/modules/tenancy/portfolio-service";
import type { StorageAdapter } from "../../src/modules/documents/storage-adapter";
import type { BusinessId, UserId } from "../../src/modules/tenancy/types";
import type { DocumentId, InvoiceId } from "../../src/modules/invoices/ocr-provider";

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
    return new ReadableStream({
      start(controller) {
        controller.enqueue(data.slice());
        controller.close();
      },
    });
  }

  async delete(objectKey: string) {
    this.values.delete(objectKey);
  }
}

function documentFor(businessId: BusinessId, id: string): Document {
  return {
    id,
    businessId,
    uploaderId: user("owner-a"),
    privateObjectKey: `private/${id}`,
    originalFileName: `${id}.pdf`,
    originalMimeType: "application/pdf",
    originalSizeBytes: 4,
    checksum: `checksum-${id}`,
    status: "needs_review",
    createdAt: "2026-08-11T00:00:00.000Z",
  };
}

function invoiceFor(businessId: BusinessId, documentId: string, id: string): Invoice {
  return {
    id: id as InvoiceId,
    businessId,
    documentId: documentId as DocumentId,
    supplier: "Supplier",
    invoiceNumber: id,
    invoiceDate: "2026-08-11",
    dueDate: null,
    subtotal: "10.00",
    taxAmount: "2.00",
    total: "12.00",
    currencyReference: "GBP",
    expenseCategoryReference: null,
    notes: null,
    confidenceData: {
      supplier: 1,
      invoiceNumber: 1,
      invoiceDate: 1,
      dueDate: 1,
      subtotal: 1,
      taxAmount: 1,
      total: 1,
      currencyReference: 1,
      expenseCategoryReference: 1,
      notes: 1,
    },
    reviewState: "draft",
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
  };
}

describe("Task 11 tenant isolation matrix", () => {
  let tenancy: OnboardingRepository;
  let documents: InMemoryDocumentRepository;
  let invoices: InvoiceRepository;
  let storage: MemoryStorage;
  let businessA: Awaited<ReturnType<ReturnType<typeof createOnboardingServices>["createBusiness"]>>;
  let businessB: Awaited<ReturnType<ReturnType<typeof createOnboardingServices>["createBusiness"]>>;
  let invoiceB: Invoice;

  beforeEach(async () => {
    tenancy = createInMemoryOnboardingRepository();
    documents = createDocumentRepository();
    invoices = createInvoiceRepository();
    storage = new MemoryStorage();
    const onboarding = createOnboardingServices(tenancy);
    businessA = await onboarding.createBusiness({ name: "Business A" }, user("owner-a"));
    businessB = await onboarding.createBusiness({ name: "Business B" }, user("owner-b"));
    const documentA = documentFor(businessA.id, "document-a");
    const documentB = documentFor(businessB.id, "document-b");
    documentB.uploaderId = user("owner-b");
    await documents.create(documentA);
    await documents.create(documentB);
    await storage.put({ objectKey: documentA.privateObjectKey, data: new Uint8Array([1, 2, 3, 4]) });
    await storage.put({ objectKey: documentB.privateObjectKey, data: new Uint8Array([5, 6, 7, 8]) });
    await invoices.create(invoiceFor(businessA.id, documentA.id, "invoice-a"));
    invoiceB = invoiceFor(businessB.id, documentB.id, "invoice-b");
    await invoices.create(invoiceB);
  });

  it("rejects cross-tenant invoice read, update, and approval", async () => {
    const dependencies = { tenancyRepository: tenancy, documentRepository: documents, invoices };

    await expect(getInvoice(invoiceB.id, user("owner-a"), dependencies)).rejects.toMatchObject({ code: "BUSINESS_ACCESS_DENIED" });
    await expect(updateInvoice(invoiceB.id, user("owner-a"), { notes: "cross-tenant" }, dependencies)).rejects.toMatchObject({ code: "BUSINESS_ACCESS_DENIED" });
    await expect(approveInvoice(invoiceB.id, user("owner-a"), dependencies)).rejects.toMatchObject({ code: "BUSINESS_ACCESS_DENIED" });
  });

  it("rejects cross-tenant document download and invoice review", async () => {
    const dependencies = { tenancyRepository: tenancy, documentRepository: documents, invoices };

    await expect(getDocumentForDownload("document-b", user("owner-a"), { tenancyRepository: tenancy, documentRepository: documents, storage }))
      .rejects.toMatchObject({ code: "BUSINESS_ACCESS_DENIED" });
    await expect(getInvoiceReview(invoiceB.id, user("owner-a"), dependencies))
      .rejects.toMatchObject({ code: "BUSINESS_ACCESS_DENIED" });
  });

  it("returns only the requested tenant in the dashboard and never fabricates totals", async () => {
    const dashboard = await getBusinessDashboard(businessA.id, user("owner-a"), {
      tenancyRepository: tenancy,
      documentRepository: documents,
      invoiceRepository: invoices,
    });

    expect(dashboard.documentCount).toBe(1);
    expect(dashboard.invoicesNeedingReview).toBe(0);
    expect(JSON.stringify(dashboard)).not.toContain("document-b");
    expect(JSON.stringify(dashboard)).not.toMatch(/privateObjectKey|private[\\/]|total|balance|amount/i);
    await expect(getBusinessDashboard(businessB.id, user("owner-a"), {
      tenancyRepository: tenancy,
      documentRepository: documents,
      invoiceRepository: invoices,
    })).rejects.toMatchObject({ message: "Business access denied" });
  });
});
