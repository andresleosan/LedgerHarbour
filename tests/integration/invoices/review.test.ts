import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PATCH as categoriesPatch, POST as categoriesPost } from "../../../src/app/api/businesses/[businessId]/categories/route";
import { POST as currenciesPost } from "../../../src/app/api/businesses/[businessId]/currencies/route";
import { GET as reviewGet, PATCH as reviewPatch } from "../../../src/app/api/invoices/[invoiceId]/review/route";
import { clearCurrentIdentity, setCurrentIdentity } from "../../../src/modules/auth/session";
import { createDocumentRepository, type Document } from "../../../src/modules/documents/document-service";
import { createInvoiceRepository, resolveDefaultDocumentRepository, type Invoice, type InMemoryInvoiceRepository } from "../../../src/modules/invoices/invoice-service";
import { approveInvoice } from "../../../src/modules/invoices/invoice-service";
import { createInMemoryOnboardingRepository, createOnboardingServices, defaultOnboardingRepository, type MemoryOnboardingRepository } from "../../../src/modules/tenancy/business-service";
import { createCategory, deactivateCategory, type CategoryDependencies } from "../../../src/modules/accounting/category-service";
import { PATCH as currenciesPatch } from "../../../src/app/api/businesses/[businessId]/currencies/route";
import { getInvoiceReview, listInvoices, updateInvoiceDraft } from "../../../src/modules/invoices/invoice-review-service";
import { MAX_REVIEW_PATCH_BYTES } from "../../../src/modules/invoices/review-validation";
import type { DocumentId, InvoiceId } from "../../../src/modules/invoices/ocr-provider";
import type { BusinessId, UserId } from "../../../src/modules/tenancy/types";

const user = (value: string) => value as UserId;
const businessId = (value: string) => value as BusinessId;

