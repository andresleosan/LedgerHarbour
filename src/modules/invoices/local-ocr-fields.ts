import {
  OCR_FIELD_NAMES,
  type OcrConfidenceData,
  type OcrExtractedFields,
  type OcrResult,
} from "./ocr-provider";

const companySuffix = /\b(?:ltd\.?|limited|plc|llp|inc\.?)$/i;
const date = /^(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{4})$/;
const money = /^(?:(?:GBP|EUR|USD|[£€$])\s*)?\d[\d., \u00a0\u202f]*(?:\s*(?:GBP|EUR|USD|[£€$]))?$/i;

function unique(values: readonly string[]): string | null {
  const distinct = new Set(values);
  return distinct.size === 1 ? distinct.values().next().value ?? null : null;
}

function labeled(lines: readonly string[], label: RegExp, format?: RegExp): string[] {
  return lines.flatMap((line) => {
    const value = label.exec(line)?.[1]?.trim();
    return value && (!format || format.test(value)) ? [value] : [];
  });
}

function currencyCodes(value: string): string[] {
  const symbols: Record<string, string> = { "£": "GBP", "€": "EUR", "$": "USD" };
  return (value.match(/[£€$]|\b(?:GBP|EUR|USD)\b/gi) ?? []).map(
    (match) => symbols[match] ?? match.toUpperCase(),
  );
}

export function extractLocalOcrFields(pages: readonly string[]): OcrResult {
  const lines = pages.flatMap((page) => page.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  const subtotal = unique(labeled(lines, /^(?:subtotal|sub total|net total)(?:\s*:\s*|\s+)(.+)$/i, money));
  const taxAmount = unique(labeled(lines, /^(?:(?:total\s+)?(?:vat|gst|tax)(?:\s+amount)?)(?:\s*:\s*|\s+)(.+)$/i, money));
  const total = unique(labeled(lines, /^(?:grand total|invoice total|total(?: due| amount)?|amount due|balance due)(?:\s*:\s*|\s+)(.+)$/i, money));
  const explicitCurrency = labeled(lines, /^currency(?:\s*:\s*|\s+)(.+)$/i, /^(?:GBP|EUR|USD|[£€$])$/i);
  const suppliers = labeled(lines, /^(?:supplier|vendor|issued by)(?:\s*:\s*|\s+)(.+)$/i);
  const invoiceDates = labeled(lines, /^(?:invoice date|date of issue|issued on)(?:\s*:\s*|\s+)(.+)$/i, date);
  const fields: OcrExtractedFields = {
    supplier: unique(suppliers.length ? suppliers : lines.slice(0, 5).filter((line) => companySuffix.test(line))),
    invoiceNumber: unique(labeled(lines, /^(?:tax )?invoice\s*(?:no\.?|number|ref(?:erence)?\.?|#)\s*:?\s*(\S+)$/i)),
    invoiceDate: unique(invoiceDates.length ? invoiceDates : labeled(lines, /^date(?:\s*:\s*|\s+)(.+)$/i, date)),
    dueDate: unique(labeled(lines, /^(?:due date|payment due)(?:\s*:\s*|\s+)(.+)$/i, date)),
    subtotal,
    taxAmount,
    total,
    currencyReference: unique([...explicitCurrency, total, subtotal, taxAmount].flatMap((value) => value ? currencyCodes(value) : [])),
    expenseCategoryReference: null,
    notes: null,
  };
  // A plausible label can still identify the wrong figure. All local OCR drafts require a human check.
  const confidence = Object.fromEntries(
    OCR_FIELD_NAMES.map((field) => [field, fields[field] === null ? 0 : 0.79]),
  ) as OcrConfidenceData;
  return { fields, confidence };
}
