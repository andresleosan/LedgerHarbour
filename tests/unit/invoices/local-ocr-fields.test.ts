import { describe, expect, it } from "vitest";

import { parseInvoice } from "../../../src/modules/invoices/invoice-parser";
import { extractLocalOcrFields } from "../../../src/modules/invoices/local-ocr-fields";

describe("local OCR invoice fields", () => {
  it("extracts common labels across pages and sends the result for review", () => {
    const result = extractLocalOcrFields([
      "Example Supplies Ltd\nInvoice no: LH-104\nInvoice date:16/08/2026\nDue Date: 01/09/2026",
      "Subtotal £100.50\nVAT:£20.10\nTotal due: £120.60",
    ]);

    expect(parseInvoice(result, "ocr")).toMatchObject({
      supplier: "Example Supplies Ltd",
      invoiceNumber: "LH-104",
      invoiceDate: "2026-08-16",
      dueDate: "2026-09-01",
      subtotal: "100.50",
      taxAmount: "20.10",
      total: "120.60",
      currencyReference: "GBP",
      reviewState: "needs_review",
    });
  });

  it("leaves conflicting or unreadable values for review without guessing a currency", () => {
    const result = extractLocalOcrFields([
      "Supplier: Example Supplies\nVendor: Other Supplies\nInvoice Date: 31/02/2026",
      "Invoice Date: 01/03/2026\nDate: 01/01/2026\nTotal £120.60\nAmount Due £44.21",
      "Subtotal 10 20\nCurrency EUR\nCurrency USD",
    ]);
    const draft = parseInvoice(result, "ocr");

    expect(draft).toMatchObject({
      supplier: null,
      invoiceDate: null,
      subtotal: null,
      total: null,
      currencyReference: null,
      reviewState: "needs_review",
    });
  });

  it("leaves a blank scan in human review", () => {
    expect(parseInvoice(extractLocalOcrFields([" ", "\n"]), "ocr")).toMatchObject({
      invoiceNumber: null,
      total: null,
      currencyReference: null,
      reviewState: "needs_review",
    });
  });
});
