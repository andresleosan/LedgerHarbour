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

  it("reads a photographed till receipt with OCR noise around the labels", () => {
    const result = extractLocalOcrFields([
      "Example Corner Shop\nDATE: 04/03/2026 st0\nTIME: 09:41 TILL: 2\nTotal Sold £5.10\nTotal £5.10\nAmount Gbp5.10\nTotal Gbp5.10",
    ]);

    expect(parseInvoice(result, "ocr")).toMatchObject({
      invoiceDate: "2026-03-04",
      total: "5.10",
      currencyReference: "GBP",
      reviewState: "needs_review",
    });
  });

  it("finds a noisy total line only when it carries a currency and is not tax or a subtotal", () => {
    const noisy = extractLocalOcrFields(["Sub total £40.00\nTotal VAT £8.00\nBe TOTAL - /, £48.00\nCard sale £48.00 ;"]);
    expect(parseInvoice(noisy, "ocr")).toMatchObject({ total: "48.00", currencyReference: "GBP" });

    const bare = extractLocalOcrFields(["xx TOTAL 3 items 12"]);
    expect(parseInvoice(bare, "ocr")).toMatchObject({ total: null, currencyReference: null });
  });

  it("takes only the date from an enlarged reading when the first has no labelled date", () => {
    const first = ["Example Corner Shop\n04/08/2026 09:41 1060\nTotal £5.10"];
    expect(extractLocalOcrFields(first).fields.invoiceDate).toBeNull();

    const result = extractLocalOcrFields(first, ["Example Corner Shop\n04/03/2026 09:41 1060\nTotal £9.99"]);
    expect(parseInvoice(result, "ocr")).toMatchObject({ invoiceDate: "2026-03-04", total: "5.10" });
    expect(result.confidence.invoiceDate).toBe(0.79);
  });

  it("prefers a labelled date and leaves two different unlabelled dates for review", () => {
    const labelled = extractLocalOcrFields(["Date: 04/03/2026\nTotal £5.10"], ["Date: 05/03/2026"]);
    expect(labelled.fields.invoiceDate).toBe("04/03/2026");

    const enlargedLabel = extractLocalOcrFields(["Total £5.10"], ["DATE: 06/03/2026 st0\n07/03/2026"]);
    expect(enlargedLabel.fields.invoiceDate).toBe("06/03/2026");

    const twoDates = extractLocalOcrFields(["Total £5.10"], ["04/03/2026 09:41\nReturn by 03/04/2026"]);
    expect(twoDates.fields.invoiceDate).toBeNull();

    const sameTwice = extractLocalOcrFields(["Total £5.10"], ["04/03/2026 09:41", "Paid 04/03/2026"]);
    expect(sameTwice.fields.invoiceDate).toBe("04/03/2026");
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
