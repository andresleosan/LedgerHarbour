import { shiftFormula } from "./shift-formula";
import { TemplateReadError } from "./template-profile";
import { readXml, type XmlHandler } from "./xml";
import type { WorkbookParts } from "./zip-gate";

// Reads the SpreadsheetML parts the template reader needs, straight from the archive:
// the sheet list, shared strings and which styles are dates, then one sheet at a time
// as a stream of cells. Nothing here keeps a sheet: a caller that needs a cell keeps it.
//
// Cell values follow what the profile has always read from the previous reader (exceljs
// 4.4.0): a number in a date style, an error, a hyperlinked cell or a formula's cached
// result reads as "" — never as the number; a merged cell reads as its range's top-left
// cell; a shared-formula clone has its master's formula moved to the clone. Anything
// that reader could not load, or that would be read two ways, is refused.

/** What the profile reads from a cell: rich text, booleans and errors come as text. */
export type CellValue = null | number | string;

export interface SharedMaster {
  row: number;
  column: number;
  text: string;
}

export interface SheetCell {
  row: number;
  column: number;
  value: CellValue;
  /** The formula's own text; null for a value, or for a clone that takes its master's (see formulaOf). */
  text: string | null;
  /** For a shared-formula clone without text of its own: the master it is moved from. */
  master: SharedMaster | null;
}

export interface SheetInfo {
  name: string;
  part: string;
  rels: string;
}

export interface Book {
  parts: WorkbookParts;
  sheets: SheetInfo[];
  strings: string[] | null;
  /** Indexes of the cell styles that show numbers as dates; null when there is no styles part. */
  styles: { dates: Set<number>; count: number } | null;
}

export interface SheetScan {
  /** The last row number in use, merged ranges included. */
  rows: number;
  /** The widest row that holds a value, in columns, merged ranges included. */
  columns: number;
  /** The value of a cell the stream did not report: a merged cell's, or null. */
  valueAt(row: number, column: number): CellValue;
}

const MAX_COLUMNS = 16_384;
const MAX_ROWS = 1_048_576;
/** Excel's own limit on a formula's length, in characters. */
const MAX_FORMULA_LENGTH = 8_192;
const WORKSHEET_PART = /xl\/worksheets\/sheet(\d+)[.]xml/;
const CELL_ADDRESS = /^([A-Z]{1,3})([1-9]\d*)$/;
const RANGE = /^\$?([A-Z]{1,3})\$?([1-9]\d*)(?::\$?([A-Z]{1,3})\$?([1-9]\d*))?$/;
const SHEET_DATA_END = /<\/sheetData\s*>|<sheetData\s*\/>/g;
/** Built-in number formats that show a date or a time. */
const DATE_FORMAT_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
/** Elements whose content becomes cells, merges or links wherever they are nested: refused out of place. */
const STRUCTURAL = new Set(["worksheet", "sheetData", "row", "c", "mergeCells", "mergeCell", "hyperlinks", "hyperlink"]);
/** Cell parts that hold text only. */
const LEAVES = new Set(["f", "v", "isT", "rT"]);

const notAWorkbook = () => new TemplateReadError("NOT_A_WORKBOOK");
/** A copy that does not keep the (possibly large) text it was sliced from alive. */
export const own = (text: string) => (" " + text).slice(1);
const key = (row: number, column: number) => row * MAX_COLUMNS + column - 1;

export function formulaOf(cell: SheetCell | undefined): string | null {
  if (!cell) return null;
  if (cell.text !== null || !cell.master) return cell.text;
  return shiftFormula(cell.master.text, cell.row - cell.master.row, cell.column - cell.master.column);
}

export function columnIndex(letters: string): number {
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + letters.charCodeAt(i) - 64;
  return n;
}

