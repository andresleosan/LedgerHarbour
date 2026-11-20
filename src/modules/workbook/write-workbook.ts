import { crc32, deflateRawSync } from "node:zlib";

import { READ_TIME_LIMIT_MS } from "./read-template";
import { columnIndex, openBook, type Book } from "./spreadsheet";
import { TEMPLATE_MAX_BYTES, TemplateReadError, type AccountSheet, type TemplateHeading, type TemplateProfile } from "./template-profile";
import { readXml } from "./xml";
import { inspectWorkbookZip, parseTag } from "./zip-gate";

// Writes the year's rows into a copy of the accountant's template by patching the
// SpreadsheetML in place: only the four input cells of the data rows and each sheet's
// opening cell change. Every other byte of a written sheet, every formula, and every
// other part of the archive stays as it was. Two parts gain one thing each: workbook.xml
// the flag that makes Excel recalculate on open, and styles.xml (only when the date
// column has no date format) one cell format. Untouched archive entries are copied with
// their original compressed bytes.
//
// Anything it would have to guess at is refused with a typed error instead.

export interface WriteRow {
  /** ISO calendar date, "2026-04-06". */
  date: string;
  narrative: string;
  /** The heading's exact template value and type. */
  code: { value: string; type: "text" | "number" };
  /** Signed pounds with two decimals, "-12.30"; never zero. */
  amount: string;
}

export interface WriteSheet {
  sheetName: string;
  /** Pounds with two decimals; null leaves the opening cell as it is. */
  openingBalance: string | null;
  rows: WriteRow[];
}

export interface WrittenSheet {
  sheetName: string;
  rowsWritten: number;
  /** Data rows whose input cells held something in the template (sample rows), all replaced or cleared. */
  clearedTemplateRows: number;
}

export interface ReadRow {
  date: string | null;
  narrative: string | null;
  code: { value: string; type: "text" | "number" } | null;
  amount: string | null;
}

export interface ReadSheet {
  sheetName: string;
  openingBalance: string | null;
  /** The data rows whose input cells hold anything, in row order. */
  rows: ReadRow[];
}

export const WORKBOOK_WRITE_ERROR_CODES = {
  UNKNOWN_SHEET: "UNKNOWN_SHEET",
  TOO_MANY_ROWS: "TOO_MANY_ROWS",
  INPUT_CELL_HAS_FORMULA: "INPUT_CELL_HAS_FORMULA",
  INPUT_CELL_MERGED: "INPUT_CELL_MERGED",
  INVALID_CODE: "INVALID_CODE",
  INVALID_AMOUNT: "INVALID_AMOUNT",
  INVALID_DATE: "INVALID_DATE",
  INVALID_NARRATIVE: "INVALID_NARRATIVE",
  DATE1904_UNSUPPORTED: "DATE1904_UNSUPPORTED",
  UNSUPPORTED_LAYOUT: "UNSUPPORTED_LAYOUT",
} as const;

export type WorkbookWriteErrorCode = (typeof WORKBOOK_WRITE_ERROR_CODES)[keyof typeof WORKBOOK_WRITE_ERROR_CODES];

export class WorkbookWriteError extends Error {
  readonly name = "WorkbookWriteError";

  constructor(readonly code: WorkbookWriteErrorCode, readonly detail: { sheet?: string; cell?: string; row?: number } = {}) {
    super(code);
  }
}

/** Built-in "short date" number format, shown as dd/mm/yyyy in a UK locale. */
const DATE_FORMAT_ID = "14";
const AMOUNT = /^-?(?:0|[1-9]\d{0,11})\.\d{2}$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Days from Excel's 1900 epoch (as it counts, with its 29 Feb 1900) to 1970-01-01. */
const UNIX_EPOCH_SERIAL = 25569;
const DAY_MS = 86_400_000;
/** 1900-03-01: earlier serials are off by one in Excel's 1900 system. */
const FIRST_SERIAL = 61;
const CELL_ADDRESS = /^([A-Z]{1,3})([1-9]\d*)$/;
const RANGE = /^\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?$/;
/** Elements that follow calcPr in a workbook: a missing calcPr goes before the first of them. */
const AFTER_CALC_PR = ["oleSize", "customWorkbookViews", "pivotCaches", "smartTagPr", "smartTagTypes", "webPublishing", "fileRecoveryPr", "webPublishObjects", "extLst"];

