import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { annexCsv } from "../../../src/modules/accounting/annex-csv";
import { buildYearAnnex, downloadYearAnnex } from "../../../src/modules/accounting/annex-service";
import { createHeadingRepository, importHeadings, listHeadings, type TemplateHeadingInput } from "../../../src/modules/accounting/heading-service";
import { MONEY_ERROR_CODES, createMoneyRepository, type Movement } from "../../../src/modules/accounting/money-repository";
import { createInvoiceRepository, type Invoice } from "../../../src/modules/invoices/invoice-service";
import type { DocumentId, InvoiceId } from "../../../src/modules/invoices/ocr-provider";
import { createInMemoryOnboardingRepository } from "../../../src/modules/tenancy/business-service";
import type { UserId } from "../../../src/modules/tenancy/types";
import { createApprovedBusiness } from "../../helpers/business-fixtures";

const owner = "annex-owner" as UserId;
const at = "2026-01-01T00:00:00.000Z";
const confident = { supplier: 1, invoiceNumber: 1, invoiceDate: 1, dueDate: 1, subtotal: 1, taxAmount: 1, total: 1, currencyReference: 1, expenseCategoryReference: 1, notes: 1 };
const headingInputs: TemplateHeadingInput[] = [
  { position: 1, templateValue: "Equipment", valueType: "text", group: "assets", order: 1, blockedReason: null },
  { position: 2, templateValue: "Vehicles", valueType: "text", group: "assets", order: 2, blockedReason: null },
  { position: 3, templateValue: "Rent", valueType: "text", group: "expenses", order: 3, blockedReason: null },
];

async function fixture() {
  const tenancy = createInMemoryOnboardingRepository();
  const business = await createApprovedBusiness(tenancy, "Annex Books", owner);
  const money = createMoneyRepository();
  const headings = createHeadingRepository();
  const invoices = createInvoiceRepository();
  const dependencies = { tenancyRepository: tenancy, money, headings, invoices };
  await importHeadings(business.id, headingInputs, owner, dependencies);
  const stored = await listHeadings(business.id, owner, dependencies);
  const heading = (value: string) => stored.find((h) => h.templateValue === value)!;
  const year = await money.createYear({ id: `${business.id}-year`, businessId: business.id, startDate: "2026-04-06", endDate: "2027-04-05", status: "open", createdAt: at, updatedAt: at });
  const before = await money.createYear({ id: `${business.id}-before`, businessId: business.id, startDate: "2025-04-06", endDate: "2026-04-05", status: "closed", createdAt: at, updatedAt: at });
  const bank = await money.createAccount({ id: `${business.id}-bank`, businessId: business.id, name: "Main bank", kind: "bank", sheetName: "Bank", isActive: true, createdAt: at, updatedAt: at });
  const till = await money.createAccount({ id: `${business.id}-till`, businessId: business.id, name: "Till", kind: "cash", sheetName: "Cash", isActive: true, createdAt: at, updatedAt: at });
  /** Stored as a later task would store it, without the public API's checks. */
  const move = (fields: Partial<Movement> & { amount: string }) => money.createMovement({
    id: randomUUID(), businessId: business.id, financialYearId: year.id, moneyAccountId: bank.id, movementDate: "2026-06-01", narrative: "Row", headingId: heading("Equipment").id,
    origin: "manual", sourceInvoiceId: null, sourceRef: null, transferGroupId: null, deletedAt: null, createdBy: owner, createdAt: at, updatedAt: at, ...fields,
  });
  const invoice = (fields: Partial<Invoice>) => {
    const id = randomUUID();
    return invoices.create({
      id: id as InvoiceId, businessId: business.id, documentId: `doc-${id}` as DocumentId, supplier: "Supplier", invoiceNumber: `INV-${id.slice(0, 4)}`, invoiceDate: "2026-08-11", dueDate: null,
      subtotal: null, taxAmount: null, total: "50.00", currencyReference: "GBP", expenseCategoryReference: null, notes: null, confidenceData: { ...confident },
      reviewState: "approved", paymentStatus: "unpaid", createdAt: at, updatedAt: at, ...fields,
    });
  };
  return { tenancy, business, money, invoices, dependencies, heading, year, before, bank, till, move, invoice };
}

