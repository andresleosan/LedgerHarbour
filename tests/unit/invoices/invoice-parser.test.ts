import { describe, expect, it } from "vitest";

import {
  InvoiceParserError,
  parseInvoice,
  type OcrResult,
} from "../../../src/modules/invoices/invoice-parser";

const completeConfidence = {
  supplier: 0.98,
  invoiceNumber: 0.97,
  invoiceDate: 0.96,
  dueDate: 0.95,
  subtotal: 0.94,
  taxAmount: 0.93,
  total: 0.99,
  currencyReference: 0.99,
  expenseCategoryReference: 0.91,
  notes: 0.9,
} as const;

const result = (overrides: Partial<OcrResult["fields"]> = {}): OcrResult => ({
  fields: {
    supplier: "  Harbour Supplies Ltd  ",
    invoiceNumber: "  INV-100  ",
    invoiceDate: "2026-08-01",
    dueDate: "",
    subtotal: "100.00",
    taxAmount: "20.00",
    total: "120.00",
    currencyReference: "GBP",
    expenseCategoryReference: "  office  ",
    notes: "  monthly supplies  ",
    ...overrides,
  },
  confidence: { ...completeConfidence },
});

describe("invoice parser", () => {
  it("trims text fields and converts empty optional values to null", () => {
    expect(parseInvoice(result())).toMatchObject({
      supplier: "Harbour Supplies Ltd",
      invoiceNumber: "INV-100",
      dueDate: null,
      currencyReference: "GBP",
      expenseCategoryReference: "office",
      notes: "monthly supplies",
    });
  });

  it("preserves valid ISO dates and non-negative decimal amounts", () => {
    expect(parseInvoice(result({
      invoiceDate: "2026-08-01",
      dueDate: "2026-09-01",
      subtotal: "0.10",
      taxAmount: "0",
      total: "0.10",
    }))).toMatchObject({
      invoiceDate: "2026-08-01",
      dueDate: "2026-09-01",
      subtotal: "0.10",
      taxAmount: "0",
      total: "0.10",
    });
  });

  it("routes missing required fields and low confidence to needs_review", () => {
    const parsed = parseInvoice(result({ supplier: "", total: null }));

    expect(parsed.reviewState).toBe("needs_review");
    expect(parsed.supplier).toBeNull();
    expect(parsed.total).toBeNull();
  });

  it("keeps per-field confidence data and never adds line items", () => {
    const parsed = parseInvoice(result());

    expect(parsed.confidenceData).toEqual(completeConfidence);
    expect(parsed).not.toHaveProperty("lineItems");
  });

  it.each([
    ["non-ISO invoice date", { invoiceDate: "01/08/2026" }],
    ["negative subtotal", { subtotal: "-1.00" }],
    ["malformed total", { total: "12.3.4" }],
    ["total with more than two decimals", { total: "1.2345" }],
    ["tax amount with three decimals", { taxAmount: "20.005" }],
  ])("rejects %s with a typed parser error", (_description, fields) => {
    expect(() => parseInvoice(result(fields))).toThrowError(InvoiceParserError);
    expect(() => parseInvoice(result(fields))).toThrowError(
      expect.objectContaining({ code: "MALFORMED_OCR_OUTPUT" }),
    );
  });

  it("rejects OCR output that omits a field confidence", () => {
    const malformed = result();
    delete (malformed.confidence as Partial<typeof malformed.confidence>).supplier;

    expect(() => parseInvoice(malformed)).toThrowError(
      expect.objectContaining({ code: "MALFORMED_OCR_OUTPUT" }),
    );
  });
});