const fail = (code: WorkbookWriteErrorCode, detail?: WorkbookWriteError["detail"]) => new WorkbookWriteError(code, detail);
const unsupported = (sheet?: string) => fail("UNSUPPORTED_LAYOUT", { sheet });

function deadline(): () => void {
  const started = performance.now();
  return () => {
    if (performance.now() - started > READ_TIME_LIMIT_MS) throw new TemplateReadError("TOO_LARGE");
  };
}

function openChecked(bytes: Uint8Array) {
  if (bytes.byteLength > TEMPLATE_MAX_BYTES) throw new TemplateReadError("TOO_LARGE");
  const parts = inspectWorkbookZip(bytes);
  return { parts, book: openBook(parts, deadline()) };
}

/**
 * Headings a row may be coded with: unblocked, and the only heading Excel's "=" would
 * match (text compares case-insensitively, a number only matches a number).
 */
export function usableHeadings(profile: TemplateProfile): TemplateHeading[] {
  const key = (h: TemplateHeading) => (h.valueType === "number" ? `n:${Number(h.templateValue)}` : `t:${h.templateValue.toLowerCase()}`);
  const counts = new Map<string, number>();
  for (const heading of profile.headings) counts.set(key(heading), (counts.get(key(heading)) ?? 0) + 1);
  return profile.headings.filter((heading) => heading.blockedReason === null && counts.get(key(heading)) === 1);
}

/** Text as it is written to a cell: characters XML 1.0 forbids are removed. */
export function cellText(text: string): string {
  return text.replace(/[^\t\n\r\x20-퟿-�\u{10000}-\u{10FFFF}]/gu, "");
}

export function fillWorkbook(templateBytes: Uint8Array, profile: TemplateProfile, sheets: WriteSheet[]): { bytes: Buffer; written: WrittenSheet[] } {
  const { parts, book } = openChecked(templateBytes);
  const changed = new Map<string, string>();

  const workbookXml = parts.read("xl/workbook.xml") ?? "";
  const workbookPr = tagAt(workbookXml, "workbookPr");
  const date1904 = workbookPr?.attributes.get("date1904");
  if (date1904 === "1" || date1904 === "true") throw fail("DATE1904_UNSUPPORTED");
  changed.set("xl/workbook.xml", withFullCalcOnLoad(workbookXml));

  const codes = usableHeadings(profile);
  const seen = new Set<string>();
  const plans = sheets.map((spec) => {
    const sheet = profile.sheets.find((s) => s.name === spec.sheetName);
    const info = book.sheets.find((s) => s.name === spec.sheetName);
    if (!sheet || !info || seen.has(spec.sheetName)) throw fail("UNKNOWN_SHEET", { sheet: spec.sheetName });
    seen.add(spec.sheetName);
    if (spec.rows.length > sheet.safeLastRow - sheet.firstDataRow + 1) throw fail("TOO_MANY_ROWS", { sheet: sheet.name });
    if (spec.openingBalance !== null && !AMOUNT.test(spec.openingBalance)) throw fail("INVALID_AMOUNT", { sheet: sheet.name });
    const rows = spec.rows.map((row, index) => {
      const at = { sheet: sheet.name, row: sheet.firstDataRow + index };
      if (typeof row.amount !== "string" || !AMOUNT.test(row.amount) || /^-?0\.00$/.test(row.amount)) throw fail("INVALID_AMOUNT", at);
      const heading = codes.find((h) => h.valueType === row.code?.type && h.templateValue === row.code.value);
      if (!heading) throw fail("INVALID_CODE", at);
      if (typeof row.narrative !== "string") throw fail("INVALID_NARRATIVE", at);
      return { serial: dateSerial(row.date, at), narrative: row.narrative, code: row.code, amount: row.amount };
    });
    return { sheet, part: info.part, opening: spec.openingBalance, rows };
  });

  const styles = dateStyles(book);
  const written = plans.map(({ sheet, part, opening, rows }) => {
    const result = patchSheet(parts.read(part)!, sheet, opening, rows, styles.styleFor);
    changed.set(part, result.xml);
    return { sheetName: sheet.name, rowsWritten: rows.length, clearedTemplateRows: result.cleared };
  });
  if (styles.added.length) changed.set("xl/styles.xml", withDateFormats(parts.read("xl/styles.xml")!, styles.added));

  return { bytes: rezip(templateBytes, changed), written };
}

