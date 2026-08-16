export const OCR_FIELD_NAMES = [
  "supplier",
  "invoiceNumber",
  "invoiceDate",
  "dueDate",
  "subtotal",
  "taxAmount",
  "total",
  "currencyReference",
  "expenseCategoryReference",
  "notes",
] as const;

export type DocumentId = string & { readonly __brand: "DocumentId" };
export type InvoiceId = string & { readonly __brand: "InvoiceId" };

export type OcrFieldName = (typeof OCR_FIELD_NAMES)[number];

export interface OcrExtractedFields {
  supplier: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  subtotal: string | null;
  taxAmount: string | null;
  total: string | null;
  currencyReference: string | null;
  expenseCategoryReference: string | null;
  notes: string | null;
}

export type OcrConfidenceData = Record<OcrFieldName, number>;

export interface OcrInput {
  documentId: string;
  fileName: string;
  mimeType: string;
  data: Uint8Array;
}

export interface OcrResult {
  fields: OcrExtractedFields;
  confidence: OcrConfidenceData;
}

export interface OcrProvider {
  extract(input: OcrInput): Promise<OcrResult>;
}

export class OcrProviderError extends Error {
  readonly name = "OcrProviderError";

  constructor(readonly retryable: boolean) {
    super("OCR provider request failed.");
  }
}