describe("invoice review boundaries", () => {
  let tenancy: MemoryOnboardingRepository;
  let documents: ReturnType<typeof createDocumentRepository>;
  let invoices: InMemoryInvoiceRepository;
  let business: Awaited<ReturnType<ReturnType<typeof createOnboardingServices>["createBusiness"]>>;
  let invoice: Invoice;

  beforeEach(async () => {
    process.env.AUTH_MODE = "development";
    tenancy = createInMemoryOnboardingRepository();
    documents = createDocumentRepository();
    invoices = createInvoiceRepository();
    business = await createOnboardingServices(tenancy).createBusiness({ name: "Review Books" }, user("owner"));
    await tenancy.createMembership({ membershipId: "membership-reviewer", userId: user("reviewer"), businessId: business.id, role: "administrator", isActive: true });
    const document: Document = {
      id: "review-document",
      businessId: business.id,
      uploaderId: user("reviewer"),
      privateObjectKey: "private/review-document",
      originalFileName: "invoice.pdf",
      originalMimeType: "application/pdf",
      originalSizeBytes: 4,
      checksum: "review-checksum",
      status: "uploaded",
      createdAt: new Date().toISOString(),
    };
    await documents.create(document);
    invoice = {
      id: "review-invoice" as InvoiceId,
      businessId: business.id,
      documentId: document.id as DocumentId,
      supplier: "Supplier",
      invoiceNumber: "INV-1",
      invoiceDate: "2026-08-11",
      dueDate: null,
      subtotal: "100.00",
      taxAmount: "20.00",
      total: "120.00",
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
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await invoices.create(invoice);
  });

  afterEach(async () => {
    await clearCurrentIdentity();
  });

  it("updates a draft through Task 8 and preserves approved immutability", async () => {
    const dependencies = { tenancyRepository: tenancy, documentRepository: documents, invoices };

    await expect(updateInvoiceDraft({ invoiceId: invoice.id, fields: { notes: "Checked" } }, user("reviewer"), dependencies)).resolves.toMatchObject({ notes: "Checked" });
    await expect(approveInvoice(invoice.id, user("reviewer"), dependencies)).resolves.toMatchObject({ reviewState: "approved" });
    await expect(updateInvoiceDraft({ invoiceId: invoice.id, fields: { notes: "Tampered" } }, user("reviewer"), dependencies)).rejects.toMatchObject({ code: "INVALID_INVOICE_STATE" });
    expect((await invoices.findById(invoice.id))?.notes).toBe("Checked");
  });

  it("resolves an AuthIdentity before listing invoices", async () => {
    const repository = createInMemoryOnboardingRepository();
    const identity = {
      providerUserId: "provider-invoice-user",
      email: "invoice@example.com",
      displayName: "Invoice User",
      emailVerified: true,
    };
    const identityBusiness = await createOnboardingServices(repository).createBusiness({ name: "Identity Invoices" }, identity);
    const identityDocuments = createDocumentRepository();
    const identityInvoices = createInvoiceRepository();
    const identityDocument: Document = {
      id: "identity-review-document",
      businessId: identityBusiness.id,
      uploaderId: user("identity-invoice-user"),
      privateObjectKey: "private/identity-review-document",
      originalFileName: "identity-invoice.pdf",
      originalMimeType: "application/pdf",
      originalSizeBytes: 4,
      checksum: "identity-review-checksum",
      status: "uploaded",
      createdAt: new Date().toISOString(),
    };
    await identityDocuments.create(identityDocument);
    await identityInvoices.create({ ...invoice, id: "identity-review-invoice" as InvoiceId, businessId: identityBusiness.id, documentId: identityDocument.id as DocumentId });

    await expect(listInvoices(identityBusiness.id, identity, {
      tenancyRepository: repository,
      documentRepository: identityDocuments,
      invoices: identityInvoices,
    })).resolves.toHaveLength(1);
  });

  it("rejects approval when a required extracted field has low confidence", async () => {
    const dependencies = { tenancyRepository: tenancy, documentRepository: documents, invoices };
    const current = await invoices.findById(invoice.id);
    await invoices.update({ ...current!, confidenceData: { ...current!.confidenceData, total: 0.79 } });

    await expect(approveInvoice(invoice.id, user("reviewer"), dependencies)).rejects.toMatchObject({ code: "INVOICE_INVALID_FOR_APPROVAL" });
    expect((await invoices.findById(invoice.id))?.reviewState).toBe("draft");
  });

  it("approves through the async document status contract without a documents map", async () => {
    const portableDocuments = {
      transaction: documents.transaction.bind(documents),
      create: documents.create.bind(documents),
      findById: documents.findById.bind(documents),
      listByBusinessId: documents.listByBusinessId.bind(documents),
      getStatus: async (documentId: string) => (await documents.findById(documentId))?.status ?? null,
      setStatus: async (documentId: string, status: Document["status"]) => {
        const current = await documents.findById(documentId);
        if (!current) return null;
        const updated = { ...current, status };
        await documents.setStatus(documentId, status);
        return updated;
      },
    } as never;

    await expect(approveInvoice(invoice.id, user("reviewer"), { tenancyRepository: tenancy, documentRepository: portableDocuments, invoices }))
      .resolves.toMatchObject({ reviewState: "approved" });
  });

  it("rejects an empty category name and accepts a tenant-scoped category", async () => {
    const dependencies = { tenancyRepository: tenancy } satisfies CategoryDependencies;

    await expect(createCategory({ businessId: business.id, name: "  " }, user("owner"), dependencies)).rejects.toMatchObject({ code: "INVALID_CATEGORY" });
    await expect(createCategory({ businessId: business.id, name: " Office " }, user("owner"), dependencies)).resolves.toMatchObject({ name: "Office" });
  });

  it("deactivates a category without changing historical invoice references and records an audit", async () => {
    const category = await createCategory({ businessId: business.id, name: "Historical" }, user("owner"), { tenancyRepository: tenancy });
    invoice.expenseCategoryReference = category.id;
    const deactivated = await deactivateCategory(business.id, category.id, user("owner"), { tenancyRepository: tenancy });

    expect(deactivated.isActive).toBe(false);
    expect(invoice.expenseCategoryReference).toBe(category.id);
    expect(tenancy.auditEvents).toContainEqual(expect.objectContaining({ type: "category_deactivated", businessId: business.id, actorId: user("owner") }));
  });

  it("returns stable route contracts for unauthenticated and invalid review requests", async () => {
    await clearCurrentIdentity();
    const unauthenticated = await reviewGet(new Request("http://localhost"), { params: Promise.resolve({ invoiceId: invoice.id }) });
    expect(unauthenticated.status).toBe(401);
    await expect(unauthenticated.json()).resolves.toEqual({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } });

    await setCurrentIdentity({ providerUserId: "reviewer", email: "reviewer@example.com", displayName: "Reviewer", emailVerified: true });
    const malformed = await reviewPatch(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ unknown: true }) }), { params: Promise.resolve({ invoiceId: invoice.id }) });
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toMatchObject({ error: { code: "INVALID_INVOICE_REVIEW" } });
  });

  it("does not parse a clearly oversized review JSON body", async () => {
    await setCurrentIdentity({ providerUserId: "reviewer", email: "reviewer@example.com", displayName: "Reviewer", emailVerified: true });
    const json = vi.fn(async () => { throw new Error("body should not be parsed"); });
    const oversized = {
      headers: new Headers({ "content-length": String(MAX_REVIEW_PATCH_BYTES + 1) }),
      body: null,
      json,
    } as unknown as Request;

    const response = await reviewPatch(oversized, { params: Promise.resolve({ invoiceId: invoice.id }) });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "INVALID_INVOICE_REVIEW" } });
    expect(json).not.toHaveBeenCalled();
  });

  it("rejects review fields longer than 2000 characters", async () => {
    await setCurrentIdentity({ providerUserId: "reviewer", email: "reviewer@example.com", displayName: "Reviewer", emailVerified: true });
    const response = await reviewPatch(new Request("http://localhost", {
      method: "PATCH",
      body: JSON.stringify({ notes: "n".repeat(2001) }),
    }), { params: Promise.resolve({ invoiceId: invoice.id }) });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "INVALID_INVOICE_REVIEW" } });
  });

  it("marks financial review GET responses private and non-cacheable", async () => {
    await setCurrentIdentity({ providerUserId: "reviewer", email: "reviewer@example.com", displayName: "Reviewer", emailVerified: true });

    const response = await reviewGet(new Request("http://localhost"), { params: Promise.resolve({ invoiceId: invoice.id }) });

    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("uses the shared Task 8 document repository for the default review route", async () => {
    const defaultBusiness = await createOnboardingServices(defaultOnboardingRepository).createBusiness({ name: `Default Review ${Date.now()}` }, user("default-owner"));
    await defaultOnboardingRepository.createMembership({ membershipId: "membership-default-reviewer", userId: user("default-reviewer"), businessId: defaultBusiness.id, role: "administrator", isActive: true });
    const document = { ...((await documents.findById(invoice.documentId)) as Document), id: "default-review-document", businessId: defaultBusiness.id, uploaderId: user("default-reviewer") };
    await resolveDefaultDocumentRepository().create(document);
    const state = globalThis as typeof globalThis & { [key: symbol]: unknown };
    const key = Symbol.for("ledgerharbour.task8.inMemoryInvoiceRepository");
    const defaultInvoices = (state[key] as InMemoryInvoiceRepository | undefined) ?? createInvoiceRepository();
    if (!state[key]) Object.defineProperty(state, key, { configurable: false, enumerable: false, writable: false, value: defaultInvoices });
    const defaultInvoice = { ...invoice, id: "default-review-invoice" as InvoiceId, businessId: defaultBusiness.id, documentId: document.id as DocumentId };
    await defaultInvoices.create(defaultInvoice);
    await setCurrentIdentity({ providerUserId: "default-reviewer", email: "default@example.com", displayName: "Default Reviewer", emailVerified: true });

    await expect(getInvoiceReview(defaultInvoice.id, user("default-reviewer"))).resolves.toMatchObject({ documentDownloadUrl: `/api/documents/${document.id}/download` });
  });

  it("returns category route bodies without leaking repository errors", async () => {
    await clearCurrentIdentity();
    const body = await categoriesPost(new Request("http://localhost", { method: "POST", body: JSON.stringify({ name: "Office" }) }), { params: Promise.resolve({ businessId: businessId("missing") }) });
    expect(body.status).toBe(401);

    await setCurrentIdentity({ providerUserId: "owner", email: "owner@example.com", displayName: "Owner", emailVerified: true });
    const invalid = await categoriesPatch(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ categoryId: "missing", unknown: true }) }), { params: Promise.resolve({ businessId: business.id }) });
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({ error: { code: "INVALID_CATEGORY_REQUEST" } });
  });

  it("returns a stable 409 contract for category repository conflicts", async () => {
    const categoryOwner = { providerUserId: "route-category-owner", email: "route-category-owner@example.com", displayName: "Owner", emailVerified: true };
    const defaultBusiness = await createOnboardingServices(defaultOnboardingRepository).createBusiness({ name: `Category Conflict ${Date.now()}` }, categoryOwner);
    await setCurrentIdentity(categoryOwner);
    const originalAppendAuditEvent = defaultOnboardingRepository.appendAuditEvent;
    defaultOnboardingRepository.appendAuditEvent = async () => { throw new Error("category write failed"); };
    try {
      const response = await categoriesPost(new Request("http://localhost", { method: "POST", body: JSON.stringify({ name: "Route Category" }) }), { params: Promise.resolve({ businessId: defaultBusiness.id }) });
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({ error: { code: "CATEGORY_REPOSITORY_CONFLICT", message: "The category changed elsewhere." } });
    } finally {
      defaultOnboardingRepository.appendAuditEvent = originalAppendAuditEvent;
    }
  });

  it("returns a stable 409 contract for category update repository conflicts", async () => {
    const categoryOwner = { providerUserId: "route-category-update-owner", email: "route-category-update-owner@example.com", displayName: "Owner", emailVerified: true };
    const defaultBusiness = await createOnboardingServices(defaultOnboardingRepository).createBusiness({ name: `Category Update Conflict ${Date.now()}` }, categoryOwner);
    await setCurrentIdentity(categoryOwner);
    const category = await createCategory({ businessId: defaultBusiness.id, name: "Update Category" }, categoryOwner);
    const originalAppendAuditEvent = defaultOnboardingRepository.appendAuditEvent;
    defaultOnboardingRepository.appendAuditEvent = async () => { throw new Error("category update failed"); };
    try {
      const response = await categoriesPatch(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ categoryId: category.id, name: "Renamed Category" }) }), { params: Promise.resolve({ businessId: defaultBusiness.id }) });
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({ error: { code: "CATEGORY_REPOSITORY_CONFLICT", message: "The category changed elsewhere." } });
    } finally {
      defaultOnboardingRepository.appendAuditEvent = originalAppendAuditEvent;
    }
  });

  it("returns a stable 409 contract for currency repository conflicts", async () => {
    const currencyOwner = { providerUserId: "route-currency-owner", email: "route-currency-owner@example.com", displayName: "Owner", emailVerified: true };
    const defaultBusiness = await createOnboardingServices(defaultOnboardingRepository).createBusiness({ name: `Currency Conflict ${Date.now()}` }, currencyOwner);
    await setCurrentIdentity(currencyOwner);
    const first = await currenciesPost(new Request("http://localhost", { method: "POST", body: JSON.stringify({ name: "Route Currency", symbol: "RC", decimalCount: 2, isoCode: "RTC" }) }), { params: Promise.resolve({ businessId: defaultBusiness.id }) });
    expect(first.status).toBe(201);
    const state = globalThis as typeof globalThis & { [key: symbol]: unknown };
    const repository = state[Symbol.for("ledgerharbour.task9.currencyRepository")] as { transaction: CurrencyTransaction };
    const originalTransaction = repository.transaction;
    repository.transaction = async () => { throw new Error("currency write failed"); };
    try {
      const response = await currenciesPost(new Request("http://localhost", { method: "POST", body: JSON.stringify({ name: "Other Currency", symbol: "OC", decimalCount: 2, isoCode: "OTC" }) }), { params: Promise.resolve({ businessId: defaultBusiness.id }) });
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({ error: { code: "CURRENCY_REPOSITORY_CONFLICT", message: "The currency changed elsewhere." } });
    } finally {
      repository.transaction = originalTransaction;
    }
  });

  it("returns a stable 409 contract for currency deactivation repository conflicts", async () => {
    const currencyOwner = { providerUserId: "route-currency-update-owner", email: "route-currency-update-owner@example.com", displayName: "Owner", emailVerified: true };
    const defaultBusiness = await createOnboardingServices(defaultOnboardingRepository).createBusiness({ name: `Currency Update Conflict ${Date.now()}` }, currencyOwner);
    await setCurrentIdentity(currencyOwner);
    const created = await currenciesPost(new Request("http://localhost", { method: "POST", body: JSON.stringify({ name: "Update Currency", symbol: "UC", decimalCount: 2, isoCode: "UCU" }) }), { params: Promise.resolve({ businessId: defaultBusiness.id }) });
    const currency = await created.json() as { id: string };
    const state = globalThis as typeof globalThis & { [key: symbol]: unknown };
    const repository = state[Symbol.for("ledgerharbour.task9.currencyRepository")] as { update: (value: unknown) => Promise<unknown> };
    const originalUpdate = repository.update;
    repository.update = async () => { throw new Error("currency update failed"); };
    try {
      const response = await currenciesPatch(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ currencyId: currency.id, isActive: false }) }), { params: Promise.resolve({ businessId: defaultBusiness.id }) });
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({ error: { code: "CURRENCY_REPOSITORY_CONFLICT", message: "The currency changed elsewhere." } });
    } finally {
      repository.update = originalUpdate;
    }
  });

  it("classifies invoice list rows from explicit document status", async () => {
    const failedDocument: Document = { ...((await documents.findById(invoice.documentId)) as Document), id: "failed-document", privateObjectKey: "private/failed-document", checksum: "failed-checksum", status: "failed" as Document["status"] };
    const reviewDocument: Document = { ...((await documents.findById(invoice.documentId)) as Document), id: "review-document-2", privateObjectKey: "private/review-document-2", checksum: "review-checksum-2", status: "needs_review" as Document["status"] };
    await documents.create(failedDocument);
    await documents.create(reviewDocument);
    await invoices.create({ ...invoice, id: "failed-invoice" as InvoiceId, documentId: failedDocument.id as DocumentId, total: "120.00", reviewState: "needs_review" });
    await invoices.update({ ...invoice, documentId: reviewDocument.id as DocumentId, total: null, reviewState: "needs_review" });

    const rows = await listInvoices(business.id, user("reviewer"), { tenancyRepository: tenancy, documentRepository: documents, invoices });
    expect(rows.find((row) => row.id === "failed-invoice")).toMatchObject({ documentStatus: "failed" });
    expect(rows.find((row) => row.id === invoice.id)).toMatchObject({ documentStatus: "needs_review" });
    expect(rows.find((row) => row.id === "failed-invoice")).not.toHaveProperty("privateObjectKey");
  });
});

type CurrencyTransaction = <T>(operation: () => Promise<T>) => Promise<T>;
