import ExcelJS from "exceljs";

import {
  TEMPLATE_MAX_BYTES,
  TemplateReadError,
  type AccountSheet,
  type HeadingBlockedReason,
  type HeadingGroup,
  type TemplateDefect,
  type TemplateHeading,
  type TemplateProfile,
} from "./template-profile";

// Reads an accountant's accounts workbook into a profile. The layout is found by
// structure (the analysis formula), never by sheet names or fixed addresses.
// The file comes from a user, so every size and every address parsed from it is bounded.

type Worksheet = ExcelJS.Worksheet;
type Cell = ExcelJS.Cell;

interface Layout {
  ws: Worksheet;
  headingRow: number;
  codeColumn: number;
  amountColumn: number;
  firstDataRow: number;
  /** Per analysis column, the rows holding its analysis formula. */
  formulaRows: Map<number, Set<number>>;
}

/** A reference or range, kept compact: never expanded into cells. */
interface Ref {
  sheet: string;
  c1: number;
  c2: number;
  r1: number;
  r2: number;
}

interface Dimensions {
  rows: number;
  columns: number;
}

const MAX_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 2_000;
const MAX_SHEETS = 64;
const MAX_ACCOUNT_ROWS = 20_000;
const MAX_ACCOUNT_COLUMNS = 400;
const MAX_FORMULAS = 2_000_000;
const MAX_REFERENCES = 100_000;

