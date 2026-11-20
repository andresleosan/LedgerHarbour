import { describe, expect, it, vi } from "vitest";

import type { AuthIdentity } from "../../src/modules/auth/auth-provider";
import { getCurrentIdentity } from "../../src/modules/auth/session";
import { createHeadingRepository, importHeadings, listHeadings, resolveDefaultHeadingRepository, type HeadingRepository, type TemplateHeadingInput } from "../../src/modules/accounting/heading-service";
import { createMoneyRepository, resolveDefaultMoneyRepository, type MoneyRepository } from "../../src/modules/accounting/money-repository";
import { createDocumentRepository, type Document } from "../../src/modules/documents/document-service";
import { createInvoiceCodingRepository, type InvoiceCodingRepository } from "../../src/modules/invoices/invoice-coding-repository";
import { changeInvoicePayment, listPrivatelyPaidInvoices, listUnpaidInvoices, voidInvoice } from "../../src/modules/invoices/invoice-payment-service";
import { approveInvoice, createInvoiceRepository, resolveDefaultDocumentRepository, resolveDefaultInvoiceRepository, type InvoiceRepository } from "../../src/modules/invoices/invoice-service";
import type { DocumentId, InvoiceId } from "../../src/modules/invoices/ocr-provider";
import { MAX_REVIEW_PATCH_BYTES } from "../../src/modules/invoices/review-validation";
import { getPersistenceContext, resetPersistenceContextForTests } from "../../src/modules/persistence/repository-factory";
import { createInMemoryOnboardingRepository, defaultOnboardingRepository, type OnboardingActor, type OnboardingRepository } from "../../src/modules/tenancy/business-service";
import type { UserId } from "../../src/modules/tenancy/types";
import { createApprovedBusiness } from "../helpers/business-fixtures";

vi.mock("../../src/modules/auth/session", () => ({ getCurrentIdentity: vi.fn() }));

import { PATCH as reviewPatch } from "../../src/app/api/invoices/[invoiceId]/review/route";
import { PATCH as paymentPatch } from "../../src/app/api/invoices/[invoiceId]/payment/route";
import { POST as voidPost } from "../../src/app/api/invoices/[invoiceId]/void/route";
import { GET as unpaidGet } from "../../src/app/api/businesses/[businessId]/invoices/unpaid/route";

const user = (value: string) => value as UserId;
const headingInputs: TemplateHeadingInput[] = [{ position: 1, templateValue: "Rent", valueType: "text", group: "expenses", order: 1, blockedReason: null }];
const confident = { supplier: 1, invoiceNumber: 1, invoiceDate: 1, dueDate: 1, subtotal: 1, taxAmount: 1, total: 1, currencyReference: 1, expenseCategoryReference: 1, notes: 1 };
const at = "2026-01-01T00:00:00.000Z";

type Stores = { tenancy: OnboardingRepository; headings: HeadingRepository; documents: ReturnType<typeof createDocumentRepository>; invoices: InvoiceRepository; codings: InvoiceCodingRepository; money: MoneyRepository };

