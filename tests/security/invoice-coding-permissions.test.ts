import { describe, expect, it, vi } from "vitest";

import type { AuthIdentity } from "../../src/modules/auth/auth-provider";
import { getCurrentIdentity } from "../../src/modules/auth/session";
import { createHeadingRepository, importHeadings, listHeadings, resolveDefaultHeadingRepository, type HeadingRepository, type TemplateHeadingInput } from "../../src/modules/accounting/heading-service";
import { createDocumentRepository, type Document } from "../../src/modules/documents/document-service";
import { createInvoiceCodingRepository, type InvoiceCodingRepository } from "../../src/modules/invoices/invoice-coding-repository";
import { getInvoiceReview, updateInvoiceDraft } from "../../src/modules/invoices/invoice-review-service";
import {
  createInvoiceRepository,
  getInvoiceCoding,
  resolveDefaultDocumentRepository,
  resolveDefaultInvoiceRepository,
  type InvoiceRepository,
} from "../../src/modules/invoices/invoice-service";
import type { DocumentId, InvoiceId } from "../../src/modules/invoices/ocr-provider";
import { resetPersistenceContextForTests, getPersistenceContext } from "../../src/modules/persistence/repository-factory";
import { createInMemoryOnboardingRepository, defaultOnboardingRepository, type OnboardingActor, type OnboardingRepository } from "../../src/modules/tenancy/business-service";
import type { UserId } from "../../src/modules/tenancy/types";
import { createApprovedBusiness } from "../helpers/business-fixtures";

vi.mock("../../src/modules/auth/session", () => ({ getCurrentIdentity: vi.fn() }));

import { GET as reviewGet, PATCH as reviewPatch } from "../../src/app/api/invoices/[invoiceId]/review/route";

const user = (value: string) => value as UserId;
const headingInputs: TemplateHeadingInput[] = [
  { position: 1, templateValue: "Rent", valueType: "text", group: "expenses", order: 1, blockedReason: null },
];
const confident = { supplier: 1, invoiceNumber: 1, invoiceDate: 1, dueDate: 1, subtotal: 1, taxAmount: 1, total: 1, currencyReference: 1, expenseCategoryReference: 1, notes: 1 };

async function seedSide(tenancy: OnboardingRepository, headings: HeadingRepository, documents: ReturnType<typeof createDocumentRepository>, invoices: InvoiceRepository, codings: InvoiceCodingRepository, name: string, owner: OnboardingActor) {
  const business = await createApprovedBusiness(tenancy, name, owner);
  await importHeadings(business.id, headingInputs, owner, { tenancyRepository: tenancy, headings });
  const [heading] = await listHeadings(business.id, owner, { tenancyRepository: tenancy, headings });
  const now = new Date().toISOString();
  const id = `${business.id}-invoice`;
  const document: Document = { id: `${id}-document`, businessId: business.id, uploaderId: user("seed"), privateObjectKey: `private/${id}`, originalFileName: "a.pdf", originalMimeType: "application/pdf", originalSizeBytes: 4, checksum: `checksum-${id}`, status: "needs_review", createdAt: now };
  await documents.create(document);
  const invoice = await invoices.create({
    id: id as InvoiceId, businessId: business.id, documentId: document.id as DocumentId, supplier: "Shared Supplier", invoiceNumber: id, invoiceDate: "2026-08-11", dueDate: null,
    subtotal: null, taxAmount: null, total: "50.00", currencyReference: "GBP", expenseCategoryReference: null, notes: null, confidenceData: { ...confident }, reviewState: "needs_review", createdAt: now, updatedAt: now,
  });
  await codings.replace(business.id, invoice.id, [{ headingId: heading.id, amount: "50.00" }], now);
  return { business, heading, invoice };
}

