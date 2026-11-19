import { beforeEach, describe, expect, it } from "vitest";

import { createHeadingRepository, type AccountHeading, type HeadingRepository } from "../../../src/modules/accounting/heading-service";
import { createMoneyRepository, type FinancialYear, type InMemoryMoneyRepository, type MoneyAccount } from "../../../src/modules/accounting/money-repository";
import { listMovements } from "../../../src/modules/accounting/money-service";
import { createDocumentRepository, type Document } from "../../../src/modules/documents/document-service";
import { createInvoiceCodingRepository, type InvoiceCodingRepository } from "../../../src/modules/invoices/invoice-coding-repository";
import { changeInvoicePayment, listPrivatelyPaidInvoices, listUnpaidInvoices, voidInvoice } from "../../../src/modules/invoices/invoice-payment-service";
import { getInvoiceReview, updateInvoiceDraft } from "../../../src/modules/invoices/invoice-review-service";
import { approveInvoice, createInvoiceRepository, type InMemoryInvoiceRepository, type Invoice, type InvoiceDependencies } from "../../../src/modules/invoices/invoice-service";
import type { DocumentId, InvoiceId } from "../../../src/modules/invoices/ocr-provider";
import { createInMemoryOnboardingRepository, type MemoryOnboardingRepository } from "../../../src/modules/tenancy/business-service";
import type { BusinessId, UserId } from "../../../src/modules/tenancy/types";
import { createApprovedBusiness } from "../../helpers/business-fixtures";

const owner = "payment-owner" as UserId;
const confident = { supplier: 1, invoiceNumber: 1, invoiceDate: 1, dueDate: 1, subtotal: 1, taxAmount: 1, total: 1, currencyReference: 1, expenseCategoryReference: 1, notes: 1 };
const now = "2026-01-01T00:00:00.000Z";

function heading(id: string, businessId: BusinessId, position: number, overrides: Partial<AccountHeading> = {}): AccountHeading {
  return { id, businessId, position, templateValue: id, valueType: "text", group: "expenses", sortOrder: position, displayName: id, isActive: true, blockedReason: null, createdAt: now, updatedAt: now, ...overrides };
}

function account(id: string, businessId: BusinessId, overrides: Partial<MoneyAccount> = {}): MoneyAccount {
  return { id, businessId, name: id, kind: "bank", sheetName: id, isActive: true, createdAt: now, updatedAt: now, ...overrides };
}

