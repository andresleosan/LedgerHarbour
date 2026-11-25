import {
  OCR_FIELD_NAMES,
  type OcrConfidenceData,
  type OcrExtractedFields,
  type OcrResult,
} from "./ocr-provider";

const companySuffix = /\b(?:ltd\.?|limited|plc|llp|inc\.?)$/i;
const date = /^(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/.-]\d{1,2}[/.-](?:\d{2}|\d{4}))$/;
// One date printed as "12.12.19" and "12/12/2019" is the same date (LH-043); ISO dates are compared as printed.
const dateKey = (value: string) => /^\d{4}-/.test(value) ? value
  : value.split(/[/.-]/).map((part, index) => index === 2 ? part.padStart(4, "20") : part.padStart(2, "0")).join("/");
const money = /^(?:(?:GBP|EUR|USD|[£€$])\s*)?\d[\d., \u00a0\u202f]*(?:\s*(?:GBP|EUR|USD|[£€$]))?$/i;

// Receipts print one figure in several forms ("£5.10", "Gbp5.10"); money is compared without its currency marks.
const amountKey = (value: string) => value.replace(/GBP|EUR|USD|[£€$\s\u00a0\u202f]/gi, "");
// A noisy total line still needs a currency mark, and never a tax or subtotal label.
const noisyTotal = /(?<!(?:sub|net)\s*)\btotal\b[^\d£€$]*((?:GBP|EUR|USD|[£€$])\s*\d[\d.,]*)\W*$/i;

function unique(values: readonly string[], key: (value: string) => string = (value) => value): string | null {
  return new Set(values.map(key)).size === 1 ? values[0] : null;
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

const toLines = (pages: readonly string[]) =>
  pages.flatMap((page) => page.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));

function labeledDate(lines: readonly string[]): string | null {
  // Only the first token after a date label is read, so OCR noise after the date does not hide it.
  const invoiceDates = labeled(lines, /^(?:invoice date|date of issue|issued on)(?:\s*:\s*|\s+)(\S+)/i, date);
  return unique(invoiceDates.length ? invoiceDates : labeled(lines, /^date(?:\s*:\s*|\s+)(\S+)/i, date), dateKey);
}

/**
 * `enlargedPages` is a second reading of a small photo, used only for the date: its labelled date, or else
 * its one distinct date, since tills often print the date unlabelled at the foot (LH-040).
 */
export function extractLocalOcrFields(pages: readonly string[], enlargedPages: readonly string[] = []): OcrResult {
  const lines = toLines(pages);
  const enlarged = toLines(enlargedPages);
  const subtotal = unique(labeled(lines, /^(?:subtotal|sub total|net total)(?:\s*:\s*|\s+)(.+)$/i, money));
  const taxAmount = unique(labeled(lines, /^(?:(?:total\s+)?(?:vat|gst|tax)(?:\s+amount)?)(?:\s*:\s*|\s+)(.+)$/i, money));
  const labeledTotals = labeled(lines, /^(?:grand total|invoice total|total(?: due| amount)?|amount due|balance due)(?:\s*:\s*|\s+)(.+)$/i, money);
  const totals = labeledTotals.length
    ? labeledTotals
    : labeled(lines.filter((line) => !/\b(?:vat|gst|tax)\b/i.test(line)), noisyTotal, money);
  const total = unique(totals, amountKey);
  const explicitCurrency = labeled(lines, /^currency(?:\s*:\s*|\s+)(.+)$/i, /^(?:GBP|EUR|USD|[£€$])$/i);
  const suppliers = labeled(lines, /^(?:supplier|vendor|issued by)(?:\s*:\s*|\s+)(.+)$/i);
  const fields: OcrExtractedFields = {
    supplier: unique(suppliers.length ? suppliers : lines.slice(0, 5).filter((line) => companySuffix.test(line))),
    invoiceNumber: unique(labeled(lines, /^(?:tax )?invoice\s*(?:no\.?|number|ref(?:erence)?\.?|#)\s*:?\s*(\S+)$/i)),
    invoiceDate: labeledDate(lines) ?? labeledDate(enlarged) ??
      unique(enlarged.flatMap((line) => line.split(/\s+/)).filter((token) => date.test(token)), dateKey),
    dueDate: unique(labeled(lines, /^(?:due date|payment due)(?:\s*:\s*|\s+)(\S+)/i, date), dateKey),
    subtotal,
    taxAmount,
    total,
    currencyReference: unique([...explicitCurrency, ...(total ? totals : []), subtotal, taxAmount].flatMap((value) => value ? currencyCodes(value) : [])),
    expenseCategoryReference: null,
    notes: null,
  };
  // A plausible label can still identify the wrong figure. All local OCR drafts require a human check.
  const confidence = Object.fromEntries(
    OCR_FIELD_NAMES.map((field) => [field, fields[field] === null ? 0 : 0.79]),
  ) as OcrConfidenceData;
  return { fields, confidence };
}
