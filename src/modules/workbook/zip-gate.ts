import { inflateRawSync } from "node:zlib";

import { TemplateReadError } from "./template-profile";

// Inspects an .xlsx archive before the reader parses any part of it: real (inflated)
// sizes, and the ranges a workbook model would expand cell by cell (merged cells, data
// validations, defined names). It then hands the reader its parts, one entry at a time,
// inflated and decoded exactly as checked here.
//
// The gate fails closed: whenever it might read the archive or the XML differently
// from a zip library or an XML parser, it refuses instead of guessing. Sizes and
// ranges over a cap → TOO_LARGE; anything it cannot read unambiguously → NOT_A_WORKBOOK.

export const MAX_ACCOUNT_ROWS = 20_000;
export const MAX_ACCOUNT_COLUMNS = 400;

const MAX_ZIP_ENTRIES = 2_000;
// The reader holds one entry's text at a time plus compact structures, so memory follows
// the entry cap, not the workbook; the caps also bound the time spent inflating.
const MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_ENTRY_BYTES = 32 * 1024 * 1024;
/** Any single range: no larger than the biggest account sheet allowed. */
const MAX_RANGE_CELLS = MAX_ACCOUNT_ROWS * MAX_ACCOUNT_COLUMNS;
/** Cells a workbook model creates for merged ranges and defined names, per workbook. */
const MAX_CREATED_CELLS = 100_000;
/** Entries a workbook model creates for data validations, per workbook. */
const MAX_VALIDATION_CELLS = 2_000_000;
const SHEET_COLUMNS = 16_384;
const SHEET_ROWS = 1_048_576;

// ponytail: not an XML parser. A loose, case-insensitive search finds every start tag of
// a watched element; each one is then tokenized strictly, and refused if that fails.
// The ceiling is the 32 MiB per-entry cap on the text.
// Every element an XML parser reports starts with a literal "<name" in the raw text
// (entities are refused, comments and CDATA only hide tags), so the search can only
// over-match, never miss one.
const WATCHED_TAG = /<(?:[A-Za-z_][\w.-]*:)?(mergecell|datavalidation|f|dimension|definedname)(?![\w.:-])/gi;
const ATTRIBUTE_NAME = /[A-Za-z_][\w.:-]*/y;
const CELL = /\$?([A-Za-z]{1,3})\$?(\d+)/g;
const UTF8 = new TextDecoder("utf-8", { fatal: true });

const notAWorkbook = () => new TemplateReadError("NOT_A_WORKBOOK");
const tooLarge = () => new TemplateReadError("TOO_LARGE");

/** A checked archive's parts, read on demand so only one entry's text is held at a time. */
export interface WorkbookParts {
  has(name: string): boolean;
  /** The entry's text, inflated and decoded as the gate checked it; undefined when absent. Names have no leading "/". */
  read(name: string): string | undefined;
}

