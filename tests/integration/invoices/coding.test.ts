import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET as reviewGet, PATCH as reviewPatch } from "../../../src/app/api/invoices/[invoiceId]/review/route";
import { PATCH as invoicePatch } from "../../../src/app/api/invoices/[invoiceId]/route";
import { createHeadingRepository, resolveDefaultHeadingRepository, type AccountHeading, type HeadingRepository } from "../../../src/modules/accounting/heading-service";
import { clearCurrentIdentity, setCurrentIdentity } from "../../../src/modules/auth/session";
import { createDocumentRepository, type Document } from "../../../src/modules/documents/document-service";
import { createInvoiceCodingRepository, resolveInvoiceCodingRepository, type InvoiceCodingRepository } from "../../../src/modules/invoices/invoice-coding-repository";
import { getInvoiceReview, updateInvoiceDraft } from "../../../src/modules/invoices/invoice-review-service";
import {
  approveInvoice,
  createInvoiceRepository,
  getInvoiceCoding,
  resolveDefaultDocumentRepository,
  resolveDefaultInvoiceRepository,
  type InMemoryInvoiceRepository,
  type Invoice,
  type InvoiceDependencies,
} from "../../../src/modules/invoices/invoice-service";
import type { DocumentId, InvoiceId } from "../../../src/modules/invoices/ocr-provider";
import { createInMemoryOnboardingRepository, defaultOnboardingRepository, type MemoryOnboardingRepository } from "../../../src/modules/tenancy/business-service";
import type { BusinessId, UserId } from "../../../src/modules/tenancy/types";
import { createApprovedBusiness } from "../../helpers/business-fixtures";

const user = (value: string) => value as UserId;
const owner = user("coding-owner");
const confident = { supplier: 1, invoiceNumber: 1, invoiceDate: 1, dueDate: 1, subtotal: 1, taxAmount: 1, total: 1, currencyReference: 1, expenseCategoryReference: 1, notes: 1 };

function heading(id: string, businessId: BusinessId, position: number, overrides: Partial<AccountHeading> = {}): AccountHeading {
  const now = "2026-01-01T00:00:00.000Z";
  return { id, businessId, position, templateValue: id, valueType: "text", group: "expenses", sortOrder: position, displayName: id, isActive: true, blockedReason: null, createdAt: now, updatedAt: now, ...overrides };
}

async function seedInvoice(
  invoices: InMemoryInvoiceRepository,
  documents: ReturnType<typeof createDocumentRepository>,
  businessId: BusinessId,
  id: string,
  overrides: Partial<Invoice> = {},
): Promise<Invoice> {
  const now = new Date().toISOString();
  const document: Document = {
    id: `document-${id}`, businessId, uploaderId: owner, privateObjectKey: `private/${id}`, originalFileName: `${id}.pdf`,
    originalMimeType: "application/pdf", originalSizeBytes: 4, checksum: `checksum-${id}`, status: "needs_review", createdAt: now,
  };
  await documents.create(document);
  return invoices.create({
    id: id as InvoiceId, businessId, documentId: document.id as DocumentId, supplier: "Acme Ltd", invoiceNumber: id, invoiceDate: "2026-08-11",
    dueDate: null, subtotal: "100.00", taxAmount: "20.00", total: "120.00", currencyReference: "GBP", expenseCategoryReference: null, notes: null,
    confidenceData: { ...confident }, reviewState: "needs_review", createdAt: now, updatedAt: now, ...overrides,
  });
}

