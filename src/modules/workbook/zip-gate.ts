import { inflateRawSync } from "node:zlib";

import { TemplateReadError } from "./template-profile";

// Inspects an .xlsx archive before exceljs sees it, so nothing attacker-sized reaches
// `workbook.xlsx.load`: real (inflated) sizes, and the ranges exceljs expands cell by
// cell on load (merged cells, data validations, defined names).

export const MAX_ACCOUNT_ROWS = 20_000;
export const MAX_ACCOUNT_COLUMNS = 400;

const MAX_ZIP_ENTRIES = 2_000;
const MAX_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
/** Any single range: no larger than the biggest account sheet allowed. */
const MAX_RANGE_CELLS = MAX_ACCOUNT_ROWS * MAX_ACCOUNT_COLUMNS;
/** Cells exceljs creates for merged ranges and defined names, per workbook. */
const MAX_CREATED_CELLS = 100_000;
/** Entries exceljs creates for data validations, per workbook. */
const MAX_VALIDATION_CELLS = 2_000_000;
const SHEET_COLUMNS = 16_384;
const SHEET_ROWS = 1_048_576;

// ponytail: regex over the XML text, not an XML parser. It only has to find the
// attributes exceljs expands; the ceiling is the 64 MiB per-entry cap on the text.
const MERGE = /<mergeCell\b[^>]*?\bref="([^"]*)"/g;
const VALIDATION = /<dataValidation\b[^>]*?\bsqref="([^"]*)"/g;
const SHARED_FORMULA = /<f\b[^>]*?\bref="([^"]*)"/g;
const DIMENSION = /<dimension\b[^>]*?\bref="([^"]*)"/g;
const DEFINED_NAME = /<definedName\b[^>]*>([^<]*)<\/definedName>/g;
const CELL = /\$?([A-Za-z]{1,3})\$?(\d+)/g;

export function inspectWorkbookZip(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.byteLength - 22; i >= Math.max(0, bytes.byteLength - 22 - 0xffff) && end < 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) end = i;
  }
  if (end < 0) throw new TemplateReadError("NOT_A_WORKBOOK");
  const count = view.getUint16(end + 10, true);
  const size = view.getUint32(end + 12, true);
  const start = view.getUint32(end + 16, true);
  if (count > MAX_ZIP_ENTRIES) throw new TemplateReadError("TOO_LARGE");
  if (start + size > end) throw new TemplateReadError("NOT_A_WORKBOOK");

  // First gate, cheap: the sizes the central directory declares.
  const entries: Array<{ name: string; method: number; compressedSize: number; local: number }> = [];
  let declared = 0;
  for (let i = 0, p = start; i < count; i++) {
    if (p + 46 > start + size || view.getUint32(p, true) !== 0x02014b50) throw new TemplateReadError("NOT_A_WORKBOOK");
    declared += view.getUint32(p + 24, true);
    if (declared > MAX_UNCOMPRESSED_BYTES) throw new TemplateReadError("TOO_LARGE");
    const nameLength = view.getUint16(p + 28, true);
    entries.push({
      name: Buffer.from(bytes.buffer, bytes.byteOffset + p + 46, nameLength).toString("utf8"),
      method: view.getUint16(p + 10, true),
      compressedSize: view.getUint32(p + 20, true),
      local: view.getUint32(p + 42, true),
    });
    p += 46 + nameLength + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
  }

  // Second gate: the real sizes, one entry at a time, and the ranges inside the XML.
  const budget = { total: 0, created: 0, validations: 0 };
  for (const entry of entries) {
    if (entry.local + 30 > end || view.getUint32(entry.local, true) !== 0x04034b50) throw new TemplateReadError("NOT_A_WORKBOOK");
    const dataStart = entry.local + 30 + view.getUint16(entry.local + 26, true) + view.getUint16(entry.local + 28, true);
    if (dataStart + entry.compressedSize > end) throw new TemplateReadError("NOT_A_WORKBOOK");
    const data = inflate(bytes.subarray(dataStart, dataStart + entry.compressedSize), entry.method, Math.min(MAX_ENTRY_BYTES, MAX_UNCOMPRESSED_BYTES - budget.total));
    budget.total += data.length;
    // exceljs picks entries by unanchored name patterns ("…sheet1.xml"), so scan every XML-ish entry.
    if (entry.name.toLowerCase().includes(".xml")) scanXml(data.toString("utf8"), budget);
  }
}

