import { OcrProviderError, type OcrInput, type OcrProvider, type OcrResult } from "./ocr-provider";

/**
 * Browser-test switches, keyed on the uploaded file's original name. They live only in this fake
 * provider, which the factory and the production gate refuse outside the deterministic test runtime.
 */
export const FAKE_OCR_FAIL_ONCE_PREFIX = "fail-reading-once-";
export const FAKE_OCR_FAIL_ALWAYS_PREFIX = "fail-reading-";

// Documents whose first reading already failed. Kept on globalThis so the dev server's per-route
// module copies share it, as the in-memory repositories do.
const FAILED_ONCE_KEY = Symbol.for("ledgerharbour.fakeOcrProvider.failedOnce");
type FailedOnceStore = typeof globalThis & { [FAILED_ONCE_KEY]?: Set<string> };

function failedOnce(): Set<string> {
  const store = globalThis as FailedOnceStore;
  return (store[FAILED_ONCE_KEY] ??= new Set());
}

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
    if (input.fileName.startsWith(FAKE_OCR_FAIL_ONCE_PREFIX)) {
      if (!failedOnce().has(input.documentId)) {
        failedOnce().add(input.documentId);
        throw new OcrProviderError(true);
      }
    } else if (input.fileName.startsWith(FAKE_OCR_FAIL_ALWAYS_PREFIX)) {
      throw new OcrProviderError(true);
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
