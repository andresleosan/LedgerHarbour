import { describe, expect, it } from "vitest";

import {
  GoogleDocumentAiInvoiceProvider,
  type GoogleDocumentAiClient,
} from "../../../src/modules/invoices/google-document-ai-provider";
import {
  OcrProviderError,
  type OcrInput,
} from "../../../src/modules/invoices/ocr-provider";

const input: OcrInput = {
  documentId: "document-1",
  fileName: "invoice.pdf",
  mimeType: "application/pdf",
  data: new Uint8Array([1, 2, 3, 4]),
};

describe("Google Document AI invoice provider", () => {
  it("maps invoice entities and sends the configured raw document once", async () => {
    const requests: unknown[] = [];
    const client: GoogleDocumentAiClient = {
      processDocument: async (request) => {
        requests.push(request);
        return {
          entities: [
            { type: "supplier_name", mentionText: "Acme Ltd", confidence: 0.92 },
            { type: "invoice_id", mentionText: "INV-42", confidence: 0.88 },
            {
              type: "invoice_date",
              normalizedValue: { dateValue: { year: 2026, month: 8, day: 16 } },
              confidence: 0.91,
            },
            {
              type: "net_amount",
              normalizedValue: {
                moneyValue: { units: "100", nanos: 500000000, currencyCode: "GBP" },
              },
              confidence: 0.86,
            },
            { type: "total_tax_amount", mentionText: "20.10", confidence: 0.84 },
            { type: "total_amount", mentionText: "120.60", confidence: 0.93 },
            { type: "currency", mentionText: "GBP", confidence: 0.99 },
          ],
        };
      },
    };

    const result = await new GoogleDocumentAiInvoiceProvider({
      client,
      processorName: "projects/demo/locations/eu/processors/invoice",
    }).extract(input);

    expect(result).toEqual({
      fields: {
        supplier: "Acme Ltd",
        invoiceNumber: "INV-42",
        invoiceDate: "2026-08-16",
        dueDate: null,
        subtotal: "100.50",
        taxAmount: "20.10",
        total: "120.60",
        currencyReference: "GBP",
        expenseCategoryReference: null,
        notes: null,
      },
      confidence: {
        supplier: 0.92,
        invoiceNumber: 0.88,
        invoiceDate: 0.91,
        dueDate: 0,
        subtotal: 0.86,
        taxAmount: 0.84,
        total: 0.93,
        currencyReference: 0.99,
        expenseCategoryReference: 0,
        notes: 0,
      },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual({
      name: "projects/demo/locations/eu/processors/invoice",
      rawDocument: {
        content: Buffer.from(input.data),
        mimeType: input.mimeType,
      },
    });
  });

  it("returns null and zero confidence for missing entities", async () => {
    const client: GoogleDocumentAiClient = {
      processDocument: async () => ({
        entities: [{ type: "supplier_name", mentionText: "Acme Ltd", confidence: 0.8 }],
      }),
    };

    const result = await new GoogleDocumentAiInvoiceProvider({
      client,
      processorName: "processor",
    }).extract(input);

    expect(result.fields).toMatchObject({
      supplier: "Acme Ltd",
      invoiceNumber: null,
      invoiceDate: null,
      dueDate: null,
      subtotal: null,
      taxAmount: null,
      total: null,
      currencyReference: null,
      expenseCategoryReference: null,
      notes: null,
    });
    expect(result.confidence).toMatchObject({
      supplier: 0.8,
      invoiceNumber: 0,
      invoiceDate: 0,
      dueDate: 0,
      subtotal: 0,
      taxAmount: 0,
      total: 0,
      currencyReference: 0,
      expenseCategoryReference: 0,
      notes: 0,
    });
  });

  it("returns null when a normalized date is malformed", async () => {
    const client: GoogleDocumentAiClient = {
      processDocument: async () => ({
        entities: [
          {
            type: "invoice_date",
            normalizedValue: { dateValue: { year: 2026, month: 13, day: 16 } },
            confidence: 0.91,
          },
        ],
      }),
    };

    const result = await new GoogleDocumentAiInvoiceProvider({
      client,
      processorName: "processor",
    }).extract(input);

    expect(result.fields.invoiceDate).toBeNull();
    expect(result.confidence.invoiceDate).toBe(0.91);
  });

  it("returns null when a normalized money value is malformed", async () => {
    const client: GoogleDocumentAiClient = {
      processDocument: async () => ({
        entities: [
          {
            type: "net_amount",
            normalizedValue: { moneyValue: { units: "not-a-number", nanos: 0 } },
            confidence: 0.86,
          },
        ],
      }),
    };

    const result = await new GoogleDocumentAiInvoiceProvider({
      client,
      processorName: "processor",
    }).extract(input);

    expect(result.fields.subtotal).toBeNull();
    expect(result.confidence.subtotal).toBe(0.86);
  });

  it("uses normalized money when tax and total have no mention text", async () => {
    const client: GoogleDocumentAiClient = {
      processDocument: async () => ({
        entities: [
          {
            type: "total_tax_amount",
            normalizedValue: { moneyValue: { units: "20", nanos: 100000000 } },
            confidence: 0.84,
          },
          {
            type: "total_amount",
            normalizedValue: { moneyValue: { units: "120", nanos: 600000000 } },
            confidence: 0.93,
          },
        ],
      }),
    };

    const result = await new GoogleDocumentAiInvoiceProvider({
      client,
      processorName: "processor",
    }).extract(input);

    expect(result.fields.taxAmount).toBe("20.10");
    expect(result.fields.total).toBe("120.60");
  });

  it("translates transient provider failures without exposing provider details", async () => {
    const client: GoogleDocumentAiClient = {
      processDocument: async () => {
        throw Object.assign(new Error("private provider response"), { status: 503 });
      },
    };

    await expect(
      new GoogleDocumentAiInvoiceProvider({ client, processorName: "processor" }).extract(input),
    ).rejects.toMatchObject({
      name: "OcrProviderError",
      message: "OCR provider request failed.",
      retryable: true,
    });
    await expect(
      new GoogleDocumentAiInvoiceProvider({ client, processorName: "processor" }).extract(input),
    ).rejects.not.toThrow("private provider response");
  });

  it("marks permission failures as non-retryable", async () => {
    const client: GoogleDocumentAiClient = {
      processDocument: async () => {
        throw Object.assign(new Error("private permission response"), { code: 7 });
      },
    };

    const error = await new GoogleDocumentAiInvoiceProvider({
      client,
      processorName: "processor",
    }).extract(input).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(OcrProviderError);
    expect(error).toMatchObject({
      message: "OCR provider request failed.",
      retryable: false,
    });
    expect(error).not.toHaveProperty("cause");
  });

  it("marks an internal gRPC failure as retryable", async () => {
    const client: GoogleDocumentAiClient = {
      processDocument: async () => {
        throw Object.assign(new Error("private internal response"), { code: 13 });
      },
    };

    const error = await new GoogleDocumentAiInvoiceProvider({
      client,
      processorName: "processor",
    }).extract(input).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      name: "OcrProviderError",
      retryable: true,
    });
  });
});
