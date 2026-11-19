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
// ponytail: printed dates are read day first (DD/MM/YYYY) because the product serves UK/Jersey businesses.
const PRINTED_DATE_PATTERN = /^(\d{1,2})([/.-])(\d{1,2})\2(\d{4})$/;
// A currency symbol or seeded ISO code is only accepted at the start or end of the whole value.
const CURRENCY_AFFIX = /^(?:[£€$]|GBP|EUR|USD)\s*(?=\d)|(?<=\d)\s*(?:[£€$]|GBP|EUR|USD)$/gi;
const SPACE_GROUPED = /^\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d+)?$/;
const AMBIGUOUS_AMOUNT = /^\d+[.,]\d{3}$/;
const THOUSANDS_GROUPING = /^\d{1,3}([.,])\d{3}(?:\1\d{3})*$/;
const CURRENCY_SYMBOLS: Record<string, string> = { "£": "GBP", "€": "EUR", "$": "USD" };

/** Where the values come from: OCR output is read leniently, human edits are validated strictly. */
export type InvoiceInputSource = "ocr" | "human";

function malformed(): never {
  throw new InvoiceParserError(INVOICE_PARSER_ERROR_CODES.MALFORMED_OCR_OUTPUT);
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return malformed();
  const trimmed = value.trim();
  return trimmed || null;
}

function isoDate(value: string): string | null {
  if (!DATE_PATTERN.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return null;
  return value;
}

function printedDate(value: string): string | null {
  const match = PRINTED_DATE_PATTERN.exec(value);
  if (!match) return isoDate(value);
  const [, day, , month, year] = match;
  return isoDate(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`);
}

function decimal(value: string): string | null {
  if (!DECIMAL_PATTERN.test(value) || !Number.isFinite(Number(value))) return null;
  return value;
}

// The decimal mark is the last separator when both "," and "." appear, and a separator repeated on its
// own is a thousands mark. A single "," followed by exactly three digits ("1,234") is ambiguous; it is
// read as thousands, following UK convention, while a single "." ("1.234") stays a decimal mark.
// Signs and parentheses are not part of the model, so negative amounts are left unreadable.
// Whitespace inside the number is only a thousands separator with valid groups ("1 234.56"); any other
// letters, symbols or spacing make the amount unreadable rather than merging digits.
function bareAmount(value: string): string {
  const bare = value.replace(CURRENCY_AFFIX, "");
  return SPACE_GROUPED.test(bare) ? bare.replace(/[ \u00a0\u202f]/g, "") : bare;
}

function printedAmount(value: string): string | null {
  const bare = bareAmount(value);
  if (!/^[\d.,]+$/.test(bare)) return null;
  const marks = bare.replace(/\d/g, "");
  const onlyThousands = marks.length === 0 || (marks.length > 1 && new Set(marks).size === 1) ||
    (marks === "," && /,\d{3}$/.test(bare));
  const decimalAt = onlyThousands ? -1 : bare.lastIndexOf(marks.at(-1)!);
  const integer = decimalAt === -1 ? bare : bare.slice(0, decimalAt);
  const fraction = decimalAt === -1 ? null : bare.slice(decimalAt + 1);
  const digits = integer.replace(/[.,]/g, "");
  if (digits !== integer && !THOUSANDS_GROUPING.test(integer)) return null;
  if (fraction !== null && !/^\d+$/.test(fraction)) return null;
  return decimal(fraction === null ? digits : `${digits}.${fraction}`);
}

function printedCurrency(value: string): string | null {
  return CURRENCY_SYMBOLS[value] ?? (/^[A-Za-z]{3}$/.test(value) ? value.toUpperCase() : null);
}

function confidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) return malformed();
  return value;
}

export function parseInvoice(result: OcrResult, source: InvoiceInputSource = "human"): InvoiceDraft {
  if (!result || typeof result !== "object" || !result.fields || !result.confidence) return malformed();

  const fields = result.fields;
  const confidenceData = { ...result.confidence } as OcrConfidenceData;
  for (const field of OCR_FIELD_NAMES) {
    if (!Object.prototype.hasOwnProperty.call(fields, field) || !Object.prototype.hasOwnProperty.call(confidenceData, field)) return malformed();
    confidence(confidenceData[field]);
  }

  const ocr = source === "ocr";
  const unreadable: (keyof OcrExtractedFields)[] = [];
  const ambiguous: (keyof OcrExtractedFields)[] = [];
  // An OCR value that cannot be normalized is left empty for human review; a human value is rejected.
  const read = (field: keyof OcrExtractedFields, normalize: (value: string) => string | null): string | null => {
    const value = text(fields[field]);
    if (value === null) return null;
    const normalized = normalize(value);
    if (normalized !== null) return normalized;
    if (!ocr) return malformed();
    unreadable.push(field);
    return null;
  };
  const date = ocr ? printedDate : isoDate;
  const amount = (field: keyof OcrExtractedFields): string | null => {
    if (!ocr) return read(field, decimal);
    const parsed = read(field, printedAmount);
    // A lone "," or "." before exactly three digits was resolved by the UK rule above; a human confirms it.
    if (parsed !== null && AMBIGUOUS_AMOUNT.test(bareAmount(text(fields[field])!))) ambiguous.push(field);
    return parsed;
  };

  const draft: Omit<InvoiceDraft, "confidenceData" | "reviewState"> = {
    supplier: text(fields.supplier),
    invoiceNumber: text(fields.invoiceNumber),
    invoiceDate: read("invoiceDate", date),
    dueDate: read("dueDate", date),
    subtotal: amount("subtotal"),
    taxAmount: amount("taxAmount"),
    total: amount("total"),
    currencyReference: ocr ? read("currencyReference", printedCurrency) : text(fields.currencyReference),
    expenseCategoryReference: text(fields.expenseCategoryReference),
    notes: text(fields.notes),
  };

  for (const field of unreadable) confidenceData[field] = 0;
  for (const field of ambiguous) confidenceData[field] = Math.min(confidenceData[field], CONFIDENCE_THRESHOLD - 0.01);

  const needsReview = unreadable.length > 0 || ambiguous.length > 0 ||
    REQUIRED_FIELDS.some((field) => draft[field] === null) ||
    REQUIRED_FIELDS.some((field) => confidenceData[field] < CONFIDENCE_THRESHOLD);

  return {
    ...draft,
    confidenceData,
    reviewState: needsReview ? "needs_review" : "draft",
  };
}
