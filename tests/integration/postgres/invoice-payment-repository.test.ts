import { describe, expect, it } from "vitest";

import { createTestDatabase } from "../../../src/db/test-database";
import { invoices } from "../../../src/db/schema";
import type { AuthIdentity } from "../../../src/modules/auth/auth-provider";
import { importHeadings, listHeadings, type TemplateHeadingInput } from "../../../src/modules/accounting/heading-service";
import { changeInvoicePayment, listPrivatelyPaidInvoices, listUnpaidInvoices, voidInvoice } from "../../../src/modules/invoices/invoice-payment-service";
import { getInvoiceReview } from "../../../src/modules/invoices/invoice-review-service";
import { approveInvoice, type InvoiceDependencies } from "../../../src/modules/invoices/invoice-service";
import type { InvoiceId } from "../../../src/modules/invoices/ocr-provider";
import { createPersistenceContext } from "../../../src/modules/persistence/repository-factory";
import type { BusinessId } from "../../../src/modules/tenancy/types";
import { createApprovedBusiness } from "../../helpers/business-fixtures";
import { eq } from "drizzle-orm";

function identity(name: string): AuthIdentity {
  return { providerUserId: `payment-${name}`, email: `payment-${name}@example.com`, displayName: `Payment ${name}`, emailVerified: true };
}

const headingInputs: TemplateHeadingInput[] = [
  { position: 1, templateValue: "Rent", valueType: "text", group: "expenses", order: 1, blockedReason: null },
  { position: 2, templateValue: "Staff", valueType: "text", group: "expenses", order: 2, blockedReason: null },
];
const confidence = JSON.stringify(Object.fromEntries(["supplier", "invoiceNumber", "invoiceDate", "dueDate", "subtotal", "taxAmount", "total", "currencyReference", "expenseCategoryReference", "notes"].map((field) => [field, 1])));
const at = "2026-01-01T00:00:00.000Z";

async function setup() {
  const database = await createTestDatabase();
  const context = createPersistenceContext({ mode: "postgres", database: database.db });
  const dependencies: InvoiceDependencies = {
    tenancyRepository: context.tenancyRepository,
    documentRepository: context.documentRepository,
    invoices: context.invoiceRepository,
    codings: context.invoiceCodingRepository,
    headings: context.headingRepository,
    money: context.moneyRepository,
    transaction: context.transaction,
  };
  const seed = async (name: string) => {
    const owner = identity(name);
    const business = await createApprovedBusiness(context.tenancyRepository, `Payment Books ${name}`, owner);
    const ownerId = await context.tenancyRepository.upsertUser(owner);
    await importHeadings(business.id, headingInputs, owner, { tenancyRepository: context.tenancyRepository, headings: context.headingRepository });
    const [rent, staff] = await listHeadings(business.id, owner, { tenancyRepository: context.tenancyRepository, headings: context.headingRepository });
    await database.execute(`INSERT INTO currencies (id, business_id, name, iso_code, symbol, decimal_count, is_standard, is_active) VALUES ('gbp-${name}', '${business.id}', 'Pound', 'GBP', 'GBP', 2, true, true);`);
    const year = await context.moneyRepository.createYear({ id: `year-${name}`, businessId: business.id, startDate: "2026-04-06", endDate: "2027-04-05", status: "open", createdAt: at, updatedAt: at });
    const bank = await context.moneyRepository.createAccount({ id: `bank-${name}`, businessId: business.id, name: "Bank", kind: "bank", sheetName: "Bank", isActive: true, createdAt: at, updatedAt: at });
    const card = await context.moneyRepository.createAccount({ id: `card-${name}`, businessId: business.id, name: "Card", kind: "bank", sheetName: "Card", isActive: true, createdAt: at, updatedAt: at });
    const invoice = async (id: string, coding: Array<[string, string]> = [[rent.id, "120.00"]]) => {
      await database.execute(`
        INSERT INTO documents (id, business_id, uploader_id, private_object_key, original_file_name, original_mime_type, original_size_bytes, status)
        VALUES ('document-${id}', '${business.id}', '${ownerId}', 'key-${id}', 'invoice.pdf', 'application/pdf', 10, 'needs_review');
        INSERT INTO invoices (id, business_id, document_id, supplier, invoice_number, invoice_date, total, currency_id, confidence_data, review_state)
        VALUES ('${id}', '${business.id}', 'document-${id}', 'Acme Ltd', 'INV-${id}', '2026-08-11', 120.00, 'gbp-${name}', '${confidence}', 'needs_review');
      `);
      await context.invoiceCodingRepository.replace(business.id, id as InvoiceId, coding.map(([headingId, amount]) => ({ headingId, amount })), at);
      return id as InvoiceId;
    };
    return { owner, business, rent, staff, year, bank, card, invoice };
  };
  const a = await seed("a");
  const b = await seed("b");
  const movementsOf = async (businessId: BusinessId, invoiceId: string) => context.moneyRepository.listInvoiceMovements(businessId, invoiceId);
  return { ...database, context, dependencies, a, b, movementsOf };
}