/** A business with an open year, a bank account, and two coded invoices: one approved as unpaid, one still a draft. */
async function seedSide(stores: Stores, name: string, owner: OnboardingActor) {
  const business = await createApprovedBusiness(stores.tenancy, name, owner);
  await importHeadings(business.id, headingInputs, owner, { tenancyRepository: stores.tenancy, headings: stores.headings });
  const [heading] = await listHeadings(business.id, owner, { tenancyRepository: stores.tenancy, headings: stores.headings });
  await stores.money.createYear({ id: `${business.id}-year`, businessId: business.id, startDate: "2026-04-06", endDate: "2027-04-05", status: "open", createdAt: at, updatedAt: at });
  const bank = await stores.money.createAccount({ id: `${business.id}-bank`, businessId: business.id, name: "Bank", kind: "bank", sheetName: "Bank", isActive: true, createdAt: at, updatedAt: at });
  const invoice = async (suffix: string, approved: boolean) => {
    const id = `${business.id}-${suffix}`;
    const document: Document = { id: `${id}-document`, businessId: business.id, uploaderId: user("seed"), privateObjectKey: `private/${id}`, originalFileName: "a.pdf", originalMimeType: "application/pdf", originalSizeBytes: 4, checksum: `checksum-${id}`, status: "needs_review", createdAt: at };
    await stores.documents.create(document);
    const created = await stores.invoices.create({
      id: id as InvoiceId, businessId: business.id, documentId: document.id as DocumentId, supplier: "Shared Supplier", invoiceNumber: id, invoiceDate: "2026-08-11", dueDate: null,
      subtotal: null, taxAmount: null, total: "50.00", currencyReference: "GBP", expenseCategoryReference: null, notes: null, confidenceData: { ...confident },
      reviewState: approved ? "approved" : "needs_review", createdAt: at, updatedAt: at, ...(approved ? { paymentStatus: "unpaid" as const } : {}),
    });
    await stores.codings.replace(business.id, created.id, [{ headingId: heading.id, amount: "50.00" }], at);
    return created;
  };
  return { business, bank, approved: await invoice("approved", true), draft: await invoice("draft", false) };
}

const paidFrom = (accountId: string) => ({ status: "paid" as const, accountId, paidOn: "2026-08-12", amountDebited: "50.00" });

describe("invoice payment isolation in the service", () => {
  async function fixture() {
    const invoices = createInvoiceRepository();
    const stores: Stores = { tenancy: createInMemoryOnboardingRepository(), headings: createHeadingRepository(), documents: createDocumentRepository(), invoices, codings: createInvoiceCodingRepository(invoices), money: createMoneyRepository() };
    const a = await seedSide(stores, "Payment Harbour A", user("owner-a"));
    const b = await seedSide(stores, "Payment Harbour B", user("owner-b"));
    const dependencies = { tenancyRepository: stores.tenancy, documentRepository: stores.documents, invoices, headings: stores.headings, codings: stores.codings, money: stores.money };
    return { stores, dependencies, a, b };
  }

  it("does not let a member of business B pay, change the payment of, void or list business A's invoices", async () => {
    const { stores, dependencies, a, b } = await fixture();
    const outsider = user("owner-b");

    await expect(approveInvoice(a.draft.id, outsider, dependencies, paidFrom(b.bank.id))).rejects.toMatchObject({ code: "BUSINESS_ACCESS_DENIED" });
    await expect(changeInvoicePayment(a.approved.id, outsider, paidFrom(b.bank.id), dependencies)).rejects.toMatchObject({ code: "BUSINESS_ACCESS_DENIED" });
    await expect(voidInvoice(a.approved.id, outsider, dependencies)).rejects.toMatchObject({ code: "BUSINESS_ACCESS_DENIED" });
    await expect(listUnpaidInvoices(a.business.id, outsider, dependencies)).rejects.toMatchObject({ code: "BUSINESS_ACCESS_DENIED" });
    await expect(listPrivatelyPaidInvoices(a.business.id, outsider, dependencies)).rejects.toMatchObject({ code: "BUSINESS_ACCESS_DENIED" });

    expect(await stores.invoices.findById(a.approved.id)).toMatchObject({ paymentStatus: "unpaid" });
    expect(await stores.invoices.findById(a.approved.id)).not.toHaveProperty("voidedAt");
    expect(await stores.invoices.findById(a.draft.id)).toMatchObject({ reviewState: "needs_review" });
    await expect(stores.money.listInvoiceMovements(a.business.id, a.approved.id)).resolves.toEqual([]);
  });

  it("refuses an account of business B on an invoice of business A, even for a member of both", async () => {
    const { stores, dependencies, a, b } = await fixture();
    await stores.tenancy.createMembership({ membershipId: "membership-owner-a-in-b", userId: user("owner-a"), businessId: b.business.id, role: "administrator", isActive: true, status: "active" });

    await expect(approveInvoice(a.draft.id, user("owner-a"), dependencies, paidFrom(b.bank.id))).rejects.toMatchObject({ code: "MONEY_ACCOUNT_NOT_FOUND" });
    await expect(changeInvoicePayment(a.approved.id, user("owner-a"), paidFrom(b.bank.id), dependencies)).rejects.toMatchObject({ code: "MONEY_ACCOUNT_NOT_FOUND" });
    expect(await stores.invoices.findById(a.draft.id)).toMatchObject({ reviewState: "needs_review" });
    expect(await stores.invoices.findById(a.approved.id)).toMatchObject({ paymentStatus: "unpaid" });
    await expect(stores.money.listInvoiceMovements(b.business.id, a.approved.id)).resolves.toEqual([]);
    await expect(stores.money.listInvoiceMovements(a.business.id, a.approved.id)).resolves.toEqual([]);
  });
});