/** Re-reads the input cells an export wrote, per account sheet of `profile`. */
export function readWrittenRows(bytes: Uint8Array, profile: TemplateProfile): ReadSheet[] {
  const { parts, book } = openChecked(bytes);
  const check = deadline();
  return profile.sheets.map((sheet) => {
    const info = book.sheets.find((s) => s.name === sheet.name);
    if (!info) throw fail("UNKNOWN_SHEET", { sheet: sheet.name });
    const columns = [sheet.dateColumn, sheet.narrativeColumn, sheet.codeColumn, sheet.amountColumn];
    const opening = parseAddress(sheet.openingBalanceCell);
    const cells = readCells(parts.read(info.part)!, book, check, (row, column) =>
      (row === opening.row && column === opening.column) || (row >= sheet.firstDataRow && row <= sheet.lastDataRow && columns.includes(column)));
    const at = (row: number, column: number) => cells.get(`${row}:${column}`) ?? null;
    const rows: ReadRow[] = [];
    for (let row = sheet.firstDataRow; row <= sheet.lastDataRow; row++) {
      const [date, narrative, code, amount] = columns.map((column) => at(row, column));
      if (!date && !narrative && !code && !amount) continue;
      rows.push({
        date: date && (date.kind === "number" ? serialDate(date.text) : date.text),
        narrative: narrative && narrative.text,
        code: code && (code.kind === "number" ? { value: String(Number(code.text)), type: "number" } : { value: code.text, type: "text" }),
        amount: amount && (amount.kind === "number" ? exactPounds(amount.text) : amount.text),
      });
    }
    const openingCell = at(opening.row, opening.column);
    return { sheetName: sheet.name, openingBalance: openingCell && (openingCell.kind === "number" ? exactPounds(openingCell.text) : openingCell.text), rows };
  });
}

// ---------------------------------------------------------------- values

function dateSerial(date: unknown, at: WorkbookWriteError["detail"]): number {
  const match = typeof date === "string" ? ISO_DATE.exec(date) : null;
  if (!match) throw fail("INVALID_DATE", at);
  const [year, month, day] = match.slice(1).map(Number);
  const ms = Date.UTC(year, month - 1, day);
  const parsed = new Date(ms);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) throw fail("INVALID_DATE", at);
  const serial = ms / DAY_MS + UNIX_EPOCH_SERIAL;
  if (serial < FIRST_SERIAL) throw fail("INVALID_DATE", at);
  return serial;
}

function serialDate(text: string): string {
  const serial = Number(text);
  if (!Number.isInteger(serial) || serial < FIRST_SERIAL) return text;
  return new Date((serial - UNIX_EPOCH_SERIAL) * DAY_MS).toISOString().slice(0, 10);
}

/** A number cell's text as pounds with two decimals, exactly; any other text is returned as it is. */
function exactPounds(text: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match || /[1-9]/.test((match[3] ?? "").slice(2))) return text;
  return `${match[1]}${match[2].replace(/^0+(?=\d)/, "")}.${(match[3] ?? "").slice(0, 2).padEnd(2, "0")}`;
}