const ANALYSIS = /^IF\(([A-Z]{1,3})\$(\d+)=\$([A-Z]{1,3})(\d+),\$([A-Z]{1,3})(\d+),0\)$/;
const REF = /(?<![A-Za-z0-9_.$'!])(?:(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_.]*))!)?\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?(?![A-Za-z0-9_(!])/g;
const BLOCKS: Array<[RegExp, HeadingGroup]> = [
  [/liabilit/i, "liabilities"],
  [/equity|capital/i, "equity"],
  [/asset/i, "assets"],
  [/income/i, "income"],
  [/expense|overhead/i, "expenses"],
];

export async function readTemplate(bytes: Uint8Array | Buffer): Promise<TemplateProfile> {
  if (bytes.byteLength > TEMPLATE_MAX_BYTES) throw new TemplateReadError("TOO_LARGE");
  checkZipDirectory(bytes);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Buffer.from(bytes) as unknown as ExcelJS.Buffer);
  } catch {
    throw new TemplateReadError("NOT_A_WORKBOOK");
  }
  if (workbook.worksheets.length > MAX_SHEETS) throw new TemplateReadError("TOO_LARGE");
  const sheetsByName = new Map(workbook.worksheets.map((ws) => [ws.name.toLowerCase(), ws]));
  const dimensions = new Map<Worksheet, Dimensions>(workbook.worksheets.map((ws) => [ws, { rows: ws.rowCount, columns: ws.columnCount }]));
  const budget = { formulas: 0, refs: 0 };
  const defects: TemplateDefect[] = [];

  const layouts: Layout[] = [];
  const formulas = new Map<Worksheet, string[]>();
  for (const ws of workbook.worksheets) {
    const { layout, others, broken } = scanSheet(ws, dimensions.get(ws)!, budget);
    if (layout) {
      const { rows, columns } = dimensions.get(ws)!;
      if (rows > MAX_ACCOUNT_ROWS || columns > MAX_ACCOUNT_COLUMNS) throw new TemplateReadError("TOO_LARGE", ws.name);
      layouts.push(layout);
    }
    formulas.set(ws, others);
    if (broken) defects.push({ code: "BROKEN_REFERENCE", sheet: ws.name, detail: { cells: broken } });
  }
  if (!layouts.length) throw new TemplateReadError("NO_ACCOUNT_SHEET");

  const columns = layouts.flatMap((l) => [...l.formulaRows.keys()]);
  const first = Math.min(...columns);
  const last = Math.max(...columns);
  const positions = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  const layoutOf = (name: string) => layouts.find((l) => l.ws.name.toLowerCase() === name.toLowerCase());
  const coversPositions = (ref: Ref) => ref.c1 <= last && ref.c2 >= first;

  // Trial-balance reads: cells outside the account sheets that reference a heading,
  // and the cells there that reference a total below the data rows.
  const sheetMeta = new Map(layouts.map((l) => [l, sheetRows(l, dimensions.get(l.ws)!, budget)]));
  const reads = new Map<number, number>(positions.map((p) => [p, 0]));
  const reachedRanges: Array<{ sheet: string; r1: number; r2: number }> = [];
  const readRows = new Set<string>();
  for (const ws of workbook.worksheets) {
    if (layouts.some((l) => l.ws === ws)) continue;
    const cells = formulas.get(ws)!.map((formula) => refs(formula, ws.name, budget));
    const readsHeadings = cells.some((cellRefs) => cellRefs.some((ref) => {
      const layout = layoutOf(ref.sheet);
      return layout && ref.r1 <= layout.headingRow && layout.headingRow <= ref.r2 && coversPositions(ref);
    }));
    if (!readsHeadings) continue;
    for (const cellRefs of cells) {
      const columnsRead = new Set<number>();
      for (const ref of cellRefs) {
        const layout = layoutOf(ref.sheet);
        const lastDataRow = layout ? sheetMeta.get(layout)!.lastDataRow : 0;
        if (!layout || ref.r2 <= lastDataRow || !coversPositions(ref)) continue;
        for (let column = Math.max(ref.c1, first); column <= Math.min(ref.c2, last); column++) columnsRead.add(column);
        reachedRanges.push({ sheet: layout.ws.name.toLowerCase(), r1: Math.max(ref.r1, lastDataRow + 1), r2: ref.r2 });
        if (ref.r1 === ref.r2) readRows.add(rowKey(layout.ws.name, ref.r1));
      }
      for (const column of columnsRead) reads.set(column, reads.get(column)! + 1);
    }
  }
  // One level of consolidation: single rows the trial balance reads may add other sheets' totals.
  for (const key of readRows) {
    const [name, row] = key.split("\u0000");
    const ws = sheetsByName.get(name)!;
    for (const column of positions) {
      const formula = formulaOf(cellAt(ws, Number(row), column));
      for (const ref of formula ? refs(formula, ws.name, budget) : []) reachedRanges.push({ sheet: ref.sheet.toLowerCase(), r1: ref.r1, r2: ref.r2 });
    }
  }
  const reached = (sheet: string, row: number) =>
    reachedRanges.some((range) => range.sheet === sheet.toLowerCase() && range.r1 <= row && row <= range.r2);

  let group: HeadingGroup | null = null;
  const headings: TemplateHeading[] = positions.map((position, order) => {
    const value = headingValue(layouts, position, sheetsByName);
    const templateValue = value === null ? "" : String(value);
    const valueType = typeof value === "number" ? "number" : "text";
    const blank = valueType === "text" && templateValue.trim() === "";
    if (blank) defects.push({ code: "BLANK_HEADING", position, detail: {} });
    else if (valueType === "text" && /\s$/.test(templateValue)) defects.push({ code: "TRAILING_SPACE", position, detail: {} });
    if (valueType === "number") defects.push({ code: "NUMERIC_HEADING", position, detail: {} });
    const readCount = reads.get(position)!;
    if (readCount === 0) defects.push({ code: "HEADING_TOTAL_NOT_READ", position, detail: {} });
    if (readCount > 1) defects.push({ code: "HEADING_TOTAL_READ_TWICE", position, detail: { reads: readCount } });
    const noFormula = layouts.some((l) => !l.formulaRows.get(position)?.has(l.firstDataRow));
    const blockedReason: HeadingBlockedReason | null =
      blank ? "blank_heading"
        : /do not use/i.test(templateValue) ? "marked_do_not_use"
          : readCount > 1 ? "total_read_twice"
            : readCount === 0 ? "total_not_read"
              : noFormula ? "truncated_formula"
                : null;
    // A column with no block label of its own belongs to the block on its left.
    group = headingGroup(layouts, position, sheetsByName) ?? group;
    if (!group) throw new TemplateReadError("UNRECOGNISED_LAYOUT");
    return { position, templateValue, valueType, group, order, blockedReason };
  });

  const sheets: AccountSheet[] = layouts.map((layout) => {
    const meta = sheetMeta.get(layout)!;
    let safeLastRow = meta.lastDataRow;
    for (const heading of headings) {
      let lastFormulaRow = layout.firstDataRow - 1;
      const rows = layout.formulaRows.get(heading.position);
      while (lastFormulaRow < meta.lastDataRow && rows?.has(lastFormulaRow + 1)) lastFormulaRow++;
      if (lastFormulaRow < meta.lastDataRow) {
        defects.push({ code: "TRUNCATED_ANALYSIS_COLUMN", sheet: layout.ws.name, position: heading.position, detail: { lastFormulaRow, lastDataRow: meta.lastDataRow } });
        if (!heading.blockedReason) safeLastRow = Math.min(safeLastRow, lastFormulaRow);
      }
    }
    if (meta.closingRow !== null && meta.closingRow !== meta.lastDataRow) {
      defects.push({ code: "STALE_CLOSING_BALANCE", sheet: layout.ws.name, detail: { referencedRow: meta.closingRow, lastDataRow: meta.lastDataRow } });
    }
    const consolidated = reached(layout.ws.name, meta.totalsRow);
    if (!consolidated) defects.push({ code: "UNCONSOLIDATED_SHEET", sheet: layout.ws.name, detail: {} });
    return {
      name: layout.ws.name,
      dateColumn: meta.dateColumn,
      narrativeColumn: meta.narrativeColumn,
      codeColumn: layout.codeColumn,
      balanceColumn: meta.balanceColumn,
      amountColumn: layout.amountColumn,
      headingRow: layout.headingRow,
      openingBalanceCell: `${columnLetter(meta.balanceColumn)}${layout.firstDataRow - 1}`,
      firstDataRow: layout.firstDataRow,
      lastDataRow: meta.lastDataRow,
      totalsRow: meta.totalsRow,
      safeLastRow,
      consolidated,
    };
  });

  return { headings, sheets, defects };
}