export function inspectWorkbookZip(bytes: Uint8Array): WorkbookParts {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // JSZip takes the last end-of-central-directory signature in the file: require it to be
  // the only one in the tail and to end exactly at the end of the file.
  let end = -1;
  for (let i = bytes.byteLength - 4; i >= Math.max(0, bytes.byteLength - 22 - 0xffff) && end < 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) end = i;
  }
  if (end < 0 || end + 22 > bytes.byteLength || end + 22 + view.getUint16(end + 20, true) !== bytes.byteLength) throw notAWorkbook();
  const count = view.getUint16(end + 10, true);
  const size = view.getUint32(end + 12, true);
  const start = view.getUint32(end + 16, true);
  if (count > MAX_ZIP_ENTRIES) throw tooLarge();
  // No gap before the end record: JSZip would otherwise shift every offset ("extra bytes").
  if (start + size !== end || view.getUint16(end + 8, true) !== count) throw notAWorkbook();

  // First gate, cheap: the sizes the central directory declares.
  const entries: Array<{ name: string; nameBytes: Uint8Array; method: number; compressedSize: number; local: number }> = [];
  const names = new Set<string>();
  let declared = 0;
  for (let i = 0, p = start; i < count; i++) {
    if (p + 46 > end || view.getUint32(p, true) !== 0x02014b50) throw notAWorkbook();
    declared += view.getUint32(p + 24, true);
    if (declared > MAX_UNCOMPRESSED_BYTES) throw tooLarge();
    const nameLength = view.getUint16(p + 28, true);
    const extraLength = view.getUint16(p + 30, true);
    if (p + 46 + nameLength + extraLength > end) throw notAWorkbook();
    const nameBytes = bytes.subarray(p + 46, p + 46 + nameLength);
    // ASCII names only, so every decoder agrees on them; no Unicode path field, which renames the entry in JSZip.
    if (nameBytes.some((b) => b < 0x20 || b > 0x7e) || hasExtraField(view, p + 46 + nameLength, extraLength, 0x7075)) throw notAWorkbook();
    const name = Buffer.from(nameBytes).toString("latin1");
    // Readers strip one leading "/"; JSZip keeps the last of two entries with the same name.
    const normalized = name.replace(/^\//, "");
    if (names.has(normalized)) throw notAWorkbook();
    names.add(normalized);
    entries.push({ name, nameBytes, method: view.getUint16(p + 10, true), compressedSize: view.getUint32(p + 20, true), local: view.getUint32(p + 42, true) });
    p += 46 + nameLength + extraLength + view.getUint16(p + 32, true);
  }

  // Second gate: the real sizes, one entry at a time, and the ranges inside the XML.
  const budget = { total: 0, created: 0, validations: 0 };
  const parts = new Map<string, { method: number; data: Uint8Array }>();
  for (const entry of entries) {
    if (entry.local + 30 > start || view.getUint32(entry.local, true) !== 0x04034b50) throw notAWorkbook();
    const localNameLength = view.getUint16(entry.local + 26, true);
    const nameStart = entry.local + 30;
    // JSZip names the entry after its local header: it must match the central directory.
    if (!Buffer.from(bytes.subarray(nameStart, nameStart + localNameLength)).equals(entry.nameBytes)) throw notAWorkbook();
    const dataStart = nameStart + localNameLength + view.getUint16(entry.local + 28, true);
    if (dataStart + entry.compressedSize > start) throw notAWorkbook();
    const compressed = bytes.subarray(dataStart, dataStart + entry.compressedSize);
    const data = inflate(compressed, entry.method, Math.min(MAX_ENTRY_BYTES, MAX_UNCOMPRESSED_BYTES - budget.total));
    budget.total += data.length;
    // Any entry whose name mentions ".xml" is scanned: a superset of the parts a reader parses.
    if (entry.name.toLowerCase().includes(".xml")) {
      scanXml(decodeXml(data), budget);
      parts.set(entry.name.replace(/^\//, ""), { method: entry.method, data: compressed });
    }
  }
  return {
    has: (name) => parts.has(name),
    read(name) {
      const part = parts.get(name);
      return part && decodeXml(inflate(part.data, part.method, MAX_ENTRY_BYTES));
    },
  };
}

function hasExtraField(view: DataView, offset: number, length: number, id: number): boolean {
  for (let p = offset; p + 4 <= offset + length; p += 4 + view.getUint16(p + 2, true)) {
    if (view.getUint16(p, true) === id) return true;
  }
  return false;
}

function inflate(data: Uint8Array, method: number, limit: number): Buffer {
  if (method === 0) {
    if (data.length > limit) throw tooLarge();
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  if (method !== 8) throw notAWorkbook();
  try {
    return inflateRawSync(data, { maxOutputLength: Math.max(1, limit) });
  } catch (error) {
    if (error instanceof RangeError || (error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") throw tooLarge();
    throw notAWorkbook();
  }
}

/**
 * Every entry is read as UTF-8, whatever the XML declares. Accept only text that is valid
 * UTF-8, has no NUL, no UTF-16/32 byte order mark and declares UTF-8 (or nothing), so the
 * gate and any parser read the same characters.
 */
function decodeXml(data: Buffer): string {
  if ((data[0] === 0xfe && data[1] === 0xff) || (data[0] === 0xff && data[1] === 0xfe) || (data[0] === 0 && data[1] === 0)) throw notAWorkbook();
  let xml: string;
  try {
    xml = UTF8.decode(data);
  } catch {
    throw notAWorkbook();
  }
  if (xml.includes("\u0000")) throw notAWorkbook();
  const declaration = /^<\?xml\b([^>]*)\?>/.exec(xml);
  const encoding = declaration && /\bencoding\s*=\s*(["'])([^"']*)\1/.exec(declaration[1]);
  if (encoding && encoding[2].toLowerCase() !== "utf-8") throw notAWorkbook();
  // Entity declarations expand on parse: a bomb of their own and text the gate cannot see.
  if (/<!(DOCTYPE|ENTITY)/i.test(xml)) throw notAWorkbook();
  return xml;
}

function scanXml(xml: string, budget: { created: number; validations: number }) {
  for (const match of xml.matchAll(WATCHED_TAG)) {
    const element = match[1].toLowerCase();
    const { attributes, end, selfClosing } = parseTag(xml, match.index + match[0].length);
    const rangeAttribute = element === "datavalidation" ? "sqref" : "ref";
    const value = attributes.get(rangeAttribute);
    if (value !== undefined && value.includes("&")) throw notAWorkbook();
    if (element === "mergecell") {
      budget.created += area(value ?? "", true);
      if (budget.created > MAX_CREATED_CELLS) throw tooLarge();
    } else if (element === "datavalidation") {
      // A whole column ("E:E") is legitimate and a workbook model does not expand it; "E1:E9" it does.
      for (const ref of (value ?? "").trim().split(/\s+/).filter(Boolean)) {
        budget.validations += area(ref, false);
        if (budget.validations > MAX_VALIDATION_CELLS) throw tooLarge();
      }
    } else if (element === "f" || element === "dimension") {
      if (value !== undefined) area(value, true);
    } else if (!selfClosing) {
      budget.created += definedNameCells(xml, end);
      if (budget.created > MAX_CREATED_CELLS) throw tooLarge();
    }
  }
}

/**
 * Tokenizes a start tag's attributes from just after its name; throws if it is not plainly well formed.
 * Attribute values are returned raw, or as `decode` returns them.
 */
export function parseTag(xml: string, from: number, decode?: (raw: string) => string) {
  const attributes = new Map<string, string>();
  let i = from;
  for (;;) {
    const before = i;
    i = skipSpace(xml, i);
    if (xml.startsWith("/>", i)) return { attributes, end: i + 2, selfClosing: true };
    if (xml[i] === ">") return { attributes, end: i + 1, selfClosing: false };
    ATTRIBUTE_NAME.lastIndex = i;
    const name = ATTRIBUTE_NAME.exec(xml)?.[0];
    if (i === before || !name) throw notAWorkbook();
    i = skipSpace(xml, i + name.length);
    if (xml[i] !== "=") throw notAWorkbook();
    i = skipSpace(xml, i + 1);
    const quote = xml[i];
    if (quote !== '"' && quote !== "'") throw notAWorkbook();
    const close = xml.indexOf(quote, i + 1);
    if (close < 0) throw notAWorkbook();
    const value = xml.slice(i + 1, close);
    if (value.includes("<") || attributes.has(name)) throw notAWorkbook();
    attributes.set(name, decode ? decode(value) : value);
    i = close + 1;
  }
}

function skipSpace(xml: string, i: number): number {
  for (let c = xml.charCodeAt(i); c === 32 || c === 9 || c === 13 || c === 10; c = xml.charCodeAt(i)) i++;
  return i;
}

/**
 * A defined name's range is its text content. Require plain text straight up to the
 * closing tag, so the text the parser joins together is exactly what is measured.
 * Bounding box of every cell it mentions: covers whatever a workbook model makes of it.
 */
function definedNameCells(xml: string, from: number): number {
  const close = xml.indexOf("<", from);
  if (close < 0 || !/^<\/(?:[A-Za-z_][\w.-]*:)?definedName\s*>/i.test(xml.slice(close, close + 128))) throw notAWorkbook();
  const text = xml.slice(from, close);
  if (text.includes("&")) throw notAWorkbook();
  const cells = [...text.matchAll(CELL)].map(([, letters, row]) => [columnIndex(letters), Number(row)]);
  if (!cells.length) return 0;
  const columns = cells.map(([c]) => c);
  const rows = cells.map(([, r]) => r);
  return box(Math.min(...columns), Math.max(...columns), Math.min(...rows), Math.max(...rows));
}

/**
 * Cells in an A1 range. A range missing its rows or columns ("E:E", "3:3") counts as
 * the whole sheet when `partialIsWhole`, else as nothing. Anything unreadable is refused.
 */
function area(ref: string, partialIsWhole: boolean): number {
  const parts = ref.trim().split(":");
  const parsed = parts.map((part) => /^\$?([A-Za-z]{0,3})\$?(\d*)$/.exec(part));
  if (parts.length > 2 || parsed.some((p) => !p || (!p[1] && !p[2]))) throw tooLarge();
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
  if (cells > MAX_RANGE_CELLS) throw tooLarge();
  return cells;
}

function columnIndex(letters: string): number {
  return [...letters.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
}