describe("paying an approved invoice", () => {
  let tenancy: MemoryOnboardingRepository;
  let documents: ReturnType<typeof createDocumentRepository>;
  let invoices: InMemoryInvoiceRepository;
  let headings: HeadingRepository;
  let codings: InvoiceCodingRepository;
  let money: InMemoryMoneyRepository;
  let businessId: BusinessId;
  let otherBusinessId: BusinessId;
  let year: FinancialYear;
  let dependencies: InvoiceDependencies;

  const paid = (overrides: Record<string, string> = {}) => ({ status: "paid" as const, accountId: "bank", paidOn: "2026-08-12", amountDebited: "120.00", ...overrides });
  const movementsOf = async (invoiceId: string) => (await listMovements(businessId, { yearId: year.id }, owner, { tenancyRepository: tenancy, money, headings })).filter((movement) => movement.sourceInvoiceId === invoiceId);

  async function seed(id: string, overrides: Partial<Invoice> = {}, coding = [{ headingId: "rent", amount: "120.00" }]): Promise<Invoice> {
    const document: Document = {
      id: `document-${id}`, businessId: overrides.businessId ?? businessId, uploaderId: owner, privateObjectKey: `private/${id}`, originalFileName: `${id}.pdf`,
      originalMimeType: "application/pdf", originalSizeBytes: 4, checksum: `checksum-${id}`, status: "needs_review", createdAt: now,
    };
    await documents.create(document);
    const invoice = await invoices.create({
      id: id as InvoiceId, businessId, documentId: document.id as DocumentId, supplier: "Acme Ltd", invoiceNumber: `INV-${id}`, invoiceDate: "2026-08-11",
      dueDate: null, subtotal: "100.00", taxAmount: "20.00", total: "120.00", currencyReference: "GBP", expenseCategoryReference: null, notes: null,
      confidenceData: { ...confident }, reviewState: "needs_review", createdAt: now, updatedAt: now, ...overrides,
    });
    await codings.replace(invoice.businessId, invoice.id, coding, now);
    return invoice;
  }

  beforeEach(async () => {
    tenancy = createInMemoryOnboardingRepository();
    documents = createDocumentRepository();
    invoices = createInvoiceRepository();
    headings = createHeadingRepository();
    codings = createInvoiceCodingRepository(invoices);
    money = createMoneyRepository();
    businessId = (await createApprovedBusiness(tenancy, "Payment Books", owner)).id;
    otherBusinessId = (await createApprovedBusiness(tenancy, "Other Payment Books", "other-owner" as UserId)).id;
    await headings.create(heading("rent", businessId, 1));
    await headings.create(heading("staff", businessId, 2));
    year = await money.createYear({ id: "year", businessId, startDate: "2026-04-06", endDate: "2027-04-05", status: "open", createdAt: now, updatedAt: now });
    await money.createAccount(account("bank", businessId));
    await money.createAccount(account("card", businessId));
    await money.createAccount(account("old", businessId, { isActive: false }));
    await money.createYear({ id: "other-year", businessId: otherBusinessId, startDate: "2026-04-06", endDate: "2027-04-05", status: "open", createdAt: now, updatedAt: now });
    await money.createAccount(account("other-bank", otherBusinessId));
    dependencies = { tenancyRepository: tenancy, documentRepository: documents, invoices, headings, codings, money };
  });

  describe("approval", () => {
    it("requires a payment answer, after the existing rules, and writes nothing without one", async () => {
      const uncoded = await seed("uncoded", {}, []);
      await expect(approveInvoice(uncoded.id, owner, dependencies)).rejects.toMatchObject({ code: "CODING_REQUIRED" });

      const invoice = await seed("no-payment");
      await expect(approveInvoice(invoice.id, owner, dependencies)).rejects.toMatchObject({ code: "PAYMENT_REQUIRED" });
      await expect(approveInvoice(invoice.id, owner, dependencies, null)).rejects.toMatchObject({ code: "PAYMENT_REQUIRED" });
      expect(await invoices.findById(invoice.id)).toMatchObject({ reviewState: "needs_review" });
      expect(tenancy.auditEvents.filter((event) => event.entityId === invoice.id)).toEqual([]);
    });

    it.each([
      ["an unknown status", { status: "later" }],
      ["paid without an account", { status: "paid", paidOn: "2026-08-12", amountDebited: "120.00" }],
      ["paid without a date", { status: "paid", accountId: "bank", amountDebited: "120.00" }],
      ["an impossible date", { status: "paid", accountId: "bank", paidOn: "2026-02-30", amountDebited: "120.00" }],
      ["a zero amount", { status: "paid", accountId: "bank", paidOn: "2026-08-12", amountDebited: "0.00" }],
      ["a negative amount", { status: "paid", accountId: "bank", paidOn: "2026-08-12", amountDebited: "-120.00" }],
      ["three decimals", { status: "paid", accountId: "bank", paidOn: "2026-08-12", amountDebited: "120.001" }],
      ["a number instead of text", { status: "paid", accountId: "bank", paidOn: "2026-08-12", amountDebited: 120 }],
    ])("rejects %s", async (_label, payment) => {
      const invoice = await seed("invalid-payment");
      await expect(approveInvoice(invoice.id, owner, dependencies, payment)).rejects.toMatchObject({ code: "INVALID_PAYMENT" });
      expect(await invoices.findById(invoice.id)).toMatchObject({ reviewState: "needs_review" });
    });

    it("paid: creates one negative movement per coding line with the supplier and number, the code, the account and the date", async () => {
      const invoice = await seed("paid", { supplier: " Acme Ltd ", invoiceNumber: "INV-42" });

      const approved = await approveInvoice(invoice.id, owner, dependencies, paid({ amountDebited: "120" }));

      expect(approved).toMatchObject({ reviewState: "approved", kind: "invoice", paymentStatus: "paid", paidAccountId: "bank", paidOn: "2026-08-12", amountDebited: "120.00", voidedAt: null });
      expect(await movementsOf(invoice.id)).toMatchObject([{ moneyAccountId: "bank", movementDate: "2026-08-12", narrative: "Acme Ltd INV-42", headingId: "rent", amount: "-120.00", origin: "invoice", financialYearId: year.id }]);
      expect(tenancy.auditEvents).toContainEqual(expect.objectContaining({ type: "invoice_approved", entityId: invoice.id, metadata: { paymentStatus: "paid", moneyAccountId: "bank" } }));
    });

    it("paid: a split keeps each line's amount when the debit equals the total", async () => {
      const invoice = await seed("split", {}, [{ headingId: "rent", amount: "100.00" }, { headingId: "staff", amount: "20.00" }]);
      await approveInvoice(invoice.id, owner, dependencies, paid());
      expect((await movementsOf(invoice.id)).map((movement) => [movement.headingId, movement.amount])).toEqual([["rent", "-100.00"], ["staff", "-20.00"]]);
    });

    it("paid: a different debit is shared in proportion with the leftover pence on the largest line", async () => {
      const invoice = await seed("foreign", { currencyReference: "EUR" }, [{ headingId: "rent", amount: "100.00" }, { headingId: "staff", amount: "20.00" }]);
      await approveInvoice(invoice.id, owner, dependencies, paid({ amountDebited: "100.00" }));
      expect((await movementsOf(invoice.id)).map((movement) => [movement.headingId, movement.amount])).toEqual([["rent", "-83.34"], ["staff", "-16.66"]]);
    });

    it("paid: a credit note enters positive", async () => {
      const invoice = await seed("credit");
      await updateInvoiceDraft({ invoiceId: invoice.id, fields: { kind: "credit_note" } }, owner, dependencies);
      await approveInvoice(invoice.id, owner, dependencies, paid({ amountDebited: "120.00" }));
      expect((await movementsOf(invoice.id)).map((movement) => movement.amount)).toEqual(["120.00"]);
    });

    it.each([
      ["a date outside the open financial year", paid({ paidOn: "2026-01-01" }), "MOVEMENT_OUTSIDE_OPEN_YEAR"],
      ["an inactive account", paid({ accountId: "old" }), "MONEY_ACCOUNT_INACTIVE"],
      ["an unknown account", paid({ accountId: "missing" }), "MONEY_ACCOUNT_NOT_FOUND"],
      ["an account of another business", paid({ accountId: "other-bank" }), "MONEY_ACCOUNT_NOT_FOUND"],
    ])("fails as a whole with %s", async (_label, payment, code) => {
      const invoice = await seed("refused");
      await expect(approveInvoice(invoice.id, owner, dependencies, payment)).rejects.toMatchObject({ code });
      expect(await invoices.findById(invoice.id)).toMatchObject({ reviewState: "needs_review" });
      expect((await invoices.findById(invoice.id))?.paymentStatus).toBeUndefined();
      await expect(documents.getStatus(invoice.documentId)).resolves.toBe("needs_review");
      expect(await movementsOf(invoice.id)).toEqual([]);
      expect(tenancy.auditEvents.filter((event) => event.entityId === invoice.id)).toEqual([]);
      expect([...money.movements.values()]).toEqual([]);
    });

    it("fails as a whole when a coded heading can no longer be used", async () => {
      const invoice = await seed("blocked-heading");
      await headings.update({ ...(await headings.findById("rent", businessId))!, isActive: false }, businessId);
      await expect(approveInvoice(invoice.id, owner, dependencies, paid())).rejects.toMatchObject({ code: "HEADING_NOT_USABLE" });
      expect(await invoices.findById(invoice.id)).toMatchObject({ reviewState: "needs_review" });
    });

    it("unpaid and paid privately create no movement and fill the year-end lists", async () => {
      const unpaid = await seed("unpaid", { supplier: "Builder Ltd", invoiceNumber: "B-1" });
      const privately = await seed("private");
      const draft = await seed("draft");
      await approveInvoice(unpaid.id, owner, dependencies, { status: "unpaid" });
      await approveInvoice(privately.id, owner, dependencies, { status: "paid_privately" });

      expect([...money.movements.values()]).toEqual([]);
      await expect(listUnpaidInvoices(businessId, owner, dependencies)).resolves.toEqual([{ id: unpaid.id, supplier: "Builder Ltd", invoiceNumber: "B-1", invoiceDate: "2026-08-11", total: "120.00", currency: "GBP" }]);
      await expect(listPrivatelyPaidInvoices(businessId, owner, dependencies)).resolves.toEqual([{ id: privately.id, supplier: "Acme Ltd", invoiceNumber: "INV-private", invoiceDate: "2026-08-11", total: "120.00", currency: "GBP" }]);
      expect((await listUnpaidInvoices(businessId, owner, dependencies)).map((item) => item.id)).not.toContain(draft.id);
    });

    it("returns the kind, the payment and the void state with the review", async () => {
      const invoice = await seed("review");
      await expect(getInvoiceReview(invoice.id, owner, dependencies)).resolves.toMatchObject({ kind: "invoice", payment: { status: null, accountId: null, paidOn: null, amountDebited: null }, voidedAt: null });
      await approveInvoice(invoice.id, owner, dependencies, paid({ amountDebited: "119.5" }));
      await expect(getInvoiceReview(invoice.id, owner, dependencies)).resolves.toMatchObject({ kind: "invoice", payment: { status: "paid", accountId: "bank", paidOn: "2026-08-12", amountDebited: "119.50" }, voidedAt: null });
    });
  });

  describe("kind", () => {
    it("is chosen while the invoice is a draft, and only from the two kinds", async () => {
      const invoice = await seed("kind");
      await expect(updateInvoiceDraft({ invoiceId: invoice.id, fields: { kind: "credit_note" } }, owner, dependencies)).resolves.toMatchObject({ kind: "credit_note", confidenceData: confident });
      await expect(updateInvoiceDraft({ invoiceId: invoice.id, fields: { kind: "refund" as never } }, owner, dependencies)).rejects.toMatchObject({ code: "INVALID_INVOICE" });
      await expect(updateInvoiceDraft({ invoiceId: invoice.id, fields: { notes: "kept" } }, owner, dependencies)).resolves.toMatchObject({ kind: "credit_note", notes: "kept" });
      await approveInvoice(invoice.id, owner, dependencies, { status: "unpaid" });
      await expect(updateInvoiceDraft({ invoiceId: invoice.id, fields: { kind: "invoice" } }, owner, dependencies)).rejects.toMatchObject({ code: "INVALID_INVOICE_STATE" });
    });
  });

  describe("changing the payment", () => {
    it("replaces or removes the movements on every transition and never leaves duplicates", async () => {
      const invoice = await seed("transitions", {}, [{ headingId: "rent", amount: "100.00" }, { headingId: "staff", amount: "20.00" }]);
      await approveInvoice(invoice.id, owner, dependencies, { status: "unpaid" });
      expect(await movementsOf(invoice.id)).toHaveLength(0);

      await expect(changeInvoicePayment(invoice.id, owner, paid(), dependencies)).resolves.toMatchObject({ paymentStatus: "paid", paidAccountId: "bank" });
      expect((await movementsOf(invoice.id)).map((movement) => [movement.moneyAccountId, movement.movementDate, movement.amount])).toEqual([["bank", "2026-08-12", "-100.00"], ["bank", "2026-08-12", "-20.00"]]);

      await changeInvoicePayment(invoice.id, owner, paid({ accountId: "card", paidOn: "2026-09-01", amountDebited: "121.00" }), dependencies);
      expect((await movementsOf(invoice.id)).map((movement) => [movement.moneyAccountId, movement.movementDate, movement.amount])).toEqual([["card", "2026-09-01", "-100.84"], ["card", "2026-09-01", "-20.16"]]);

      await expect(changeInvoicePayment(invoice.id, owner, { status: "unpaid" }, dependencies)).resolves.toMatchObject({ paymentStatus: "unpaid", paidAccountId: null, paidOn: null, amountDebited: null });
      expect(await movementsOf(invoice.id)).toHaveLength(0);

      await changeInvoicePayment(invoice.id, owner, paid(), dependencies);
      expect(await movementsOf(invoice.id)).toHaveLength(2);
      await changeInvoicePayment(invoice.id, owner, { status: "paid_privately" }, dependencies);
      expect(await movementsOf(invoice.id)).toHaveLength(0);
      expect(await invoices.findById(invoice.id)).toMatchObject({ reviewState: "approved", paymentStatus: "paid_privately" });
      expect(tenancy.auditEvents.filter((event) => event.type === "invoice_payment_changed" && event.entityId === invoice.id)).toHaveLength(5);
    });

    it("needs an approved invoice and a valid payment, and writes nothing when refused", async () => {
      const draft = await seed("draft-change");
      await expect(changeInvoicePayment(draft.id, owner, paid(), dependencies)).rejects.toMatchObject({ code: "INVALID_INVOICE_STATE" });
      const invoice = await seed("change-invalid");
      await approveInvoice(invoice.id, owner, dependencies, paid());
      await expect(changeInvoicePayment(invoice.id, owner, undefined, dependencies)).rejects.toMatchObject({ code: "PAYMENT_REQUIRED" });
      await expect(changeInvoicePayment(invoice.id, owner, paid({ amountDebited: "0" }), dependencies)).rejects.toMatchObject({ code: "INVALID_PAYMENT" });
      await expect(changeInvoicePayment(invoice.id, owner, paid({ accountId: "old" }), dependencies)).rejects.toMatchObject({ code: "MONEY_ACCOUNT_INACTIVE" });
      expect((await movementsOf(invoice.id)).map((movement) => movement.moneyAccountId)).toEqual(["bank"]);
      expect(await invoices.findById(invoice.id)).toMatchObject({ paymentStatus: "paid", paidAccountId: "bank" });
    });

    it("refuses to touch movements of a closed year", async () => {
      const invoice = await seed("closed");
      await approveInvoice(invoice.id, owner, dependencies, paid());
      await money.updateYear({ ...year, status: "closed" }, businessId);

      await expect(changeInvoicePayment(invoice.id, owner, { status: "unpaid" }, dependencies)).rejects.toMatchObject({ code: "FINANCIAL_YEAR_CLOSED" });
      await expect(voidInvoice(invoice.id, owner, dependencies)).rejects.toMatchObject({ code: "FINANCIAL_YEAR_CLOSED" });
      expect(await invoices.findById(invoice.id)).toMatchObject({ paymentStatus: "paid", voidedAt: null });
      expect([...money.movements.values()].filter((movement) => movement.deletedAt === null)).toHaveLength(1);
    });
  });

  describe("voiding", () => {
    it("removes the movements, is idempotent, audits once and leaves the invoice read-only for good", async () => {
      const invoice = await seed("void");
      await approveInvoice(invoice.id, owner, dependencies, paid());
      expect(await movementsOf(invoice.id)).toHaveLength(1);

      const voided = await voidInvoice(invoice.id, owner, dependencies);
      expect(voided.voidedAt).toEqual(expect.any(String));
      expect(await movementsOf(invoice.id)).toHaveLength(0);
      await expect(voidInvoice(invoice.id, owner, dependencies)).resolves.toMatchObject({ voidedAt: voided.voidedAt });
      expect(tenancy.auditEvents.filter((event) => event.type === "invoice_voided" && event.entityId === invoice.id)).toHaveLength(1);

      await expect(changeInvoicePayment(invoice.id, owner, paid(), dependencies)).rejects.toMatchObject({ code: "INVOICE_VOIDED" });
      await expect(updateInvoiceDraft({ invoiceId: invoice.id, fields: { notes: "no" } }, owner, dependencies)).rejects.toMatchObject({ code: "INVALID_INVOICE_STATE" });
      expect(await movementsOf(invoice.id)).toHaveLength(0);
      await expect(getInvoiceReview(invoice.id, owner, dependencies)).resolves.toMatchObject({ voidedAt: voided.voidedAt });
    });

    it("only voids approved invoices", async () => {
      const draft = await seed("void-draft");
      await expect(voidInvoice(draft.id, owner, dependencies)).rejects.toMatchObject({ code: "INVALID_INVOICE_STATE" });
      expect(await invoices.findById(draft.id)).toMatchObject({ reviewState: "needs_review" });
    });

    it("drops a voided invoice from the unpaid list and from supplier suggestions", async () => {
      const unpaid = await seed("void-unpaid");
      await approveInvoice(unpaid.id, owner, dependencies, { status: "unpaid" });
      const next = await seed("next", {}, []);
      await expect(getInvoiceReview(next.id, owner, dependencies)).resolves.toMatchObject({ suggestedHeadingId: "rent" });

      await voidInvoice(unpaid.id, owner, dependencies);
      await expect(listUnpaidInvoices(businessId, owner, dependencies)).resolves.toEqual([]);
      await expect(getInvoiceReview(next.id, owner, dependencies)).resolves.toMatchObject({ suggestedHeadingId: null });
    });
  });
});