export function openBook(parts: WorkbookParts, check: () => void): Book {
  const rels = readRels(parts, "xl/_rels/workbook.xml.rels", check);
  const sheets: SheetInfo[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  const used = new Set<string>();
  for (const sheet of readElements(parts, "xl/workbook.xml", "workbook", ["workbook", "sheets", "sheet"], check)) {
    const rel = rels?.get(sheet.get("r:id") ?? "");
    if (!rel) continue;
    if (rel.target === undefined) throw notAWorkbook();
    const part = `xl/${rel.target.replace(/^(\s|\/xl\/)+/, "")}`;
    const number = WORKSHEET_PART.exec(part)?.[1];
    // Chart sheets and other parts are not worksheets: skipped, as before.
    if (number === undefined || !parts.has(part)) continue;
    const name = decodeAgain(sheet.get("name"));
    const id = sheet.get("sheetId") ?? "";
    const valid = /^[1-9]\d{0,8}$/.test(id) && name !== "" && name !== "History" && name.length <= 31
      && !/[*?:/\\[\]]/.test(name) && !/^'|'$/.test(name);
    if (!valid || ids.has(id) || names.has(name.toLowerCase()) || used.has(part)) throw notAWorkbook();
    ids.add(id);
    names.add(name.toLowerCase());
    used.add(part);
    sheets.push({ name: own(name), part, rels: `xl/worksheets/_rels/sheet${number}.xml.rels` });
  }
  return { parts, sheets, strings: readStrings(parts, check), styles: readStyles(parts, check) };
}

/**
 * Streams a sheet's cells in row order. Merged ranges and hyperlinks come after the cells
 * in the file but change them, so they are read first from the end of the sheet, and the
 * full reading checks it found exactly the same ones there.
 */
export function readSheet(book: Book, sheet: SheetInfo, onCell: (cell: SheetCell) => void, check: () => void): SheetScan {
  check();
  const xml = book.parts.read(sheet.part)!;
  let tailStart = -1;
  for (const match of xml.matchAll(SHEET_DATA_END)) tailStart = match.index + match[0].length;
  const tail: string[] = [];
  if (tailStart >= 0) {
    readXml(xml, {
      open(name, attributes) {
        if (name === "mergeCell" || name === "hyperlink") tail.push(trailer(name, attributes));
      },
      close() {},
    }, check, tailStart, true);
  }

  const merges = mergeMap(tail);
  const linked = hyperlinks(book, sheet, tail, check);
  const masterValues = new Map<number, CellValue>();
  const formulae = new Map<string, SharedMaster | { text: null }>();
  const found: string[] = [];
  const contexts: string[] = [];
  let sheetData = 0;
  let row = 0;
  let rowWidth = 0;
  let rowHasValues = false;
  let lastColumn = 0;
  let rows = 0;
  let columns = 0;
  const seenMergeRows = new Set<number>();
  let cell: {
    column: number; address: string; style: number; type: string | undefined; f: boolean; v: boolean; is: boolean;
    formula: string | undefined; share: string | undefined; si: string | undefined; ref: string | undefined;
    value: string | undefined; runs: string[] | null; run: string | undefined; runTexts: number;
  } | null = null;

  const endRow = () => {
    const merged = merges.rows.get(row);
    if (merged) seenMergeRows.add(row);
    if (rowHasValues || merged?.slave) columns = Math.max(columns, rowWidth, merged?.right ?? 0);
  };

  const handler: XmlHandler = {
    open(name, attributes) {
      const context = contexts[contexts.length - 1];
      let next = "other";
      if (context === "c") {
        if ((name !== "f" && name !== "v" && name !== "is") || cell![name]) throw notAWorkbook();
        cell![name] = true;
        if (name === "f") {
          cell!.share = attributes.get("t");
          cell!.si = attributes.get("si");
          cell!.ref = attributes.get("ref");
        }
        next = name;
      } else if (context === "row") {
        if (name !== "c") throw notAWorkbook();
        const address = attributes.get("r") ?? "";
        const match = CELL_ADDRESS.exec(address);
        const column = match ? columnIndex(match[1]) : 0;
        if (!match || Number(match[2]) !== row || column > MAX_COLUMNS || column <= lastColumn) throw notAWorkbook();
        lastColumn = column;
        const s = attributes.get("s");
        cell = {
          column, address, style: s ? parseInt(s, 10) : 0, type: attributes.get("t"), f: false, v: false, is: false,
          formula: undefined, share: undefined, si: undefined, ref: undefined, value: undefined, runs: null, run: undefined, runTexts: 0,
        };
        next = "c";
      } else if (context === "sheetData") {
        if (name !== "row") throw notAWorkbook();
        const number = attributes.get("r") ?? "";
        if (!/^[1-9]\d*$/.test(number) || Number(number) > MAX_ROWS || Number(number) <= row) throw notAWorkbook();
        row = Number(number);
        rows = row;
        rowWidth = 0;
        rowHasValues = false;
        lastColumn = 0;
        next = "row";
      } else if (context === undefined) {
        if (name !== "worksheet") throw notAWorkbook();
        next = "worksheet";
      } else if (context === "worksheet" && name === "sheetData") {
        if (sheetData++) throw notAWorkbook();
        next = "sheetData";
      } else if (context === "worksheet" && (name === "mergeCells" || name === "hyperlinks")) {
        next = name;
      } else if ((context === "mergeCells" && name === "mergeCell") || (context === "hyperlinks" && name === "hyperlink")) {
        found.push(trailer(name, attributes));
        next = "leaf";
      } else if (context === "is") {
        if (name === "t") next = "isT";
        else if (name === "r") {
          (cell!.runs ??= []);
          cell!.run = undefined;
          cell!.runTexts = 0;
          next = "r";
        } else if (name === "rPh" || name === "phoneticPr") next = "ignore";
        else throw notAWorkbook();
      } else if (context === "r") {
        if (name === "rPr") next = "ignore";
        else if (name === "t" && !cell!.runTexts++) next = "rT";
        else throw notAWorkbook();
      } else if (LEAVES.has(context) || STRUCTURAL.has(name)) {
        throw notAWorkbook();
      } else if (context === "ignore") {
        next = "ignore";
      }
      contexts.push(next);
    },
    text(text) {
      const context = contexts[contexts.length - 1];
      if (context === "f") cell!.formula = (cell!.formula ?? "") + text;
      else if (context === "v" || context === "isT") cell!.value = (cell!.value ?? "") + text;
      else if (context === "rT") cell!.run = (cell!.run ?? "") + text;
    },
    close() {
      const context = contexts.pop();
      if (context === "r") cell!.runs!.push(unescapeText(cell!.run ?? ""));
      else if (context === "row") endRow();
      else if (context === "c") {
        emit(cell!);
        cell = null;
      }
    },
  };

  const emit = (c: NonNullable<typeof cell>) => {
    let value: CellValue = null;
    let text: string | null = null;
    let master: SharedMaster | null = null;
    let created = true;
    let formula = false;
    if (c.formula || c.share) {
      // Longer than Excel allows: only a crafted file, and each clone would copy it.
      if ((c.formula?.length ?? 0) > MAX_FORMULA_LENGTH) throw new TemplateReadError("TOO_LARGE");
      // The work on a formula (and its clones' moved text) grows with its length: look at the clock each time.
      check();
      formula = true;
      value = "";
      text = c.formula ?? null;
      if (c.share === "shared" && !c.ref && text === null) {
        const shared = formulae.get(String(c.si));
        // The previous reader failed on a clone whose master has no formula left.
        if (shared && shared.text === null) throw notAWorkbook();
        master = (shared as SharedMaster | undefined) ?? null;
      }
    } else if (c.runs) {
      if (c.value !== undefined || c.type !== "inlineStr") throw notAWorkbook();
      value = c.runs.join("");
    } else if (c.value !== undefined) {
      value = typedValue(book, c.type, c.value, c.style);
    } else if (!c.style) {
      created = false;
    }
    if (c.style && book.styles?.count === 0) throw notAWorkbook();
    if (linked.has(c.address)) {
      [value, text, master, created, formula] = ["", null, null, true, false];
    }
    const at = key(row, c.column);
    const mergedTo = merges.slaveOf.get(at);
    if (mergedTo !== undefined) {
      [value, text, master, created, formula] = [masterValues.get(mergedTo) ?? null, null, null, true, false];
    }
    if (merges.masters.has(at)) masterValues.set(at, created ? value : null);
    if (c.share === "shared" && c.ref) {
      formulae.set(String(c.si), formula && text !== null ? { row, column: c.column, text } : { text: null });
    }
    if (!created) return;
    rowWidth = c.column;
    if (value !== null || formula) rowHasValues = true;
    onCell({ row, column: c.column, value, text, master });
  };

  readXml(xml, handler, check);
  if (found.join("\n") !== tail.join("\n")) throw notAWorkbook();
  for (const [mergedRow, merged] of merges.rows) {
    if (!seenMergeRows.has(mergedRow) && merged.slave) columns = Math.max(columns, merged.right);
  }
  return {
    rows: Math.max(rows, merges.bottom),
    columns,
    valueAt(r, column) {
      const mergedTo = merges.slaveOf.get(key(r, column));
      return mergedTo === undefined ? null : masterValues.get(mergedTo) ?? null;
    },
  };
}

function typedValue(book: Book, type: string | undefined, raw: string, style: number): CellValue {
  switch (type) {
    case "s": {
      const text = book.strings?.[parseInt(raw, 10)];
      if (text === undefined) throw notAWorkbook();
      return text;
    }
    case "str":
      return decodeAgain(raw);
    case "inlineStr":
      return raw;
    case "b":
      return String(parseInt(raw, 10) !== 0);
    case "e":
      return "";
    default:
      return style && book.styles?.dates.has(style) ? "" : parseFloat(raw);
  }
}

function trailer(name: string, attributes: Map<string, string>): string {
  return JSON.stringify(name === "mergeCell" ? [name, attributes.get("ref")] : [name, attributes.get("ref"), attributes.get("r:id")]);
}

/** Merged ranges: each cell but the top-left one reads as the top-left one. Overlaps are refused. */
function mergeMap(tail: string[]) {
  const slaveOf = new Map<number, number>();
  const masters = new Set<number>();
  const rows = new Map<number, { right: number; slave: boolean }>();
  let bottom = 0;
  for (const entry of tail) {
    const [name, ref] = JSON.parse(entry) as [string, string | undefined];
    if (name !== "mergeCell") continue;
    const match = RANGE.exec(ref ?? "");
    if (!match) throw notAWorkbook();
    const [c1, r1] = [columnIndex(match[1]), Number(match[2])];
    const [c2, r2] = match[3] ? [columnIndex(match[3]), Number(match[4])] : [c1, r1];
    const [top, left, last, right] = [Math.min(r1, r2), Math.min(c1, c2), Math.max(r1, r2), Math.max(c1, c2)];
    if (right > MAX_COLUMNS || last > MAX_ROWS) throw notAWorkbook();
    const master = key(top, left);
    if (masters.has(master) || slaveOf.has(master)) throw notAWorkbook();
    masters.add(master);
    for (let r = top; r <= last; r++) {
      for (let c = left; c <= right; c++) {
        if (r === top && c === left) continue;
        const at = key(r, c);
        if (masters.has(at) || slaveOf.has(at)) throw notAWorkbook();
        slaveOf.set(at, master);
      }
      const info = rows.get(r) ?? { right: 0, slave: false };
      rows.set(r, { right: Math.max(info.right, right), slave: info.slave || r > top || right > left });
    }
    bottom = Math.max(bottom, last);
  }
  return { slaveOf, masters, rows, bottom };
}

/** Addresses of the cells holding an external hyperlink, which then read as "". */
function hyperlinks(book: Book, sheet: SheetInfo, tail: string[], check: () => void): Set<string> {
  const linked = new Set<string>();
  let rels: Map<string, { target: string | undefined }> | null | undefined;
  for (const entry of tail) {
    const [name, ref, id] = JSON.parse(entry) as [string, string | undefined, string | undefined];
    if (name !== "hyperlink" || !id) continue;
    rels ??= readRels(book.parts, sheet.rels, check);
    const rel = rels?.get(id);
    if (ref === undefined || !rel) throw notAWorkbook();
    if (rel.target) linked.add(ref);
  }
  return linked;
}

function readRels(parts: WorkbookParts, name: string, check: () => void) {
  if (!parts.has(name)) return null;
  const rels = new Map<string, { target: string | undefined }>();
  for (const rel of readElements(parts, name, "Relationships", ["Relationships", "Relationship"], check)) {
    rels.set(rel.get("Id") ?? "", { target: rel.get("Target") });
  }
  return rels;
}

/** The attributes of every element at `path`; the same name anywhere else is refused. */
function readElements(parts: WorkbookParts, name: string, root: string, path: string[], check: () => void) {
  const found: Array<Map<string, string>> = [];
  const xml = parts.read(name);
  if (xml === undefined) return found;
  const open: string[] = [];
  readXml(xml, {
    open(element, attributes) {
      open.push(element);
      if (open.length === 1 && element !== root) throw notAWorkbook();
      const at = path.indexOf(element);
      if (at < 0) return;
      if (at !== open.length - 1 || open.some((e, i) => e !== path[i])) throw notAWorkbook();
      if (at === path.length - 1) found.push(attributes);
    },
    close: () => void open.pop(),
  }, check);
  return found;
}

/**
 * Shared strings, in order. A plain string's text, or a rich string's runs joined;
 * phonetic runs are not part of the text.
 */
function readStrings(parts: WorkbookParts, check: () => void): string[] | null {
  const xml = parts.read("xl/sharedStrings.xml");
  if (xml === undefined) return null;
  const strings: string[] = [];
  const contexts: string[] = [];
  let plain: string[] = [];
  let runs: string[] = [];
  let run = "";
  let runTexts = 0;
  readXml(xml, {
    open(name) {
      const context = contexts[contexts.length - 1];
      let next = "ignore";
      if (context === undefined && name === "sst") next = "sst";
      else if (context === "sst" && name === "si") [next, plain, runs] = ["si", [], []];
      else if (context === "si" && name === "t") [next, plain] = ["siT", [...plain, ""]];
      else if (context === "si" && name === "r") [next, run, runTexts] = ["r", "", 0];
      else if (context === "r" && name === "t" && !runTexts++) next = "rT";
      else if (!((context === "si" && (name === "rPh" || name === "phoneticPr")) || (context === "r" && name === "rPr") || context === "ignore")) {
        throw notAWorkbook();
      }
      contexts.push(next);
    },
    text(text) {
      const context = contexts[contexts.length - 1];
      if (context === "siT") plain[plain.length - 1] += text;
      else if (context === "rT") run += text;
    },
    close() {
      const context = contexts.pop();
      if (context === "r") runs.push(unescapeText(run));
      else if (context === "si") {
        if (plain.length > 1 || (plain.length && runs.length)) throw notAWorkbook();
        strings.push(own(plain.length ? unescapeText(plain[0]) : runs.join("")));
      }
    },
  }, check);
  return strings;
}

/** Which cell styles show a number as a date: the only thing the profile reads from styles. */
function readStyles(parts: WorkbookParts, check: () => void): Book["styles"] {
  const xml = parts.read("xl/styles.xml");
  if (xml === undefined) return null;
  const formats = new Map<number, string>();
  const xfs: number[] = [];
  const open: string[] = [];
  readXml(xml, {
    open(name, attributes) {
      open.push(name);
      const path = open.join("/");
      if (path === "styleSheet/numFmts/numFmt") {
        const code = attributes.get("formatCode");
        if (code === undefined) throw notAWorkbook();
        formats.set(parseInt(attributes.get("numFmtId") ?? "", 10), code.replace(/[\\](.)/g, "$1"));
      } else if (path === "styleSheet/cellXfs/xf") {
        xfs.push(parseInt(attributes.get("numFmtId") ?? "", 10));
      }
    },
    close: () => void open.pop(),
  }, check);
  const dates = new Set<number>();
  xfs.forEach((id, index) => {
    const custom = formats.get(id);
    if (id && (custom ? isDateFormat(custom) : DATE_FORMAT_IDS.has(id))) dates.add(index);
  });
  return { dates, count: xfs.length };
}

function isDateFormat(code: string): boolean {
  return /[ymdhMsb]+/.test(code.replace(/\[[^\]]*]/g, "").replace(/"[^"]*"/g, ""));
}

/** Escaped characters in shared and rich text, such as `_x000D_`. */
function unescapeText(text: string): string {
  return text.replace(/_x([0-9A-F]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/** Sheet names and `t="str"` values are decoded once more by the previous reader; kept for the same text. */
function decodeAgain(text: string | undefined): string {
  if (text === undefined) throw notAWorkbook();
  const entities: Record<string, string> = { "&lt;": "<", "&gt;": ">", "&amp;": "&", "&apos;": "'", "&quot;": '"' };
  return text.replace(/&([a-z]*);/g, (entity) => entities[entity] ?? entity);
}
