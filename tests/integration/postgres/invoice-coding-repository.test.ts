import { describe, expect, it } from "vitest";

import { createTestDatabase } from "../../../src/db/test-database";
import { invoiceCodings } from "../../../src/db/schema";
import type { AuthIdentity } from "../../../src/modules/auth/auth-provider";
import { importHeadings, listHeadings, type TemplateHeadingInput } from "../../../src/modules/accounting/heading-service";
import { getInvoiceReview, updateInvoiceDraft } from "../../../src/modules/invoices/invoice-review-service";
import { approveInvoice, getInvoiceCoding, type InvoiceDependencies } from "../../../src/modules/invoices/invoice-service";
import type { InvoiceId } from "../../../src/modules/invoices/ocr-provider";
import { createPersistenceContext } from "../../../src/modules/persistence/repository-factory";
import { createApprovedBusiness } from "../../helpers/business-fixtures";

function identity(name: string): AuthIdentity {
  return { providerUserId: `coding-${name}`, email: `coding-${name}@example.com`, displayName: `Coding ${name}`, emailVerified: true };
}

const headingInputs: TemplateHeadingInput[] = [
  { position: 1, templateValue: "Sales", valueType: "text", group: "income", order: 1, blockedReason: null },
  { position: 2, templateValue: "Rent", valueType: "text", group: "expenses", order: 2, blockedReason: null },
  { position: 3, templateValue: "Phone", valueType: "text", group: "expenses", order: 3, blockedReason: "total_read_twice" },
];
const confidence = JSON.stringify(Object.fromEntries(["supplier", "invoiceNumber", "invoiceDate", "dueDate", "subtotal", "taxAmount", "total", "currencyReference", "expenseCategoryReference", "notes"].map((field) => [field, 1])));

async function setup() {
  const database = await createTestDatabase();
  const context = createPersistenceContext({ mode: "postgres", database: database.db });
  const dependencies: InvoiceDependencies = {
    tenancyRepository: context.tenancyRepository,
    documentRepository: context.documentRepository,
    invoices: context.invoiceRepository,
    codings: context.invoiceCodingRepository,
    headings: context.headingRepository,
    transaction: context.transaction,
  };
  const seed = async (name: string) => {
    const owner = identity(name);
    const business = await createApprovedBusiness(context.tenancyRepository, `Coding Books ${name}`, owner);
    const ownerId = await context.tenancyRepository.upsertUser(owner);
    await importHeadings(business.id, headingInputs, owner, { tenancyRepository: context.tenancyRepository, headings: context.headingRepository });
    const [sales, rent, phone] = await listHeadings(business.id, owner, { tenancyRepository: context.tenancyRepository, headings: context.headingRepository });
    await database.execute(`INSERT INTO currencies (id, business_id, name, iso_code, symbol, decimal_count, is_standard, is_active) VALUES ('gbp-${name}', '${business.id}', 'Pound', 'GBP', 'GBP', 2, true, true);`);
    const invoice = async (id: string, supplier: string | null, total: string | null, updatedAt = "2026-08-12T10:00:00.000Z") => {
      await database.execute(`
        INSERT INTO documents (id, business_id, uploader_id, private_object_key, original_file_name, original_mime_type, original_size_bytes, status)
        VALUES ('document-${id}', '${business.id}', '${ownerId}', 'key-${id}', 'invoice.pdf', 'application/pdf', 10, 'needs_review');
        INSERT INTO invoices (id, business_id, document_id, supplier, invoice_number, invoice_date, total, currency_id, confidence_data, review_state, updated_at)
        VALUES ('${id}', '${business.id}', 'document-${id}', ${supplier === null ? "NULL" : `'${supplier}'`}, '${id}', '2026-08-11', ${total === null ? "NULL" : total}, 'gbp-${name}', '${confidence}', 'needs_review', '${updatedAt}');
      `);
      return id as InvoiceId;
    };
    return { owner, ownerId, business, sales, rent, phone, invoice };
  };
  const a = await seed("a");
  const b = await seed("b");
  return { ...database, context, dependencies, a, b };
}

