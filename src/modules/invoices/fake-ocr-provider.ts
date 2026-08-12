import type { OcrInput, OcrProvider, OcrResult } from "./ocr-provider";

export interface FakeOcrProviderOptions {
  failureDocumentIds?: readonly string[];
}

export class FakeOcrProvider implements OcrProvider {
  private readonly failureDocumentIds: ReadonlySet<string>;

  constructor(options: FakeOcrProviderOptions = {}) {
    this.failureDocumentIds = new Set(options.failureDocumentIds ?? []);
  }

  async extract(input: OcrInput): Promise<OcrResult> {
    if (this.failureDocumentIds.has(input.documentId)) {
      throw new Error("fake OCR provider failure");
    }

    return {
      fields: {
        supplier: "LedgerHarbour Demo Supplier",
        invoiceNumber: `FAKE-${input.documentId}`,
        invoiceDate: "2026-08-01",
        dueDate: null,
        subtotal: "100.00",
        taxAmount: "20.00",
        total: "120.00",
        currencyReference: "GBP",
        expenseCategoryReference: null,
        notes: `Deterministic OCR for ${input.fileName}`,
      },
      confidence: {
        supplier: 0.75,
        invoiceNumber: 0.75,
        invoiceDate: 0.95,
        dueDate: 0.95,
        subtotal: 0.95,
        taxAmount: 0.95,
        total: 0.95,
        currencyReference: 0.95,
        expenseCategoryReference: 0.95,
        notes: 0.95,
      },
    };
  }
}