/**
 * Escapes text for a cell's `<t>`: Excel reads `_xHHHH_` in cell text as a character,
 * so a literal one is escaped with `_x005F_` (an underscore).
 */
function escapeText(text: string): string {
  return cellText(text)
    .replace(/_x[0-9A-Fa-f]{4}_/g, (match) => `_x005F${match}`)
    .replace(/[&<>\r]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\r": "&#13;" })[ch]!);
}

function unescapeText(text: string): string {
  return text.replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

// ---------------------------------------------------------------- workbook.xml and styles.xml

/** The first start tag named `name`, with its raw attributes and position. */
function tagAt(xml: string, name: string) {
  const match = new RegExp(`<${name}(?=[\\s/>])`).exec(xml);
  if (!match) return null;
  const tag = parseTag(xml, match.index + match[0].length);
  return { start: match.index, ...tag };
}

function withFullCalcOnLoad(xml: string): string {
  const calcPr = tagAt(xml, "calcPr");
  if (calcPr) {
    const raw = xml.slice(calcPr.start, calcPr.end);
    const patched = /\sfullCalcOnLoad\s*=\s*(["'])[^"']*\1/.test(raw)
      ? raw.replace(/(\sfullCalcOnLoad\s*=\s*)(["'])[^"']*\2/, '$1"1"')
      : raw.replace(/\s*(\/?>)$/, ' fullCalcOnLoad="1"$1');
    return xml.slice(0, calcPr.start) + patched + xml.slice(calcPr.end);
  }
  const before = AFTER_CALC_PR.map((name) => tagAt(xml, name)?.start ?? -1).filter((at) => at >= 0);
  const at = before.length ? Math.min(...before) : xml.lastIndexOf("</workbook");
  if (at < 0) throw unsupported();
  return `${xml.slice(0, at)}<calcPr fullCalcOnLoad="1"/>${xml.slice(at)}`;
}

/** Maps a date cell's style to one that shows a date, adding a copy of a non-date style with format 14. */
function dateStyles(book: Book) {
  const added: number[] = [];
  const mapped = new Map<number, number>();
  const styleFor = (style: number): number => {
    if (book.styles?.dates.has(style)) return style;
    if (!book.styles) throw unsupported();
    if (!mapped.has(style)) {
      mapped.set(style, book.styles.count + added.length);
      added.push(style);
    }
    return mapped.get(style)!;
  };
  return { added, styleFor };
}

function withDateFormats(xml: string, styles: number[]): string {
  const open = tagAt(xml, "cellXfs");
  const close = open ? xml.indexOf("</cellXfs>", open.end) : -1;
  if (!open || open.selfClosing || close < 0) throw unsupported();
  const xfs: string[] = [];
  let i = open.end;
  for (;;) {
    while (/\s/.test(xml[i])) i++;
    if (i >= close) break;
    if (!xml.startsWith("<xf", i) || !/[\s/>]/.test(xml[i + 3])) throw unsupported();
    const tag = parseTag(xml, i + 3);
    const end = tag.selfClosing ? tag.end : xml.indexOf("</xf>", tag.end) + 5;
    if (end < tag.end) throw unsupported();
    xfs.push(xml.slice(i, end));
    i = end;
  }
  const copies = styles.map((style) => {
    const xf = xfs[style];
    if (xf === undefined) throw unsupported();
    let copy = /\snumFmtId\s*=\s*(["'])[^"']*\1/.test(xf) ? xf.replace(/(\snumFmtId\s*=\s*)(["'])[^"']*\2/, `$1"${DATE_FORMAT_ID}"`) : xf.replace(/^<xf/, `<xf numFmtId="${DATE_FORMAT_ID}"`);
    copy = /\sapplyNumberFormat\s*=/.test(copy) ? copy.replace(/(\sapplyNumberFormat\s*=\s*)(["'])[^"']*\2/, '$1"1"') : copy.replace(/^<xf/, '<xf applyNumberFormat="1"');
    return copy;
  });
  const count = xfs.length + copies.length;
  const head = xml.slice(open.start, open.end);
  const newHead = /\scount\s*=/.test(head) ? head.replace(/(\scount\s*=\s*)(["'])[^"']*\2/, `$1"${count}"`) : head;
  return xml.slice(0, open.start) + newHead + xml.slice(open.end, close) + copies.join("") + xml.slice(close);
}

// ---------------------------------------------------------------- sheets

interface PlannedRow {
  serial: number;
  narrative: string;
  code: WriteRow["code"];
  amount: string;
}

type CellWrite = { kind: "number"; text: string; date?: boolean } | { kind: "text"; text: string } | { kind: "clear" };

/**
 * Rewrites the cells of the data rows' input columns and the opening cell; every other
 * byte of the sheet is copied. Rows and cells are found with the strict tag reader.
 */
function patchSheet(xml: string, sheet: AccountSheet, opening: string | null, rows: PlannedRow[], styleFor: (style: number) => number) {
  const open = /<sheetData\s*>/.exec(xml);
  const close = open ? xml.indexOf("</sheetData", open.index) : -1;
  if (!open || close < 0 || xml.indexOf("<sheetData", open.index + 1) >= 0) throw unsupported(sheet.name);

  const columnStyles = colStyles(xml.slice(0, open.index), sheet.name);
  const merges = [...xml.slice(close).matchAll(/<mergeCell(?=[\s/>])/g)].map((m) => {
    const ref = parseTag(xml, close + m.index + m[0].length).attributes.get("ref") ?? "";
    const range = RANGE.exec(ref);
    if (!range) throw unsupported(sheet.name);
    const [c1, r1] = [columnIndex(range[1]), Number(range[2])];
    const [c2, r2] = range[3] ? [columnIndex(range[3]), Number(range[4])] : [c1, r1];
    return { c1: Math.min(c1, c2), c2: Math.max(c1, c2), r1: Math.min(r1, r2), r2: Math.max(r1, r2) };
  });
  const arrays: typeof merges = [];

  const openingCell = parseAddress(sheet.openingBalanceCell);
  const inputs = [sheet.dateColumn, sheet.narrativeColumn, sheet.codeColumn, sheet.amountColumn];
  /** What to write in each targeted row, by column; rows past the written ones are cleared. */
  const targets = (row: number): Map<number, CellWrite> | null => {
    const writes = new Map<number, CellWrite>();
    if (row === openingCell.row && opening !== null) writes.set(openingCell.column, { kind: "number", text: opening });
    if (row >= sheet.firstDataRow && row <= sheet.lastDataRow) {
      const planned = rows[row - sheet.firstDataRow];
      if (!planned) for (const column of inputs) writes.set(column, { kind: "clear" });
      else {
        writes.set(sheet.dateColumn, { kind: "number", text: String(planned.serial), date: true });
        writes.set(sheet.narrativeColumn, { kind: "text", text: planned.narrative });
        writes.set(sheet.codeColumn, planned.code.type === "number" ? { kind: "number", text: planned.code.value } : { kind: "text", text: planned.code.value });
        writes.set(sheet.amountColumn, { kind: "number", text: planned.amount });
      }
    }
    return writes.size ? writes : null;
  };
  /** Rows that must exist: the opening row and the written rows. */
  const needed = [...(opening !== null ? [openingCell.row] : []), ...rows.map((_, i) => sheet.firstDataRow + i)].sort((a, b) => a - b);

  let cleared = 0;
  const out: string[] = [];
  let cursor = 0;
  let i = open.index + open[0].length;
  let previous = 0;
  const createRowsBefore = (row: number, at: number) => {
    while (needed.length && needed[0] < row) {
      const number = needed.shift()!;
      out.push(xml.slice(cursor, at), patchRow(number, null, [], targets(number)!));
      cursor = at;
    }
  };

  for (;;) {
    while (/\s/.test(xml[i])) i++;
    if (i >= close) break;
    if (!xml.startsWith("<row", i) || !/[\s/>]/.test(xml[i + 4])) throw unsupported(sheet.name);
    const start = i;
    const tag = parseTag(xml, i + 4);
    const number = Number(tag.attributes.get("r"));
    if (!Number.isInteger(number) || number <= previous) throw unsupported(sheet.name);
    previous = number;
    const cells: Array<{ column: number; start: number; end: number; style: string | undefined; inner: string }> = [];
    i = tag.end;
    if (!tag.selfClosing) {
      for (;;) {
        while (/\s/.test(xml[i])) i++;
        const end = /^<\/row\s*>/.exec(xml.slice(i, i + 16));
        if (end) {
          i += end[0].length;
          break;
        }
        if (!xml.startsWith("<c", i) || !/[\s/>]/.test(xml[i + 2])) throw unsupported(sheet.name);
        const cellTag = parseTag(xml, i + 2);
        const address = CELL_ADDRESS.exec(cellTag.attributes.get("r") ?? "");
        if (!address || Number(address[2]) !== number) throw unsupported(sheet.name);
        let cellEnd = cellTag.end;
        if (!cellTag.selfClosing) {
          const closing = /<\/c\s*>/g;
          closing.lastIndex = cellTag.end;
          const found = closing.exec(xml);
          if (!found || found.index > close) throw unsupported(sheet.name);
          cellEnd = found.index + found[0].length;
        }
        const inner = xml.slice(cellTag.end, cellTag.selfClosing ? cellTag.end : xml.lastIndexOf("<", cellEnd - 1));
        const column = columnIndex(address[1]);
        if (/<f[\s>]/.test(inner) && /\st\s*=\s*["']array["']/.test(inner)) {
          const ref = RANGE.exec(/\sref\s*=\s*["']([^"']*)["']/.exec(inner)?.[1] ?? "");
          if (ref) {
            const [c2, r2] = ref[3] ? [columnIndex(ref[3]), Number(ref[4])] : [column, number];
            arrays.push({ c1: column, c2, r1: number, r2 });
          }
        }
        cells.push({ column, start: i, end: cellEnd, style: cellTag.attributes.get("s"), inner });
        i = cellEnd;
      }
    }
    createRowsBefore(number, start);
    if (needed[0] === number) needed.shift();
    const writes = targets(number);
    if (!writes) continue;

    if (number >= sheet.firstDataRow && number <= sheet.lastDataRow
      && cells.some((cell) => inputs.includes(cell.column) && /<(v|is)[\s>]/.test(cell.inner))) cleared++;
    const rowStyle = /^(1|true)$/.test(tag.attributes.get("customFormat") ?? "") ? tag.attributes.get("s") : undefined;
    const effective = (column: number) => Number(rowStyle ?? columnStyles(column) ?? 0);
    out.push(xml.slice(cursor, start), patchRow(number, { raw: xml.slice(start, tag.end), selfClosing: tag.selfClosing }, cells.map((cell) => ({
      ...cell,
      raw: xml.slice(cell.start, cell.end),
    })), writes, effective));
    cursor = i;
  }
  createRowsBefore(Infinity, close);
  out.push(xml.slice(cursor));
  return { xml: out.join(""), cleared };

  function patchRow(
    number: number,
    rowTag: { raw: string; selfClosing: boolean } | null,
    cells: Array<{ column: number; style: string | undefined; inner: string; raw: string }>,
    writes: Map<number, CellWrite>,
    effective: (column: number) => number = (column) => Number(columnStyles(column) ?? 0),
  ): string {
    for (const [column, write] of writes) {
      const at = { sheet: sheet.name, cell: `${columnLetter(column)}${number}` };
      const existing = cells.find((c) => c.column === column);
      if (existing && /<f[\s/>]/.test(existing.inner)) throw fail("INPUT_CELL_HAS_FORMULA", at);
      if (write.kind === "clear" && !(existing && /<(v|is)[\s>]/.test(existing.inner))) continue;
      if (arrays.some((r) => inside(r, number, column))) throw fail("INPUT_CELL_HAS_FORMULA", at);
      if (merges.some((r) => inside(r, number, column))) throw fail("INPUT_CELL_MERGED", at);
    }
    const body: string[] = [];
    const missing = [...writes].filter(([column, write]) => write.kind !== "clear" && !cells.some((c) => c.column === column)).sort(([a], [b]) => a - b);
    const emitMissing = (before: number) => {
      while (missing.length && missing[0][0] < before) {
        const [column, write] = missing.shift()!;
        body.push(cellXml(column, number, effective(column), write));
      }
    };
    for (const cell of cells) {
      emitMissing(cell.column);
      const write = writes.get(cell.column);
      const hasValue = /<(v|is)[\s>]/.test(cell.inner);
      if (!write || (write.kind === "clear" && !hasValue)) body.push(cell.raw);
      else body.push(cellXml(cell.column, number, cell.style === undefined ? 0 : Number(cell.style), write));
    }
    emitMissing(Infinity);
    if (!rowTag) return `<row r="${number}">${body.join("")}</row>`;
    if (!rowTag.selfClosing) return `${rowTag.raw}${body.join("")}</row>`;
    return body.length ? `${rowTag.raw.replace(/\s*\/>$/, ">")}${body.join("")}</row>` : rowTag.raw;
  }

  function cellXml(column: number, row: number, style: number, write: CellWrite): string {
    const s = write.kind === "number" && write.date ? styleFor(style) : style;
    const head = `<c r="${columnLetter(column)}${row}"${s ? ` s="${s}"` : ""}`;
    if (write.kind === "clear") return `${head}/>`;
    if (write.kind === "number") return `${head}><v>${write.text}</v></c>`;
    return `${head} t="inlineStr"><is><t xml:space="preserve">${escapeText(write.text)}</t></is></c>`;
  }
}

/** Style of each column from `<cols>`, which a new cell in a row without its own style takes. */
function colStyles(head: string, sheetName: string): (column: number) => string | undefined {
  const cols = [...head.matchAll(/<col(?=[\s/>])/g)].map((m) => {
    const { attributes } = parseTag(head, m.index + m[0].length);
    const [min, max] = [Number(attributes.get("min")), Number(attributes.get("max"))];
    if (!Number.isInteger(min) || !Number.isInteger(max)) throw unsupported(sheetName);
    return { min, max, style: attributes.get("style") };
  });
  return (column) => cols.find((c) => c.min <= column && column <= c.max)?.style;
}

function inside(range: { c1: number; c2: number; r1: number; r2: number }, row: number, column: number): boolean {
  return range.r1 <= row && row <= range.r2 && range.c1 <= column && column <= range.c2;
}

function parseAddress(address: string): { row: number; column: number } {
  const match = CELL_ADDRESS.exec(address);
  if (!match) throw unsupported();
  return { row: Number(match[2]), column: columnIndex(match[1]) };
}

function columnLetter(index: number): string {
  let letters = "";
  for (let n = index; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  return letters;
}

/** Wanted cells' values, as number text or text, read with the strict tokenizer. */
function readCells(xml: string, book: Book, check: () => void, wanted: (row: number, column: number) => boolean) {
  const cells = new Map<string, { kind: "number" | "text"; text: string }>();
  const path: string[] = [];
  let cell: { key: string; type: string | undefined; v: string | undefined; is: string | undefined } | null = null;
  readXml(xml, {
    open(name, attributes) {
      path.push(name);
      if (name !== "c" || path.length !== 4) return;
      const address = CELL_ADDRESS.exec(attributes.get("r") ?? "");
      if (!address) throw unsupported();
      const [row, column] = [Number(address[2]), columnIndex(address[1])];
      cell = wanted(row, column) ? { key: `${row}:${column}`, type: attributes.get("t"), v: undefined, is: undefined } : null;
    },
    text(text) {
      if (!cell) return;
      const name = path[path.length - 1];
      if (name === "v" && path.length === 5) cell.v = (cell.v ?? "") + text;
      else if (name === "t" && path[4] === "is" && (path.length === 6 || (path.length === 7 && path[5] === "r"))) cell.is = (cell.is ?? "") + text;
    },
    close(name) {
      path.pop();
      if (name !== "c" || !cell) return;
      const { key, type, v, is } = cell;
      if (type === "inlineStr" && is !== undefined) cells.set(key, { kind: "text", text: unescapeText(is) });
      else if (type === "s" && v !== undefined) cells.set(key, { kind: "text", text: book.strings?.[Number(v)] ?? "" });
      else if (v !== undefined) cells.set(key, { kind: !type || type === "n" ? "number" : "text", text: v });
      cell = null;
    },
  }, check);
  return cells;
}

// ---------------------------------------------------------------- archive

/**
 * A new archive with the same entries in the same order. Unchanged entries keep their
 * compressed bytes, method, CRC and times; changed ones are deflated again. No data
 * descriptors, extra fields or comments are written.
 */
function rezip(bytes: Uint8Array, changed: Map<string, string>): Buffer {
  const source = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = source.length - 22;
  while (end >= 0 && source.readUInt32LE(end) !== 0x06054b50) end--;
  const count = source.readUInt16LE(end + 10);
  const locals: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (let i = 0, p = source.readUInt32LE(end + 16); i < count; i++) {
    const nameLength = source.readUInt16LE(p + 28);
    const name = source.subarray(p + 46, p + 46 + nameLength);
    const local = source.readUInt32LE(p + 42);
    const dataStart = local + 30 + source.readUInt16LE(local + 26) + source.readUInt16LE(local + 28);
    const text = changed.get(name.toString("latin1").replace(/^\//, ""));
    const plain = text === undefined ? null : Buffer.from(text, "utf8");
    const data = plain ? deflateRawSync(plain) : source.subarray(dataStart, dataStart + source.readUInt32LE(p + 20));
    const header = {
      versionNeeded: Math.max(source.readUInt16LE(p + 6), plain ? 20 : 0),
      flags: source.readUInt16LE(p + 8) & ~0x0008,
      method: plain ? 8 : source.readUInt16LE(p + 10),
      time: source.readUInt16LE(p + 12),
      date: source.readUInt16LE(p + 14),
      crc: plain ? crc32(plain) : source.readUInt32LE(p + 16),
      size: plain ? plain.length : source.readUInt32LE(p + 24),
    };
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(header.versionNeeded, 4);
    localHeader.writeUInt16LE(header.flags, 6);
    localHeader.writeUInt16LE(header.method, 8);
    localHeader.writeUInt16LE(header.time, 10);
    localHeader.writeUInt16LE(header.date, 12);
    localHeader.writeUInt32LE(header.crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(header.size, 22);
    localHeader.writeUInt16LE(nameLength, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(source.readUInt16LE(p + 4), 4);
    localHeader.copy(central, 6, 4, 26);
    central.writeUInt16LE(nameLength, 28);
    central.writeUInt16LE(source.readUInt16LE(p + 36), 36);
    central.writeUInt32LE(source.readUInt32LE(p + 38), 38);
    central.writeUInt32LE(offset, 42);
    locals.push(localHeader, name, data);
    directory.push(central, name);
    offset += 30 + nameLength + data.length;
    p += 46 + nameLength + source.readUInt16LE(p + 30) + source.readUInt16LE(p + 32);
  }
  const directoryBytes = Buffer.concat(directory);
  const record = Buffer.alloc(22);
  record.writeUInt32LE(0x06054b50, 0);
  record.writeUInt16LE(count, 8);
  record.writeUInt16LE(count, 10);
  record.writeUInt32LE(directoryBytes.length, 12);
  record.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directoryBytes, record]);
}
