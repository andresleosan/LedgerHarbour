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