function inflate(data: Uint8Array, method: number, limit: number): Buffer {
  if (method === 0) {
    if (data.length > limit) throw new TemplateReadError("TOO_LARGE");
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  if (method !== 8) throw new TemplateReadError("NOT_A_WORKBOOK");
  try {
    return inflateRawSync(data, { maxOutputLength: Math.max(1, limit) });
  } catch (error) {
    if (error instanceof RangeError || (error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") throw new TemplateReadError("TOO_LARGE");
    throw new TemplateReadError("NOT_A_WORKBOOK");
  }
}

function scanXml(xml: string, budget: { created: number; validations: number }) {
  for (const [, ref] of xml.matchAll(MERGE)) {
    budget.created += area(ref, true);
    if (budget.created > MAX_CREATED_CELLS) throw new TemplateReadError("TOO_LARGE");
  }
  for (const [, sqref] of xml.matchAll(VALIDATION)) {
    // A whole column ("E:E") is legitimate and exceljs does not expand it; "E1:E9" it does.
    for (const ref of sqref.trim().split(/\s+/)) {
      budget.validations += area(ref, false);
      if (budget.validations > MAX_VALIDATION_CELLS) throw new TemplateReadError("TOO_LARGE");
    }
  }
  for (const pattern of [SHARED_FORMULA, DIMENSION]) {
    for (const [, ref] of xml.matchAll(pattern)) area(ref, true);
  }
  for (const [, text] of xml.matchAll(DEFINED_NAME)) {
    // Bounding box of every cell the name mentions: covers whatever exceljs makes of it.
    const cells = [...text.matchAll(CELL)].map(([, letters, row]) => [columnIndex(letters), Number(row)]);
    if (!cells.length) continue;
    const columns = cells.map(([c]) => c);
    const rows = cells.map(([, r]) => r);
    budget.created += box(Math.min(...columns), Math.max(...columns), Math.min(...rows), Math.max(...rows));
    if (budget.created > MAX_CREATED_CELLS) throw new TemplateReadError("TOO_LARGE");
  }
}

/**
 * Cells in an A1 range. A range missing its rows or columns ("E:E", "3:3") counts as
 * the whole sheet when `partialIsWhole`, else as nothing. Anything unreadable is refused.
 */
function area(ref: string, partialIsWhole: boolean): number {
  const parts = ref.trim().split(":");
  const parsed = parts.map((part) => /^\$?([A-Za-z]{0,3})\$?(\d*)$/.exec(part));
  if (parts.length > 2 || parsed.some((p) => !p || (!p[1] && !p[2]))) throw new TemplateReadError("TOO_LARGE");
  const [a, b] = [parsed[0]!, parsed[parsed.length - 1]!];
  const partial = !a[1] || !a[2] || !b[1] || !b[2];
  if (partial && !partialIsWhole) return 0;
  const c1 = a[1] ? columnIndex(a[1]) : 1;
  const c2 = b[1] ? columnIndex(b[1]) : SHEET_COLUMNS;
  const r1 = a[2] ? Number(a[2]) : 1;
  const r2 = b[2] ? Number(b[2]) : SHEET_ROWS;
  return box(Math.min(c1, c2), Math.max(c1, c2), Math.min(r1, r2), Math.max(r1, r2));
}

function box(c1: number, c2: number, r1: number, r2: number): number {
  const cells = (c2 - c1 + 1) * (r2 - r1 + 1);
  if (cells > MAX_RANGE_CELLS) throw new TemplateReadError("TOO_LARGE");
  return cells;
}

function columnIndex(letters: string): number {
  return [...letters.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
}