describe("invoice payment isolation through the route handlers", () => {
  const mockedIdentity = vi.mocked(getCurrentIdentity);
  const identity = (name: string): AuthIdentity => ({ provider: "firebase", providerUserId: `lh021-${name}`, email: `lh021-${name}@example.com`, displayName: name, emailVerified: true });
  const ownerA = identity("owner-a");
  const ownerB = identity("owner-b");
  const params = (invoiceId: string) => ({ params: Promise.resolve({ invoiceId }) });
  const json = (method: string, body: unknown) => new Request("http://localhost/api", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = async (response: Response) => ({ status: response.status, body: await response.json() });

  async function routeFixture() {
    delete process.env.PERSISTENCE_MODE;
    await resetPersistenceContextForTests();
    const stamp = `${Date.now()}-${Math.random()}`;
    const context = getPersistenceContext();
    const stores: Stores = { tenancy: defaultOnboardingRepository, headings: resolveDefaultHeadingRepository(), documents: resolveDefaultDocumentRepository() as ReturnType<typeof createDocumentRepository>, invoices: resolveDefaultInvoiceRepository(), codings: context.invoiceCodingRepository, money: resolveDefaultMoneyRepository() };
    const a = await seedSide(stores, `Route Payment A ${stamp}`, ownerA);
    const b = await seedSide(stores, `Route Payment B ${stamp}`, ownerB);
    return { stores, a, b };
  }

  it("refuses another business's member on every payment route and serves the owner", async () => {
    const { stores, a, b } = await routeFixture();

    mockedIdentity.mockResolvedValue(ownerB);
    expect(await result(await reviewPatch(json("PATCH", { action: "approve", payment: paidFrom(b.bank.id) }), params(a.draft.id)))).toMatchObject({ status: 403, body: { error: { code: "BUSINESS_ACCESS_DENIED" } } });
    expect(await result(await paymentPatch(json("PATCH", paidFrom(b.bank.id)), params(a.approved.id)))).toMatchObject({ status: 403, body: { error: { code: "BUSINESS_ACCESS_DENIED" } } });
    expect(await result(await voidPost(json("POST", {}), params(a.approved.id)))).toMatchObject({ status: 403, body: { error: { code: "BUSINESS_ACCESS_DENIED" } } });
    expect(await result(await unpaidGet(new Request("http://localhost/api"), { params: Promise.resolve({ businessId: a.business.id }) }))).toMatchObject({ status: 403, body: { error: { code: "BUSINESS_ACCESS_DENIED" } } });
    expect(await stores.invoices.findById(a.approved.id)).toMatchObject({ paymentStatus: "unpaid" });

    mockedIdentity.mockResolvedValue(ownerA);
    expect(await result(await paymentPatch(json("PATCH", paidFrom(b.bank.id)), params(a.approved.id)))).toMatchObject({ status: 400, body: { error: { code: "MONEY_ACCOUNT_NOT_FOUND" } } });
    expect(await result(await reviewPatch(json("PATCH", { action: "approve", payment: paidFrom(b.bank.id) }), params(a.draft.id)))).toMatchObject({ status: 400, body: { error: { code: "MONEY_ACCOUNT_NOT_FOUND" } } });
    expect(await result(await unpaidGet(new Request("http://localhost/api"), { params: Promise.resolve({ businessId: a.business.id }) }))).toEqual({ status: 200, body: { unpaid: [{ id: a.approved.id, supplier: "Shared Supplier", invoiceNumber: a.approved.id, invoiceDate: "2026-08-11", total: "50.00", currency: "GBP", kind: "invoice" }], paidPrivately: [] } });

    expect(await result(await paymentPatch(json("PATCH", paidFrom(a.bank.id)), params(a.approved.id)))).toMatchObject({ status: 200, body: { paymentStatus: "paid", paidAccountId: a.bank.id } });
    await expect(stores.money.listInvoiceMovements(a.business.id, a.approved.id)).resolves.toHaveLength(1);
    expect(await result(await voidPost(json("POST", {}), params(a.approved.id)))).toMatchObject({ status: 200, body: { voidedAt: expect.any(String) } });
    await expect(stores.money.listInvoiceMovements(a.business.id, a.approved.id)).resolves.toEqual([]);
    expect(await result(await paymentPatch(json("PATCH", { status: "unpaid" }), params(a.approved.id)))).toMatchObject({ status: 409, body: { error: { code: "INVOICE_VOIDED" } } });
  });

  it("rejects malformed payment and void bodies before the service", async () => {
    const { stores, a } = await routeFixture();
    mockedIdentity.mockResolvedValue(ownerA);
    for (const body of [{}, { status: "later" }, { status: "unpaid", extra: true }, { status: "paid", accountId: a.bank.id, paidOn: "2026-08-12", amountDebited: 50 }, { status: "paid", accountId: "", paidOn: "2026-08-12", amountDebited: "50.00" }]) {
      expect((await paymentPatch(json("PATCH", body), params(a.approved.id))).status, JSON.stringify(body)).toBe(400);
    }
    expect(await result(await reviewPatch(json("PATCH", { action: "approve", payment: { status: "later" } }), params(a.draft.id)))).toMatchObject({ status: 400, body: { error: { code: "INVALID_INVOICE_REVIEW" } } });
    expect(await result(await reviewPatch(json("PATCH", { action: "approve" }), params(a.draft.id)))).toMatchObject({ status: 409, body: { error: { code: "PAYMENT_REQUIRED" } } });
    const declaredTooLarge = (body: unknown) => {
      const read = vi.fn(async () => body);
      return { read, request: { headers: new Headers({ "content-length": String(MAX_REVIEW_PATCH_BYTES + 1) }), body: null, json: read } as unknown as Request };
    };
    const largePayment = declaredTooLarge({ status: "paid_privately" });
    expect((await paymentPatch(largePayment.request, params(a.approved.id))).status).toBe(400);
    const largeVoid = declaredTooLarge({});
    expect((await voidPost(largeVoid.request, params(a.approved.id))).status).toBe(400);
    expect(largePayment.read).not.toHaveBeenCalled();
    expect(largeVoid.read).not.toHaveBeenCalled();
    expect((await voidPost(json("POST", { reason: "x" }), params(a.approved.id))).status).toBe(400);
    expect((await voidPost(new Request("http://localhost/api", { method: "POST", body: "not json" }), params(a.approved.id))).status).toBe(400);
    expect(await stores.invoices.findById(a.approved.id)).toMatchObject({ paymentStatus: "unpaid" });
    expect(await stores.invoices.findById(a.approved.id)).not.toHaveProperty("voidedAt");
  });
});