describe("PostgreSQL invoice payments", () => {
  it("keeps the payment columns consistent and the paying account in the invoice's own business", async () => {
    const { close, db, a, b } = await setup();
    try {
      const id = await a.invoice("constraints");
      const row = await db.select().from(invoices).where(eq(invoices.id, id));
      expect(row[0]).toMatchObject({ kind: "invoice", paymentStatus: null, paidAccountId: null, paidOn: null, amountDebited: null, voidedAt: null });
      const set = (values: Partial<typeof invoices.$inferInsert>) => db.update(invoices).set(values).where(eq(invoices.id, id));

      await expect(set({ kind: "refund" })).rejects.toThrow();
      await expect(set({ paymentStatus: "later" })).rejects.toThrow();
      await expect(set({ paymentStatus: "paid" })).rejects.toThrow();
      await expect(set({ paymentStatus: "paid", paidAccountId: a.bank.id, paidOn: "2026-08-12" })).rejects.toThrow();
      await expect(set({ paymentStatus: "unpaid", paidAccountId: a.bank.id })).rejects.toThrow();
      await expect(set({ paidOn: "2026-08-12" })).rejects.toThrow();
      await expect(set({ paymentStatus: "paid", paidAccountId: a.bank.id, paidOn: "2026-08-12", amountDebited: "0.00" })).rejects.toThrow();
      // An account of business B can never pay an invoice of business A.
      await expect(set({ paymentStatus: "paid", paidAccountId: b.bank.id, paidOn: "2026-08-12", amountDebited: "120.00" })).rejects.toThrow();

      await set({ kind: "credit_note", paymentStatus: "paid", paidAccountId: a.bank.id, paidOn: "2026-08-12", amountDebited: "120.00" });
      await set({ paymentStatus: "paid_privately", paidAccountId: null, paidOn: null, amountDebited: null, voidedAt: new Date(at) });
      expect((await db.select().from(invoices).where(eq(invoices.id, id)))[0]).toMatchObject({ kind: "credit_note", paymentStatus: "paid_privately", voidedAt: new Date(at) });
    } finally {
      await close();
    }
  }, 120_000);

  it("approves, changes the payment and voids in single transactions, never leaving duplicates", async () => {
    const { close, context, dependencies, a, b, movementsOf } = await setup();
    try {
      const id = await a.invoice("flow", [[a.rent.id, "100.00"], [a.staff.id, "20.00"]]);
      const approved = await approveInvoice(id, a.owner, dependencies, { status: "paid", accountId: a.bank.id, paidOn: "2026-08-12", amountDebited: "100.00" });
      expect(approved).toMatchObject({ reviewState: "approved", kind: "invoice", paymentStatus: "paid", paidAccountId: a.bank.id, paidOn: "2026-08-12", amountDebited: "100.00", voidedAt: null });
      expect((await movementsOf(a.business.id, id)).map((movement) => [movement.headingId, movement.amount, movement.narrative])).toEqual([[a.rent.id, "-83.34", "Acme Ltd INV-flow"], [a.staff.id, "-16.66", "Acme Ltd INV-flow"]]);
      await expect(getInvoiceReview(id, a.owner, dependencies)).resolves.toMatchObject({ payment: { status: "paid", accountId: a.bank.id, paidOn: "2026-08-12", amountDebited: "100.00" } });

      await changeInvoicePayment(id, a.owner, { status: "paid", accountId: a.card.id, paidOn: "2026-09-01", amountDebited: "120.00" }, dependencies);
      expect((await movementsOf(a.business.id, id)).map((movement) => [movement.moneyAccountId, movement.amount])).toEqual([[a.card.id, "-100.00"], [a.card.id, "-20.00"]]);
      await expect(changeInvoicePayment(id, a.owner, { status: "paid", accountId: b.bank.id, paidOn: "2026-09-01", amountDebited: "120.00" }, dependencies)).rejects.toMatchObject({ code: "MONEY_ACCOUNT_NOT_FOUND" });
      await expect(changeInvoicePayment(id, a.owner, { status: "paid", accountId: a.bank.id, paidOn: "2028-01-01", amountDebited: "120.00" }, dependencies)).rejects.toMatchObject({ code: "MOVEMENT_OUTSIDE_OPEN_YEAR" });
      expect((await movementsOf(a.business.id, id)).map((movement) => movement.moneyAccountId)).toEqual([a.card.id, a.card.id]);
      expect(await context.invoiceRepository.findById(id)).toMatchObject({ paidAccountId: a.card.id, paidOn: "2026-09-01" });

      await changeInvoicePayment(id, a.owner, { status: "unpaid" }, dependencies);
      expect(await movementsOf(a.business.id, id)).toEqual([]);
      await expect(listUnpaidInvoices(a.business.id, a.owner, dependencies)).resolves.toEqual([{ id, supplier: "Acme Ltd", invoiceNumber: "INV-flow", invoiceDate: "2026-08-11", total: "120.00", currency: "GBP" }]);
      await expect(listUnpaidInvoices(b.business.id, a.owner, dependencies)).rejects.toMatchObject({ code: "BUSINESS_ACCESS_DENIED" });

      await voidInvoice(id, a.owner, dependencies);
      await expect(listUnpaidInvoices(a.business.id, a.owner, dependencies)).resolves.toEqual([]);
      await expect(listPrivatelyPaidInvoices(a.business.id, a.owner, dependencies)).resolves.toEqual([]);
      const events = (await context.tenancyRepository.listAuditEvents(a.business.id)).filter((event) => event.entityId === id).map((event) => event.type);
      expect(events).toEqual(["invoice_approved", "invoice_payment_changed", "invoice_payment_changed", "invoice_voided"]);
    } finally {
      await close();
    }
  }, 180_000);

  it("rolls the whole approval back when the movement is refused", async () => {
    const { close, context, dependencies, a, movementsOf } = await setup();
    try {
      const id = await a.invoice("refused");
      await expect(approveInvoice(id, a.owner, dependencies, { status: "paid", accountId: a.bank.id, paidOn: "2026-01-01", amountDebited: "120.00" })).rejects.toMatchObject({ code: "MOVEMENT_OUTSIDE_OPEN_YEAR" });
      expect(await context.invoiceRepository.findById(id)).toMatchObject({ reviewState: "needs_review", paymentStatus: null });
      await expect(context.documentRepository.getStatus(`document-${id}` as never)).resolves.toBe("needs_review");
      expect(await movementsOf(a.business.id, id)).toEqual([]);
      expect((await context.tenancyRepository.listAuditEvents(a.business.id)).filter((event) => event.entityId === id)).toEqual([]);
    } finally {
      await close();
    }
  }, 120_000);
});
