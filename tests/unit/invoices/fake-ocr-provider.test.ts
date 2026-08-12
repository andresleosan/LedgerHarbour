import { describe, expect, it } from "vitest";

import { FakeOcrProvider } from "../../../src/modules/invoices/fake-ocr-provider";

const input = {
  documentId: "document-1",
  fileName: "invoice.pdf",
  mimeType: "application/pdf",
  data: new Uint8Array([1, 2, 3, 4]),
};

describe("fake OCR provider", () => {
  it("returns deterministic extracted fields and per-field confidence", async () => {
    const provider = new FakeOcrProvider();

    await expect(provider.extract(input)).resolves.toEqual(await provider.extract(input));
    await expect(provider.extract(input)).resolves.toMatchObject({
      fields: {
        supplier: "LedgerHarbour Demo Supplier",
        invoiceNumber: "FAKE-document-1",
      },
      confidence: {
        supplier: expect.any(Number),
        total: expect.any(Number),
      },
    });
  });

  it("fails deterministically when the document is configured to fail", async () => {
    const provider = new FakeOcrProvider({ failureDocumentIds: [input.documentId] });

    await expect(provider.extract(input)).rejects.toThrow("fake OCR provider failure");
  });

  it("does not produce line items", async () => {
    const result = await new FakeOcrProvider().extract(input);

    expect(result).not.toHaveProperty("lineItems");
  });
});