// A first gate only: declared sizes can lie, so the caller must also run the parse under a memory and time limit.
function checkZipDirectory(bytes: Uint8Array) {
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
  let total = 0;
  for (let i = 0, p = start; i < count; i++) {
    if (p + 46 > start + size || view.getUint32(p, true) !== 0x02014b50) throw new TemplateReadError("NOT_A_WORKBOOK");
    total += view.getUint32(p + 24, true);
    if (total > MAX_UNCOMPRESSED_BYTES) throw new TemplateReadError("TOO_LARGE");
    p += 46 + view.getUint16(p + 28, true) + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
  }
}

function scanSheet(ws: Worksheet, dimensions: Dimensions, budget: { formulas: number }) {
  let layout: Layout | null = null;
  let broken = 0;
  const others: string[] = [];
  ws.eachRow((row, rowNumber) => {
    row.eachCell((cell, column) => {
      if (cell.type !== ExcelJS.ValueType.Formula) return;
      const formula = formulaOf(cell);
      if (!formula) return;
      if (++budget.formulas > MAX_FORMULAS) throw new TemplateReadError("TOO_LARGE");
      if (formula.includes("#REF!")) broken++;
      const match = ANALYSIS.exec(formula);
      if (match && columnIndex(match[1]) === column && Number(match[4]) === rowNumber && Number(match[6]) === rowNumber) {
        const [headingRow, codeColumn, amountColumn] = [Number(match[2]), columnIndex(match[3]), columnIndex(match[5])];
        const inside = (c: number) => c >= 1 && c <= dimensions.columns;
        if (headingRow < 1 || headingRow >= rowNumber || !inside(codeColumn) || !inside(amountColumn)) {
          throw new TemplateReadError("UNRECOGNISED_LAYOUT", ws.name);
        }
        layout ??= { ws, headingRow, codeColumn, amountColumn, firstDataRow: rowNumber, formulaRows: new Map() };
        if (layout.headingRow === headingRow && layout.codeColumn === codeColumn && layout.amountColumn === amountColumn) {
          if (!layout.formulaRows.has(column)) layout.formulaRows.set(column, new Set());
          layout.formulaRows.get(column)!.add(rowNumber);
          return;
        }
      }
      others.push(formula);
    });
  });
  return { layout: layout as Layout | null, others, broken };
}

function sheetRows(layout: Layout, dimensions: Dimensions, budget: { refs: number }) {
  const { ws, headingRow, amountColumn, firstDataRow } = layout;
  const labels = new Map<number, string>();
  for (let column = 1; column < amountColumn; column++) labels.set(column, text(cellAt(ws, headingRow, column)?.value).trim());
  const labelled = (pattern: RegExp) => [...labels].find(([, label]) => pattern.test(label))?.[0];
  const dateColumn = labelled(/^date/i);
  const narrativeColumn = labelled(/^narr/i);
  // The running balance: `=+<balance><row-1>+<amount><row>` on the first data row.
  const amountRef = `${columnLetter(amountColumn)}${firstDataRow}`;
  const balanceColumn = [...labels.keys()].find((column) => {
    const formula = formulaOf(cellAt(ws, firstDataRow, column));
    return formula?.replace(/^\+/, "") === `${columnLetter(column)}${firstDataRow - 1}+${amountRef}`;
  });

  const amount = columnLetter(amountColumn);
  const sum = new RegExp(`^SUM\\(\\$?${amount}\\$?${firstDataRow}:\\$?${amount}\\$?(\\d+)\\)$`);
  let totalsRow: number | null = null;
  let lastDataRow = 0;
  for (let row = firstDataRow; row <= dimensions.rows && totalsRow === null; row++) {
    const match = sum.exec(formulaOf(cellAt(ws, row, amountColumn)) ?? "");
    if (match && Number(match[1]) === row - 1) [totalsRow, lastDataRow] = [row, row - 1];
  }
  if (dateColumn === undefined || narrativeColumn === undefined || balanceColumn === undefined || totalsRow === null) {
    throw new TemplateReadError("UNRECOGNISED_LAYOUT", ws.name);
  }
  const closing = refs(formulaOf(cellAt(ws, totalsRow, balanceColumn)) ?? "", ws.name, budget);
  const closingRow = closing.length === 1 && closing[0].sheet === ws.name && closing[0].c1 === balanceColumn && closing[0].r1 === closing[0].r2
    ? closing[0].r1
    : null;
  return { dateColumn, narrativeColumn, balanceColumn, totalsRow, lastDataRow, closingRow };
}