describe("closing annex", () => {
  it("lists invoices unpaid at the year end, including earlier ones and undated ones, and nothing else", async () => {
    const f = await fixture();
    const lastDay = await f.invoice({ supplier: "Last day", invoiceDate: "2027-04-05" });
    await f.invoice({ supplier: "Day after", invoiceDate: "2027-04-06" });
    const earlier = await f.invoice({ supplier: "Older year", invoiceDate: "2025-11-30", total: "7.5" });
    await f.invoice({ supplier: "Voided", voidedAt: at });
    await f.invoice({ supplier: "Draft", reviewState: "needs_review" });
    await f.invoice({ supplier: "Paid", paymentStatus: "paid" });
    await f.invoice({ supplier: "Private", paymentStatus: "paid_privately" });
    const undated = await f.invoice({ supplier: "No date", invoiceDate: null });
    const sameDayB = await f.invoice({ supplier: "Beta", invoiceDate: "2026-08-11" });
    const sameDayA = await f.invoice({ supplier: "Alpha", invoiceDate: "2026-08-11" });

    const annex = await buildYearAnnex(f.business.id, f.year.id, owner, f.dependencies);

    expect(annex.year).toEqual({ id: f.year.id, startDate: "2026-04-06", endDate: "2027-04-05" });
    expect(annex.unpaidInvoices.map((i) => i.id)).toEqual([earlier.id, sameDayA.id, sameDayB.id, lastDay.id, undated.id]);
    expect(annex.unpaidInvoices[0]).toEqual({ id: earlier.id, supplier: "Older year", invoiceNumber: earlier.invoiceNumber, invoiceDate: "2025-11-30", total: "7.50", currency: "GBP", kind: "invoice", undated: false });
    expect(annex.unpaidInvoices.at(-1)).toMatchObject({ invoiceDate: null, undated: true });
    expect(annex.totals.unpaidInvoices).toEqual({ count: 5, byCurrency: [{ currency: "GBP", count: 5, amount: "207.50" }] });
  });

  it("lists invoices paid with private money inside the year only, with undated ones flagged", async () => {
    const f = await fixture();
    const first = await f.invoice({ supplier: "First day", paymentStatus: "paid_privately", invoiceDate: "2026-04-06" });
    const last = await f.invoice({ supplier: "Last day", paymentStatus: "paid_privately", invoiceDate: "2027-04-05" });
    await f.invoice({ supplier: "Day before", paymentStatus: "paid_privately", invoiceDate: "2026-04-05" });
    await f.invoice({ supplier: "Day after", paymentStatus: "paid_privately", invoiceDate: "2027-04-06" });
    await f.invoice({ supplier: "Voided", paymentStatus: "paid_privately", voidedAt: at });
    await f.invoice({ supplier: "Draft", paymentStatus: "paid_privately", reviewState: "needs_review" });
    const undated = await f.invoice({ supplier: "No date", paymentStatus: "paid_privately", invoiceDate: null });

    const annex = await buildYearAnnex(f.business.id, f.year.id, owner, f.dependencies);

    expect(annex.privatelyPaidInvoices.map((i) => [i.id, i.undated])).toEqual([[first.id, false], [last.id, false], [undated.id, true]]);
    expect(annex.unpaidInvoices).toEqual([]);
    expect(annex.totals.privatelyPaidInvoices).toEqual({ count: 3, byCurrency: [{ currency: "GBP", count: 3, amount: "150.00" }] });
  });

  it("never adds different currencies together", async () => {
    const f = await fixture();
    await f.invoice({ total: "10.00", currencyReference: "GBP" });
    await f.invoice({ total: "5.50", currencyReference: "EUR" });
    await f.invoice({ total: "0.01", currencyReference: "GBP" });
    await f.invoice({ total: "99.99", currencyReference: "USD", paymentStatus: "paid_privately" });
    await f.invoice({ total: "0.01", currencyReference: "GBP", paymentStatus: "paid_privately" });

    const { totals } = await buildYearAnnex(f.business.id, f.year.id, owner, f.dependencies);

    expect(totals.unpaidInvoices).toEqual({ count: 3, byCurrency: [{ currency: "EUR", count: 1, amount: "5.50" }, { currency: "GBP", count: 2, amount: "10.01" }] });
    expect(totals.privatelyPaidInvoices).toEqual({ count: 2, byCurrency: [{ currency: "GBP", count: 1, amount: "0.01" }, { currency: "USD", count: 1, amount: "99.99" }] });
  });

  it("shows a credit note as a negative line and nets it against invoices of the same currency only", async () => {
    const f = await fixture();
    const invoice = await f.invoice({ supplier: "Builder", total: "120.00" });
    const credit = await f.invoice({ supplier: "Builder", total: "20.30", kind: "credit_note", invoiceDate: "2026-08-12" });
    await f.invoice({ supplier: "Euro credit", total: "12.30", kind: "credit_note", currencyReference: "EUR" });
    await f.invoice({ supplier: "After year end", total: "99.00", kind: "credit_note", invoiceDate: "2027-04-06" });
    const lastDay = await f.invoice({ supplier: "Last day credit", total: "1.00", kind: "credit_note", invoiceDate: "2027-04-05" });
    const privateCredit = await f.invoice({ supplier: "Private credit", total: "5.00", kind: "credit_note", paymentStatus: "paid_privately" });
    await f.invoice({ supplier: "Private credit before", total: "5.00", kind: "credit_note", paymentStatus: "paid_privately", invoiceDate: "2026-04-05" });

    const annex = await buildYearAnnex(f.business.id, f.year.id, owner, f.dependencies);

    expect(annex.unpaidInvoices.find((i) => i.id === invoice.id)).toMatchObject({ kind: "invoice", total: "120.00" });
    expect(annex.unpaidInvoices.find((i) => i.id === credit.id)).toMatchObject({ kind: "credit_note", total: "-20.30" });
    expect(annex.unpaidInvoices.find((i) => i.id === lastDay.id)).toMatchObject({ kind: "credit_note", total: "-1.00" });
    expect(annex.unpaidInvoices).toHaveLength(4);
    expect(annex.totals.unpaidInvoices).toEqual({ count: 4, byCurrency: [{ currency: "EUR", count: 1, amount: "-12.30" }, { currency: "GBP", count: 3, amount: "98.70" }] });
    expect(annex.privatelyPaidInvoices).toEqual([expect.objectContaining({ id: privateCredit.id, kind: "credit_note", total: "-5.00" })]);
    expect(annex.totals.privatelyPaidInvoices).toEqual({ count: 1, byCurrency: [{ currency: "GBP", count: 1, amount: "-5.00" }] });
  });

  it("lists money out on asset headings as purchases and money in as receipts, never netted", async () => {
    const f = await fixture();
    const laptop = await f.move({ narrative: "Laptop", amount: "-1200.00", movementDate: "2026-09-01" });
    const drill = await f.move({ narrative: "Drill", amount: "-89.99", movementDate: "2026-05-01", moneyAccountId: f.till.id });
    const van = await f.move({ narrative: "Old van sold", amount: "3000.00", headingId: f.heading("Vehicles").id, movementDate: "2026-07-01" });
    await f.move({ narrative: "Rent", amount: "-800.00", headingId: f.heading("Rent").id });
    await f.move({ narrative: "Uncoded", amount: "-5.00", headingId: null, origin: "statement" });
    await f.move({ narrative: "Deleted printer", amount: "-150.00", deletedAt: at });
    await f.move({ narrative: "Last year's chair", amount: "-60.00", financialYearId: f.before.id, movementDate: "2026-01-10" });

    const annex = await buildYearAnnex(f.business.id, f.year.id, owner, f.dependencies);

    expect(annex.assetPurchases).toEqual([
      { movementId: drill.id, date: "2026-05-01", narrative: "Drill", amount: "89.99", headingName: "Equipment", accountName: "Till" },
      { movementId: laptop.id, date: "2026-09-01", narrative: "Laptop", amount: "1200.00", headingName: "Equipment", accountName: "Main bank" },
    ]);
    expect(annex.assetReceipts).toEqual([{ movementId: van.id, date: "2026-07-01", narrative: "Old van sold", amount: "3000.00", headingName: "Vehicles", accountName: "Main bank" }]);
    expect(annex.totals.assetPurchases).toEqual({ count: 2, byCurrency: [{ currency: "GBP", count: 2, amount: "1289.99" }] });
    expect(annex.totals.assetReceipts).toEqual({ count: 1, byCurrency: [{ currency: "GBP", count: 1, amount: "3000.00" }] });
  });

  it("adds hundreds of generated rows to the exact penny", async () => {
    const f = await fixture();
    let seed = 11;
    // The low bits of this generator cycle; the high ones are used.
    const bits = () => Math.floor((seed = (seed * 1103515245 + 12345) % 2147483648) / 65536);
    const next = () => bits() * 32768 + bits();
    const expected = { unpaid: new Map<string, bigint>(), purchases: BigInt(0), receipts: BigInt(0) };
    const pounds = (pence: number) => `${pence < 0 ? "-" : ""}${Math.trunc(Math.abs(pence) / 100)}.${String(Math.abs(pence) % 100).padStart(2, "0")}`;
    for (let i = 0; i < 300; i++) {
      const pence = (next() % 5_000_000) + 1;
      const currency = ["GBP", "EUR"][next() % 2];
      await f.invoice({ total: pounds(pence), currencyReference: currency, invoiceDate: `2026-${String((next() % 12) + 1).padStart(2, "0")}-15` });
      expected.unpaid.set(currency, (expected.unpaid.get(currency) ?? BigInt(0)) + BigInt(pence));
    }
    for (let i = 0; i < 300; i++) {
      const pence = ((next() % 2_000_001) - 1_000_000) || 1;
      await f.move({ amount: pounds(pence), headingId: f.heading(next() % 2 ? "Equipment" : "Vehicles").id });
      if (pence < 0) expected.purchases -= BigInt(pence); else expected.receipts += BigInt(pence);
    }
    const asPounds = (pence: bigint) => `${pence / BigInt(100)}.${String(pence % BigInt(100)).padStart(2, "0")}`;

    const { totals } = await buildYearAnnex(f.business.id, f.year.id, owner, f.dependencies);

    expect(totals.unpaidInvoices.count).toBe(300);
    expect(totals.unpaidInvoices.byCurrency.map((t) => [t.currency, t.amount])).toEqual([["EUR", asPounds(expected.unpaid.get("EUR")!)], ["GBP", asPounds(expected.unpaid.get("GBP")!)]]);
    expect(totals.assetPurchases.count + totals.assetReceipts.count).toBe(300);
    expect(totals.assetPurchases.byCurrency[0].amount).toBe(asPounds(expected.purchases));
    expect(totals.assetReceipts.byCurrency[0].amount).toBe(asPounds(expected.receipts));
  });

  it("gives an empty annex for a quiet year", async () => {
    const f = await fixture();
    const none = { count: 0, byCurrency: [] };
    expect(await buildYearAnnex(f.business.id, f.year.id, owner, f.dependencies)).toEqual({
      year: { id: f.year.id, startDate: "2026-04-06", endDate: "2027-04-05" },
      unpaidInvoices: [], privatelyPaidInvoices: [], assetPurchases: [], assetReceipts: [],
      totals: { unpaidInvoices: none, privatelyPaidInvoices: none, assetPurchases: none, assetReceipts: none },
    });
  });

  it("refuses a year that does not exist or belongs to another business", async () => {
    const f = await fixture();
    const other = await createApprovedBusiness(f.tenancy, "Other Books", owner);
    await f.money.createYear({ id: "other-year", businessId: other.id, startDate: "2026-04-06", endDate: "2027-04-05", status: "open", createdAt: at, updatedAt: at });
    for (const yearId of ["missing", "other-year", "", 42 as unknown as string]) {
      await expect(buildYearAnnex(f.business.id, yearId, owner, f.dependencies)).rejects.toMatchObject({ code: MONEY_ERROR_CODES.FINANCIAL_YEAR_NOT_FOUND });
    }
  });

  it("records one audit event with counts only for the download, none for the annex alone", async () => {
    const f = await fixture();
    await f.invoice({ supplier: "Secret Supplier Ltd", total: "12.34" });
    await f.move({ narrative: "Secret laptop", amount: "-900.00" });
    const annex = await buildYearAnnex(f.business.id, f.year.id, owner, f.dependencies);
    expect((await f.tenancy.listAuditEvents(f.business.id)).filter((e) => e.type === "annex_downloaded")).toEqual([]);

    const download = await downloadYearAnnex(f.business.id, f.year.id, owner, f.dependencies);

    expect(download.annex).toEqual(annex);
    expect(download.csv).toBe(annexCsv(annex));
    const audit = (await f.tenancy.listAuditEvents(f.business.id)).filter((e) => e.type === "annex_downloaded");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorId: owner, entityId: f.year.id, metadata: { financialYearId: f.year.id, unpaidInvoices: 1, privatelyPaidInvoices: 0, assetPurchases: 1, assetReceipts: 0 } });
    expect(JSON.stringify(audit[0].metadata)).not.toMatch(/Secret|12\.34|900/);
  });
});