describe("invoice coding rules", () => {
  let tenancy: MemoryOnboardingRepository;
  let documents: ReturnType<typeof createDocumentRepository>;
  let invoices: InMemoryInvoiceRepository;
  let headings: HeadingRepository;
  let codings: InvoiceCodingRepository;
  let businessId: BusinessId;
  let otherBusinessId: BusinessId;
  let invoice: Invoice;
  let dependencies: InvoiceDependencies;

  const save = (input: Omit<Parameters<typeof updateInvoiceDraft>[0], "invoiceId">, invoiceId: InvoiceId = invoice.id) => updateInvoiceDraft({ invoiceId, ...input }, owner, dependencies);

  beforeEach(async () => {
    tenancy = createInMemoryOnboardingRepository();
    documents = createDocumentRepository();
    invoices = createInvoiceRepository();
    headings = createHeadingRepository();
    codings = createInvoiceCodingRepository(invoices);
    businessId = (await createApprovedBusiness(tenancy, "Coding Books", owner)).id;
    otherBusinessId = (await createApprovedBusiness(tenancy, "Other Coding Books", user("other-owner"))).id;
    await headings.create(heading("rent", businessId, 1));
    await headings.create(heading("sales", businessId, 2, { group: "income" }));
    await headings.create(heading("phone", businessId, 3, { isActive: false, blockedReason: "total_read_twice" }));
    await headings.create(heading("spare", businessId, 4, { isActive: false }));
    await headings.create(heading("other-rent", otherBusinessId, 1));
    invoice = await seedInvoice(invoices, documents, businessId, "coding-invoice");
    dependencies = { tenancyRepository: tenancy, documentRepository: documents, invoices, headings, codings };
  });

  it("stores one line equal to the total, normalised to pence, and reads it back", async () => {
    await save({ coding: [{ headingId: "rent", amount: "120" }] });

    await expect(getInvoiceCoding(invoice.id, owner, dependencies)).resolves.toEqual([{ headingId: "rent", amount: "120.00" }]);
  });

  it("only accepts an active, unblocked heading of the invoice's own business", async () => {
    await expect(save({ coding: [{ headingId: "missing", amount: "120.00" }] })).rejects.toMatchObject({ code: "HEADING_NOT_FOUND" });
    await expect(save({ coding: [{ headingId: "other-rent", amount: "120.00" }] })).rejects.toMatchObject({ code: "HEADING_NOT_FOUND" });
    await expect(save({ coding: [{ headingId: "phone", amount: "120.00" }] })).rejects.toMatchObject({ code: "HEADING_NOT_USABLE" });
    await expect(save({ coding: [{ headingId: "spare", amount: "120.00" }] })).rejects.toMatchObject({ code: "HEADING_NOT_USABLE" });
    await expect(codings.list(businessId, invoice.id)).resolves.toEqual([]);
  });

  it("rejects the same heading on two lines", async () => {
    await expect(save({ coding: [{ headingId: "rent", amount: "60.00" }, { headingId: "rent", amount: "60.00" }] })).rejects.toMatchObject({ code: "CODING_DUPLICATE_HEADING" });
  });

  it("rejects amounts that are not positive pounds and more than 20 lines", async () => {
    for (const amount of ["0", "0.00", "-120.00", "1.234", "12,00", "abc", ""]) {
      await expect(save({ coding: [{ headingId: "rent", amount }] }), amount).rejects.toMatchObject({ code: "INVALID_CODING" });
    }
    const many = Array.from({ length: 21 }, (_, index) => ({ headingId: `h-${index}`, amount: "1.00" }));
    await expect(save({ coding: many })).rejects.toMatchObject({ code: "INVALID_CODING" });
  });

  it("splits over several headings when the lines add up to the total exactly in pence", async () => {
    await expect(save({ coding: [{ headingId: "rent", amount: "100.00" }, { headingId: "sales", amount: "19.99" }] })).rejects.toMatchObject({ code: "CODING_TOTAL_MISMATCH" });
    await save({ coding: [{ headingId: "rent", amount: "100.1" }, { headingId: "sales", amount: "19.9" }] });
    await expect(codings.list(businessId, invoice.id)).resolves.toEqual([{ headingId: "rent", amount: "100.10" }, { headingId: "sales", amount: "19.90" }]);

    const pennies = await seedInvoice(invoices, documents, businessId, "pennies", { total: "0.30" });
    await save({ coding: [{ headingId: "rent", amount: "0.10" }, { headingId: "sales", amount: "0.20" }] }, pennies.id);
    await expect(codings.list(businessId, pennies.id)).resolves.toHaveLength(2);
  });

  it("saves field changes and the coding together, and neither when the coding is rejected", async () => {
    await expect(save({ fields: { notes: "Coded", total: "150.00" }, coding: [{ headingId: "rent", amount: "150.00" }] })).resolves.toMatchObject({ notes: "Coded", total: "150.00" });
    await expect(codings.list(businessId, invoice.id)).resolves.toEqual([{ headingId: "rent", amount: "150.00" }]);

    await expect(save({ fields: { notes: "Not saved" }, coding: [{ headingId: "rent", amount: "1.00" }] })).rejects.toMatchObject({ code: "CODING_TOTAL_MISMATCH" });
    expect((await invoices.findById(invoice.id))?.notes).toBe("Coded");
    await expect(codings.list(businessId, invoice.id)).resolves.toEqual([{ headingId: "rent", amount: "150.00" }]);
  });

  it("rolls the field changes back when storing the coding fails", async () => {
    const failing: InvoiceCodingRepository = { ...codings, list: codings.list.bind(codings), transaction: codings.transaction.bind(codings), findSupplierHeadingId: codings.findSupplierHeadingId.bind(codings), replace: async () => { throw new Error("coding write failed"); } };

    await expect(updateInvoiceDraft({ invoiceId: invoice.id, fields: { notes: "Half written" }, coding: [{ headingId: "rent", amount: "120.00" }] }, owner, { ...dependencies, codings: failing })).rejects.toThrow("coding write failed");

    expect((await invoices.findById(invoice.id))?.notes).toBeNull();
    await expect(codings.list(businessId, invoice.id)).resolves.toEqual([]);
  });

  it("clears the coding with an empty list", async () => {
    await save({ coding: [{ headingId: "rent", amount: "120.00" }] });
    await save({ coding: [] });

    await expect(codings.list(businessId, invoice.id)).resolves.toEqual([]);
  });

  it("stores lines without a total but does not approve until the total is there", async () => {
    const untotalled = await seedInvoice(invoices, documents, businessId, "untotalled", { total: null });
    await save({ coding: [{ headingId: "rent", amount: "80.00" }, { headingId: "sales", amount: "40.00" }] }, untotalled.id);
    await expect(codings.list(businessId, untotalled.id)).resolves.toHaveLength(2);

    await expect(approveInvoice(untotalled.id, owner, dependencies)).rejects.toMatchObject({ code: "INVOICE_INVALID_FOR_APPROVAL" });
    await invoices.update({ ...(await invoices.findById(untotalled.id))!, total: "120.00" });
    await expect(approveInvoice(untotalled.id, owner, dependencies)).resolves.toMatchObject({ reviewState: "approved" });
  });

  it("moves a single line with a new total and rejects a new total that a split no longer adds up to", async () => {
    await save({ coding: [{ headingId: "rent", amount: "120.00" }] });
    await save({ fields: { total: "99.5" } });
    await expect(codings.list(businessId, invoice.id)).resolves.toEqual([{ headingId: "rent", amount: "99.50" }]);

    await save({ coding: [{ headingId: "rent", amount: "50.00" }, { headingId: "sales", amount: "49.50" }] });
    await expect(save({ fields: { total: "100.00", notes: "Not saved" } })).rejects.toMatchObject({ code: "CODING_TOTAL_MISMATCH" });
    expect(await invoices.findById(invoice.id)).toMatchObject({ total: "99.5", notes: null });

    await save({ fields: { total: null } });
    await expect(codings.list(businessId, invoice.id)).resolves.toHaveLength(2);
  });

  it("requires a coding that covers the total before approval and keeps it immutable afterwards", async () => {
    await expect(approveInvoice(invoice.id, owner, dependencies)).rejects.toMatchObject({ code: "CODING_REQUIRED" });

    const untotalled = await seedInvoice(invoices, documents, businessId, "coded-no-total", { total: null });
    await save({ coding: [{ headingId: "rent", amount: "120.00" }] }, untotalled.id);
    await invoices.update({ ...(await invoices.findById(untotalled.id))!, total: "130.00" });
    await expect(approveInvoice(untotalled.id, owner, dependencies)).rejects.toMatchObject({ code: "CODING_REQUIRED" });

    await save({ coding: [{ headingId: "rent", amount: "120.00" }] });
    await expect(approveInvoice(invoice.id, owner, dependencies)).resolves.toMatchObject({ reviewState: "approved" });
    await expect(save({ coding: [{ headingId: "sales", amount: "120.00" }] })).rejects.toMatchObject({ code: "INVALID_INVOICE_STATE" });
    await expect(codings.list(businessId, invoice.id)).resolves.toEqual([{ headingId: "rent", amount: "120.00" }]);
  });

  it("suggests the heading last used alone with the same supplier in the same business", async () => {
    const earlier = await seedInvoice(invoices, documents, businessId, "earlier", { supplier: "ACME LTD " });
    await save({ coding: [{ headingId: "sales", amount: "120.00" }] }, earlier.id);
    await expect(getInvoiceReview(invoice.id, owner, dependencies)).resolves.toMatchObject({ coding: [], suggestedHeadingId: "sales" });

    const later = await seedInvoice(invoices, documents, businessId, "later", { supplier: " acme ltd" });
    await save({ coding: [{ headingId: "rent", amount: "120.00" }] }, later.id);
    await expect(getInvoiceReview(invoice.id, owner, dependencies)).resolves.toMatchObject({ suggestedHeadingId: "rent" });

    // A split invoice says nothing about the single code to propose; the latest single-line one wins.
    const split = await seedInvoice(invoices, documents, businessId, "split", { supplier: "Acme Ltd" });
    await save({ coding: [{ headingId: "sales", amount: "60.00" }, { headingId: "rent", amount: "60.00" }] }, split.id);
    await expect(getInvoiceReview(invoice.id, owner, dependencies)).resolves.toMatchObject({ suggestedHeadingId: "rent" });

    // The invoice's own coding is never its suggestion.
    await expect(getInvoiceReview(later.id, owner, dependencies)).resolves.toMatchObject({ suggestedHeadingId: "sales" });

    await headings.update({ ...(await headings.findById("rent", businessId))!, isActive: false }, businessId);
    await expect(getInvoiceReview(invoice.id, owner, dependencies)).resolves.toMatchObject({ suggestedHeadingId: null });
  });

  it("does not suggest from another supplier, an empty supplier or another business", async () => {
    const other = await seedInvoice(invoices, documents, businessId, "other-supplier", { supplier: "Acme Holdings" });
    await save({ coding: [{ headingId: "rent", amount: "120.00" }] }, other.id);
    const unnamed = await seedInvoice(invoices, documents, businessId, "unnamed", { supplier: "  " });
    await expect(getInvoiceReview(invoice.id, owner, dependencies)).resolves.toMatchObject({ suggestedHeadingId: null });
    await expect(getInvoiceReview(unnamed.id, owner, dependencies)).resolves.toMatchObject({ suggestedHeadingId: null });

    await tenancy.createMembership({ membershipId: "membership-owner-other", userId: owner, businessId: otherBusinessId, role: "administrator", isActive: true, status: "active" });
    const elsewhere = await seedInvoice(invoices, documents, otherBusinessId, "elsewhere");
    await save({ coding: [{ headingId: "other-rent", amount: "120.00" }] }, elsewhere.id);
    await expect(getInvoiceReview(invoice.id, owner, dependencies)).resolves.toMatchObject({ suggestedHeadingId: null });
  });
});

