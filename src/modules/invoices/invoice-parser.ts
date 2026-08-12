import { OCR_FIELD_NAMES, type OcrConfidenceData, type OcrExtractedFields, type OcrResult } from "./ocr-provider";

export type { OcrResult } from "./ocr-provider";

export const INVOICE_REVIEW_STATES = ["draft", "needs_review", "approved"] as const;
export type InvoiceReviewState = (typeof INVOICE_REVIEW_STATES)[number];

export interface InvoiceDraft {
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
  confidenceData: OcrConfidenceData;
  reviewState: InvoiceReviewState;
}

export const INVOICE_PARSER_ERROR_CODES = {
  MALFORMED_OCR_OUTPUT: "MALFORMED_OCR_OUTPUT",
} as const;

export class InvoiceParserError extends Error {
  readonly name = "InvoiceParserError";

  constructor(readonly code: keyof typeof INVOICE_PARSER_ERROR_CODES | (typeof INVOICE_PARSER_ERROR_CODES)[keyof typeof INVOICE_PARSER_ERROR_CODES]) {
    super("The OCR output is invalid.");
  }
}

const REQUIRED_FIELDS: readonly (keyof OcrExtractedFields)[] = [
  "supplier",
  "invoiceNumber",
  "invoiceDate",
  "total",
  "currencyReference",
];
const CONFIDENCE_THRESHOLD = 0.8;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL_PATTERN = /^\d+(?:\.\d+)?$/;

function malformed(): never {
  throw new InvoiceParserError(INVOICE_PARSER_ERROR_CODES.MALFORMED_OCR_OUTPUT);
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return malformed();
  const trimmed = value.trim();
  return trimmed || null;
}

function isoDate(value: unknown): string | null {
  const normalized = text(value);
  if (normalized === null) return null;
  if (!DATE_PATTERN.test(normalized)) return malformed();
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) return malformed();
  return normalized;
}

function decimal(value: unknown): string | null {
  const normalized = text(value);
  if (normalized === null) return null;
  if (!DECIMAL_PATTERN.test(normalized) || !Number.isFinite(Number(normalized))) return malformed();
  return normalized;
}

function confidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) return malformed();
  return value;
}

export function parseInvoice(result: OcrResult): InvoiceDraft {
  if (!result || typeof result !== "object" || !result.fields || !result.confidence) return malformed();

  const fields = result.fields;
  const confidenceData = { ...result.confidence } as OcrConfidenceData;
  for (const field of OCR_FIELD_NAMES) {
    if (!Object.prototype.hasOwnProperty.call(fields, field) || !Object.prototype.hasOwnProperty.call(confidenceData, field)) return malformed();
    confidence(confidenceData[field]);
  }

  const draft: Omit<InvoiceDraft, "confidenceData" | "reviewState"> = {
    supplier: text(fields.supplier),
    invoiceNumber: text(fields.invoiceNumber),
    invoiceDate: isoDate(fields.invoiceDate),
    dueDate: isoDate(fields.dueDate),
    subtotal: decimal(fields.subtotal),
    taxAmount: decimal(fields.taxAmount),
    total: decimal(fields.total),
    currencyReference: text(fields.currencyReference),
    expenseCategoryReference: text(fields.expenseCategoryReference),
    notes: text(fields.notes),
  };

  const needsReview = REQUIRED_FIELDS.some((field) => draft[field] === null) ||
    REQUIRED_FIELDS.some((field) => confidenceData[field] < CONFIDENCE_THRESHOLD);

  return {
    ...draft,
    confidenceData,
    reviewState: needsReview ? "needs_review" : "draft",
  };
}