describe("PostgreSQL invoice codings", () => {
  it("replaces lines in order with exact amounts and clears them", async () => {
    const { close, context, a } = await setup();
    try {
      const invoiceId = await a.invoice("invoice-order", "Acme", "120.00");
      const repository = context.invoiceCodingRepository;
      await expect(repository.replace(a.business.id, invoiceId, [{ headingId: a.rent.id, amount: "100.10" }, { headingId: a.sales.id, amount: "19.90" }], "2026-08-12T11:00:00.000Z"))
        .resolves.toEqual([{ headingId: a.rent.id, amount: "100.10" }, { headingId: a.sales.id, amount: "19.90" }]);
      await repository.replace(a.business.id, invoiceId, [{ headingId: a.sales.id, amount: "0.01" }, { headingId: a.rent.id, amount: "119.99" }], "2026-08-12T11:01:00.000Z");
      await expect(repository.list(a.business.id, invoiceId)).resolves.toEqual([{ headingId: a.sales.id, amount: "0.01" }, { headingId: a.rent.id, amount: "119.99" }]);
      await expect(repository.list(a.business.id, "missing" as InvoiceId)).resolves.toEqual([]);
      await repository.replace(a.business.id, invoiceId, [], "2026-08-12T11:02:00.000Z");
      await expect(repository.list(a.business.id, invoiceId)).resolves.toEqual([]);
    } finally {
      await close();
    }
  }, 60_000);

  it("enforces positive amounts, one line per position and heading, and same-tenant keys", async () => {
    const { close, db, context, a, b } = await setup();
    try {
      const invoiceId = await a.invoice("invoice-constraints", "Acme", "120.00");
      const row = { businessId: a.business.id, invoiceId, headingId: a.rent.id, amount: "120.00", sortOrder: 0 };
      await expect(db.insert(invoiceCodings).values({ ...row, id: "zero", amount: "0.00" })).rejects.toThrow();
      await expect(db.insert(invoiceCodings).values({ ...row, id: "negative", amount: "-1.00" })).rejects.toThrow();
      await db.insert(invoiceCodings).values({ ...row, id: "first" });
      await expect(db.insert(invoiceCodings).values({ ...row, id: "same-position", headingId: a.sales.id })).rejects.toThrow();
      await expect(db.insert(invoiceCodings).values({ ...row, id: "same-heading", sortOrder: 1 })).rejects.toThrow();
      // A heading of business B on an invoice of business A, and an invoice of A filed under B.
      await expect(db.insert(invoiceCodings).values({ ...row, id: "foreign-heading", headingId: b.rent.id, sortOrder: 2 })).rejects.toThrow();
      await expect(db.insert(invoiceCodings).values({ ...row, id: "foreign-invoice", businessId: b.business.id, headingId: b.rent.id, sortOrder: 3 })).rejects.toThrow();
      await expect(context.invoiceCodingRepository.replace(a.business.id, invoiceId, [{ headingId: b.rent.id, amount: "120.00" }], "2026-08-12T11:00:00.000Z"))
        .rejects.toMatchObject({ code: "INVOICE_REPOSITORY_CONFLICT" });
      await expect(context.invoiceCodingRepository.list(a.business.id, invoiceId)).resolves.toEqual([{ headingId: a.rent.id, amount: "120.00" }]);
      await expect(context.invoiceCodingRepository.list(b.business.id, invoiceId)).resolves.toEqual([]);
    } finally {
      await close();
    }
  }, 60_000);

  it("saves fields and coding atomically through the service and enforces the rules on PostgreSQL", async () => {
    const { close, context, dependencies, a, b } = await setup();
    try {
      const invoiceId = await a.invoice("invoice-service", "Acme", "120.00");
      const save = (input: Omit<Parameters<typeof updateInvoiceDraft>[0], "invoiceId">) => updateInvoiceDraft({ invoiceId, ...input }, a.owner, dependencies);

      await expect(approveInvoice(invoiceId, a.owner, dependencies)).rejects.toMatchObject({ code: "CODING_REQUIRED" });
      await expect(save({ coding: [{ headingId: a.phone.id, amount: "120.00" }] })).rejects.toMatchObject({ code: "HEADING_NOT_USABLE" });
      await expect(save({ coding: [{ headingId: b.rent.id, amount: "120.00" }] })).rejects.toMatchObject({ code: "HEADING_NOT_FOUND" });
      await expect(save({ fields: { notes: "Lost" }, coding: [{ headingId: a.rent.id, amount: "100.00" }] })).rejects.toMatchObject({ code: "CODING_TOTAL_MISMATCH" });
      expect((await context.invoiceRepository.findById(invoiceId))?.notes).toBeNull();

      await save({ fields: { notes: "Split" }, coding: [{ headingId: a.rent.id, amount: "100.00" }, { headingId: a.sales.id, amount: "20" }] });
      await expect(getInvoiceCoding(invoiceId, a.owner, dependencies)).resolves.toEqual([{ headingId: a.rent.id, amount: "100.00" }, { headingId: a.sales.id, amount: "20.00" }]);
      await expect(save({ fields: { total: "130.00" } })).rejects.toMatchObject({ code: "CODING_TOTAL_MISMATCH" });

      await save({ coding: [{ headingId: a.rent.id, amount: "120.00" }] });
      await save({ fields: { total: "75.25" } });
      await expect(getInvoiceCoding(invoiceId, a.owner, dependencies)).resolves.toEqual([{ headingId: a.rent.id, amount: "75.25" }]);

      await expect(approveInvoice(invoiceId, a.owner, dependencies)).resolves.toMatchObject({ reviewState: "approved" });
      await expect(save({ coding: [] })).rejects.toMatchObject({ code: "INVALID_INVOICE_STATE" });
      await expect(getInvoiceCoding(invoiceId, a.owner, dependencies)).resolves.toEqual([{ headingId: a.rent.id, amount: "75.25" }]);
    } finally {
      await close();
    }
  }, 120_000);

  it("suggests the heading of the latest other single-line invoice of the same supplier and business only", async () => {
    const { close, context, dependencies, a, b } = await setup();
    try {
      const repository = context.invoiceCodingRepository;
      const current = await a.invoice("current", "Acme Ltd", "10.00", "2026-08-20T10:00:00.000Z");
      const older = await a.invoice("older", " ACME LTD ", "10.00", "2026-08-01T10:00:00.000Z");
      const newer = await a.invoice("newer", "acme ltd", "10.00", "2026-08-05T10:00:00.000Z");
      const split = await a.invoice("split", "Acme Ltd", "10.00", "2026-08-10T10:00:00.000Z");
      const otherSupplier = await a.invoice("other-supplier", "Acme Holdings", "10.00", "2026-08-15T10:00:00.000Z");
      const elsewhere = await b.invoice("elsewhere", "Acme Ltd", "10.00", "2026-08-19T10:00:00.000Z");
      await repository.replace(a.business.id, older, [{ headingId: a.sales.id, amount: "10.00" }], "2026-08-01T10:00:00.000Z");
      await repository.replace(a.business.id, newer, [{ headingId: a.rent.id, amount: "10.00" }], "2026-08-05T10:00:00.000Z");
      await repository.replace(a.business.id, split, [{ headingId: a.sales.id, amount: "5.00" }, { headingId: a.rent.id, amount: "5.00" }], "2026-08-10T10:00:00.000Z");
      await repository.replace(a.business.id, otherSupplier, [{ headingId: a.sales.id, amount: "10.00" }], "2026-08-15T10:00:00.000Z");
      await repository.replace(b.business.id, elsewhere, [{ headingId: b.sales.id, amount: "10.00" }], "2026-08-19T10:00:00.000Z");

      await expect(repository.findSupplierHeadingId(a.business.id, "acme ltd", current)).resolves.toBe(a.rent.id);
      await expect(repository.findSupplierHeadingId(a.business.id, "acme ltd", newer)).resolves.toBe(a.sales.id);
      await expect(repository.findSupplierHeadingId(a.business.id, "nobody", current)).resolves.toBeNull();
      await expect(repository.findSupplierHeadingId(b.business.id, "acme ltd", elsewhere)).resolves.toBeNull();
      await expect(getInvoiceReview(current, a.owner, dependencies)).resolves.toMatchObject({ coding: [], suggestedHeadingId: a.rent.id });
    } finally {
      await close();
    }
  }, 60_000);
});