function headingValue(layouts: Layout[], position: number, sheets: Map<string, Worksheet>): string | number | null {
  for (const layout of layouts) {
    const value = resolve(cellAt(layout.ws, layout.headingRow, position), sheets);
    if (value !== undefined) return value;
  }
  return null;
}

function headingGroup(layouts: Layout[], position: number, sheets: Map<string, Worksheet>): HeadingGroup | null {
  const labelAt = (row: (l: Layout) => number) => layouts.map((l) => text(resolve(cellAt(l.ws, row(l), position), sheets) ?? null));
  const block = labelAt((l) => l.headingRow - 2).map((label) => BLOCKS.find(([pattern]) => pattern.test(label))?.[1]).find(Boolean);
  if (!block) return null;
  if (block === "expenses" && labelAt((l) => l.headingRow - 3).some((label) => /cost of sales/i.test(label))) return "cost_of_sales";
  return block;
}

/** Follows `=+Sheet!A1` references to the typed value. Undefined when it cannot. */
function resolve(cell: Cell | undefined, sheets: Map<string, Worksheet>, depth = 0): string | number | null | undefined {
  const formula = formulaOf(cell);
  if (formula === null) {
    const value = cell?.value;
    if (value === null || value === undefined) return null;
    if (typeof value === "number" || typeof value === "string") return value;
    return text(value);
  }
  const target = /^\+?(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_.]*))!\$?([A-Z]{1,3})\$?(\d+)$/.exec(formula);
  const sheet = target && sheets.get((target[1]?.replace(/''/g, "'") ?? target[2]).toLowerCase());
  if (!target || !sheet || depth > 5) return undefined;
  return resolve(cellAt(sheet, Number(target[4]), columnIndex(target[3])), sheets, depth + 1);
}

/** Looks a cell up without creating it (`getCell` would allocate rows and cells). */
function cellAt(ws: Worksheet, row: number, column: number): Cell | undefined {
  return row >= 1 && column >= 1 ? ws.findRow(row)?.findCell(column) : undefined;
}

function rowKey(sheet: string, row: number) {
  return `${sheet.toLowerCase()}\u0000${row}`;
}

function formulaOf(cell: Cell | undefined): string | null {
  return cell?.type === ExcelJS.ValueType.Formula ? cell.formula ?? null : null;
}

function text(value: ExcelJS.CellValue | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && "richText" in value) return value.richText.map((part) => part.text).join("");
  return typeof value === "object" ? "" : String(value);
}

function refs(formula: string, currentSheet: string, budget: { refs: number }): Ref[] {
  const out: Ref[] = [];
  const withoutStrings = formula.replace(/"[^"]*"/g, '""');
  for (const match of withoutStrings.matchAll(REF)) {
    if (++budget.refs > MAX_REFERENCES) throw new TemplateReadError("TOO_LARGE");
    const sheet = match[1]?.replace(/''/g, "'") ?? match[2] ?? currentSheet;
    const [c1, r1] = [columnIndex(match[3]), Number(match[4])];
    const [c2, r2] = match[5] ? [columnIndex(match[5]), Number(match[6])] : [c1, r1];
    out.push({ sheet, c1: Math.min(c1, c2), c2: Math.max(c1, c2), r1: Math.min(r1, r2), r2: Math.max(r1, r2) });
  }
  return out;
}

function columnIndex(letters: string): number {
  return [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
}

function columnLetter(index: number): string {
  let letters = "";
  for (let n = index; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  return letters;
}