describe("invoice coding routes", () => {
  const identity = { providerUserId: "coding-route-owner", email: "coding-route-owner@example.com", displayName: "Coding Owner", emailVerified: true };
  let businessId: BusinessId;
  let invoice: Invoice;
  const context = () => ({ params: Promise.resolve({ invoiceId: invoice.id }) });
  const patch = (body: unknown) => reviewPatch(new Request("http://localhost", { method: "PATCH", body: JSON.stringify(body) }), context());

  beforeEach(async () => {
    process.env.AUTH_MODE = "firebase";
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    businessId = (await createApprovedBusiness(defaultOnboardingRepository, `Coding Route ${suffix}`, identity)).id;
    await resolveDefaultHeadingRepository().create(heading(`route-rent-${suffix}`, businessId, 1));
    await resolveDefaultHeadingRepository().create(heading(`route-sales-${suffix}`, businessId, 2, { group: "income" }));
    invoice = await seedInvoice(resolveDefaultInvoiceRepository() as InMemoryInvoiceRepository, resolveDefaultDocumentRepository() as ReturnType<typeof createDocumentRepository>, businessId, `route-invoice-${suffix}`);
    await setCurrentIdentity(identity);
  });

  afterEach(async () => {
    await clearCurrentIdentity();
  });

  it("saves a coding through the review route and returns it with the review", async () => {
    const [rent] = await resolveDefaultHeadingRepository().listByBusinessId(businessId);

    const blocked = await reviewPatch(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ action: "approve" }) }), context());
    expect(blocked.status).toBe(409);
    await expect(blocked.json()).resolves.toMatchObject({ error: { code: "CODING_REQUIRED" } });

    const mismatch = await patch({ coding: [{ headingId: rent.id, amount: "1.00" }] });
    expect(mismatch.status).toBe(400);
    await expect(mismatch.json()).resolves.toMatchObject({ error: { code: "CODING_TOTAL_MISMATCH" } });

    expect((await patch({ notes: "Coded", coding: [{ headingId: rent.id, amount: "120.00" }] })).status).toBe(200);
    const review = await reviewGet(new Request("http://localhost"), context());
    await expect(review.json()).resolves.toMatchObject({ invoice: { notes: "Coded" }, coding: [{ headingId: rent.id, amount: "120.00" }], suggestedHeadingId: null });
    await expect(getInvoiceCoding(invoice.id, identity)).resolves.toEqual([{ headingId: rent.id, amount: "120.00" }]);
    expect(resolveInvoiceCodingRepository(resolveDefaultInvoiceRepository())).toBe(resolveInvoiceCodingRepository(resolveDefaultInvoiceRepository()));

    const approved = await patch({ action: "approve" });
    expect(approved.status).toBe(200);
  });

  it("rejects malformed coding bodies before the service", async () => {
    const [rent] = await resolveDefaultHeadingRepository().listByBusinessId(businessId);
    for (const coding of [
      [{ headingId: rent.id, amount: 120 }],
      [{ headingId: rent.id, amount: "120.00", extra: true }],
      [{ headingId: "", amount: "120.00" }],
      Array.from({ length: 21 }, () => ({ headingId: rent.id, amount: "1.00" })),
      { headingId: rent.id, amount: "120.00" },
    ]) {
      const response = await patch({ coding });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "INVALID_INVOICE_REVIEW" } });
    }
  });

  it("enforces the coding when approving through the plain invoice route too", async () => {
    const response = await invoicePatch(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ action: "approve" }) }), context());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "CODING_REQUIRED" } });
  });
});