describe("invoice parser reading OCR output", () => {
  const ocr = (overrides: Partial<OcrResult["fields"]> = {}) => parseInvoice(result(overrides), "ocr");

  it.each([
    ["16/08/2026", "2026-08-16"],
    ["16-08-2026", "2026-08-16"],
    ["16.08.2026", "2026-08-16"],
    ["6/8/2026", "2026-08-06"],
    ["2026-08-16", "2026-08-16"],
  ])("reads the printed date %s day first", (printed, iso) => {
    expect(ocr({ invoiceDate: printed }).invoiceDate).toBe(iso);
  });

  it.each([
    ["£120.60", "120.60"],
    ["GBP 120.60", "120.60"],
    ["120.60 EUR", "120.60"],
    ["€ 1 234,56", "1234.56"],
    ["1,234.56", "1234.56"],
    ["1.234,56", "1234.56"],
    ["1,234,567.89", "1234567.89"],
    ["1.234.567,89", "1234567.89"],
    ["12,50", "12.50"],
    ["1,234", "1234"],
    ["1.234", "1.234"],
    ["$0.10", "0.10"],
    ["£ 120.60", "120.60"],
    ["120.60 GBP", "120.60"],
    ["GBP120.60", "120.60"],
    ["120.60£", "120.60"],
    ["1 234.56", "1234.56"],
    ["1\u00a0234,56", "1234.56"],
    ["1\u202f234\u202f567.89", "1234567.89"],
  ])("reads the printed amount %s", (printed, amount) => {
    expect(ocr({ total: printed }).total).toBe(amount);
  });

  it.each([
    ["£", "GBP"],
    ["€", "EUR"],
    ["$", "USD"],
    ["gbp", "GBP"],
  ])("reads the printed currency %s", (printed, code) => {
    expect(ocr({ currencyReference: printed }).currencyReference).toBe(code);
  });

  it.each([
    ["invoiceDate", "31/02/2026"],
    ["invoiceDate", "08/16/2026"],
    ["invoiceDate", "sometime in August"],
    ["total", "-12.00"],
    ["total", "(12.00)"],
    ["total", "12.3.4"],
    ["total", "1,23,4"],
    ["total", "twelve pounds"],
    ["total", "12 34"],
    ["total", "1 GBP 2"],
    ["total", "10.00 50.00"],
    ["total", "Net 20.00"],
    ["total", "Qty 3"],
    ["total", "120.60 JPY"],
    ["total", "£120.60 GBP £"],
    ["total", "1 23.45"],
    ["total", "1,2345"],
    ["total", "1.2345"],
    ["total", "£1,234.567"],
    ["currencyReference", "Pounds"],
  ] as const)("leaves an unreadable %s (%s) empty with zero confidence for review", (field, printed) => {
    const parsed = ocr({ [field]: printed });

    expect(parsed[field]).toBeNull();
    expect(parsed.confidenceData[field]).toBe(0);
    expect(parsed.reviewState).toBe("needs_review");
    expect(parsed.supplier).toBe("Harbour Supplies Ltd");
  });

  it.each([
    ["total", "1,234", "1234"],
    ["total", "1.234", "1.234"],
    ["taxAmount", "£2,500", "2500"],
  ] as const)("caps the confidence of the ambiguous amount %s %s below the review threshold", (field, printed, amount) => {
    const parsed = ocr({ [field]: printed });

    expect(parsed[field]).toBe(amount);
    expect(parsed.confidenceData[field]).toBeLessThan(0.8);
    expect(parsed.reviewState).toBe("needs_review");
  });

  it.each([
    ["£120.60", "120.60"],
    ["1,234.56", "1234.56"],
    ["1.234,56", "1234.56"],
    ["1 234.56", "1234.56"],
  ])("keeps the provider confidence for the unambiguous amount %s", (printed, amount) => {
    const parsed = ocr({ total: printed });

    expect(parsed.total).toBe(amount);
    expect(parsed.confidenceData.total).toBe(completeConfidence.total);
    expect(parsed.reviewState).toBe("draft");
  });

  it("sends the invoice to review when an optional field is unreadable", () => {
    const parsed = ocr({ taxAmount: "about 20" });

    expect(parsed.taxAmount).toBeNull();
    expect(parsed.confidenceData.taxAmount).toBe(0);
    expect(parsed.total).toBe("120.00");
    expect(parsed.reviewState).toBe("needs_review");
  });

  it("still rejects structurally malformed OCR output", () => {
    expect(() => parseInvoice(result({ total: 120 as unknown as string }), "ocr")).toThrowError(
      expect.objectContaining({ code: "MALFORMED_OCR_OUTPUT" }),
    );
  });

  it.each([
    ["printed date", { invoiceDate: "16/08/2026" }],
    ["printed amount", { total: "£120.60" }],
  ])("keeps rejecting a human-entered %s instead of dropping it", (_description, fields) => {
    expect(() => parseInvoice(result(fields))).toThrowError(
      expect.objectContaining({ code: "MALFORMED_OCR_OUTPUT" }),
    );
  });
});
