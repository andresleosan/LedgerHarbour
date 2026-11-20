import { describe, expect, it } from "vitest";

import { FakeOcrProvider } from "../../../src/modules/invoices/fake-ocr-provider";
import { OcrProviderError } from "../../../src/modules/invoices/ocr-provider";

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

  it("reads a file normally when its name carries no failure marker", async () => {
    const provider = new FakeOcrProvider();
    const named = { ...input, documentId: "document-normal", fileName: "reading-fail-invoice.pdf" };

    await expect(provider.extract(named)).resolves.toMatchObject({ fields: { invoiceNumber: "FAKE-document-normal" } });
  });

  it("fails every reading with a retryable provider error when the file name starts with fail-reading-", async () => {
    const named = { ...input, documentId: "document-always", fileName: "fail-reading-invoice.pdf" };

    for (const provider of [new FakeOcrProvider(), new FakeOcrProvider(), new FakeOcrProvider()]) {
      const failure = await provider.extract(named).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(OcrProviderError);
      expect(failure).toMatchObject({ retryable: true });
    }
  });

  it("fails only the first reading of a document whose file name starts with fail-reading-once-", async () => {
    const named = { ...input, documentId: "document-once", fileName: "fail-reading-once-invoice.pdf" };

    // A new instance per reading, as the OCR worker creates one per job: the memory is shared.
    await expect(new FakeOcrProvider().extract(named)).rejects.toMatchObject({ name: "OcrProviderError", retryable: true });
    await expect(new FakeOcrProvider().extract(named)).resolves.toMatchObject({ fields: { invoiceNumber: "FAKE-document-once" } });
    await expect(new FakeOcrProvider().extract(named)).resolves.toMatchObject({ fields: { invoiceNumber: "FAKE-document-once" } });
    await expect(new FakeOcrProvider().extract({ ...named, documentId: "document-once-other" })).rejects.toBeInstanceOf(OcrProviderError);
  });

  it("does not produce line items", async () => {
    const result = await new FakeOcrProvider().extract(input);

    expect(result).not.toHaveProperty("lineItems");
  });
});