describe("invoice coding isolation in the service", () => {
  async function fixture() {
    const tenancy = createInMemoryOnboardingRepository();
    const headings = createHeadingRepository();
    const documents = createDocumentRepository();
    const invoices = createInvoiceRepository();
    const codings = createInvoiceCodingRepository(invoices);
    const a = await seedSide(tenancy, headings, documents, invoices, codings, "Coding Harbour A", user("owner-a"));
    const b = await seedSide(tenancy, headings, documents, invoices, codings, "Coding Harbour B", user("owner-b"));
    return { tenancy, codings, dependencies: { tenancyRepository: tenancy, documentRepository: documents, invoices, headings, codings }, a, b };
  }

  it("does not let a member of business B read or write business A's coding", async () => {
    const { codings, dependencies, a, b } = await fixture();

    await expect(getInvoiceCoding(a.invoice.id, user("owner-b"), dependencies)).rejects.toMatchObject({ code: "BUSINESS_ACCESS_DENIED" });
    await expect(getInvoiceReview(a.invoice.id, user("owner-b"), dependencies)).rejects.toMatchObject({ code: "BUSINESS_ACCESS_DENIED" });
    await expect(updateInvoiceDraft({ invoiceId: a.invoice.id, coding: [{ headingId: b.heading.id, amount: "50.00" }] }, user("owner-b"), dependencies)).rejects.toMatchObject({ code: "BUSINESS_ACCESS_DENIED" });
    await expect(updateInvoiceDraft({ invoiceId: a.invoice.id, coding: [] }, user("owner-b"), dependencies)).rejects.toMatchObject({ code: "BUSINESS_ACCESS_DENIED" });

    await expect(codings.list(a.business.id, a.invoice.id)).resolves.toEqual([{ headingId: a.heading.id, amount: "50.00" }]);
  });

  it("refuses a heading of business B on an invoice of business A, even for a member of both", async () => {
    const { tenancy, codings, dependencies, a, b } = await fixture();
    await tenancy.createMembership({ membershipId: "membership-owner-a-in-b", userId: user("owner-a"), businessId: b.business.id, role: "administrator", isActive: true, status: "active" });

    await expect(updateInvoiceDraft({ invoiceId: a.invoice.id, coding: [{ headingId: b.heading.id, amount: "50.00" }] }, user("owner-a"), dependencies)).rejects.toMatchObject({ code: "HEADING_NOT_FOUND" });
    await expect(codings.list(a.business.id, a.invoice.id)).resolves.toEqual([{ headingId: a.heading.id, amount: "50.00" }]);
    // Same supplier in both businesses: B's coding is never offered to A.
    await codings.replace(a.business.id, a.invoice.id, [], new Date().toISOString());
    await expect(getInvoiceReview(a.invoice.id, user("owner-a"), dependencies)).resolves.toMatchObject({ suggestedHeadingId: null });
  });
});

describe("invoice coding isolation through the route handlers", () => {
  const mockedIdentity = vi.mocked(getCurrentIdentity);
  const identity = (name: string): AuthIdentity => ({ provider: "firebase", providerUserId: `lh020-${name}`, email: `lh020-${name}@example.com`, displayName: name, emailVerified: true });
  const ownerA = identity("owner-a");
  const ownerB = identity("owner-b");
  const params = (invoiceId: string) => ({ params: Promise.resolve({ invoiceId }) });
  const patch = (body: unknown) => new Request("http://localhost/api", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  async function routeFixture() {
    delete process.env.PERSISTENCE_MODE;
    await resetPersistenceContextForTests();
    const stamp = `${Date.now()}-${Math.random()}`;
    const context = getPersistenceContext();
    const documents = resolveDefaultDocumentRepository() as ReturnType<typeof createDocumentRepository>;
    const a = await seedSide(defaultOnboardingRepository, resolveDefaultHeadingRepository(), documents, resolveDefaultInvoiceRepository(), context.invoiceCodingRepository, `Route Coding A ${stamp}`, ownerA);
    const b = await seedSide(defaultOnboardingRepository, resolveDefaultHeadingRepository(), documents, resolveDefaultInvoiceRepository(), context.invoiceCodingRepository, `Route Coding B ${stamp}`, ownerB);
    return { codings: context.invoiceCodingRepository, a, b };
  }

  it("serves a member's own coding and refuses another business's invoice or heading", async () => {
    const { codings, a, b } = await routeFixture();

    mockedIdentity.mockResolvedValue(ownerA);
    const own = await reviewGet(new Request("http://localhost/api"), params(a.invoice.id));
    expect(own.status).toBe(200);
    await expect(own.json()).resolves.toMatchObject({ coding: [{ headingId: a.heading.id, amount: "50.00" }] });
    const foreignHeading = await reviewPatch(patch({ coding: [{ headingId: b.heading.id, amount: "50.00" }] }), params(a.invoice.id));
    expect({ status: foreignHeading.status, body: await foreignHeading.json() }).toMatchObject({ status: 400, body: { error: { code: "HEADING_NOT_FOUND" } } });

    mockedIdentity.mockResolvedValue(ownerB);
    const read = await reviewGet(new Request("http://localhost/api"), params(a.invoice.id));
    expect({ status: read.status, body: await read.json() }).toEqual({ status: 403, body: { error: { code: "BUSINESS_ACCESS_DENIED", message: "Business access denied." } } });
    const write = await reviewPatch(patch({ coding: [{ headingId: b.heading.id, amount: "50.00" }] }), params(a.invoice.id));
    expect(write.status).toBe(403);
    const approve = await reviewPatch(patch({ action: "approve" }), params(a.invoice.id));
    expect(approve.status).toBe(403);

    await expect(codings.list(a.business.id, a.invoice.id)).resolves.toEqual([{ headingId: a.heading.id, amount: "50.00" }]);
    await expect(resolveDefaultInvoiceRepository().findById(a.invoice.id)).resolves.toMatchObject({ reviewState: "needs_review" });
  });
});
