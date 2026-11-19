import ExcelJS from "exceljs";

import {
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

interface Ref {
  sheet: string;
  column: number;
  row: number;
}

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
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Buffer.from(bytes) as unknown as ExcelJS.Buffer);
  } catch {
    throw new TemplateReadError("NOT_A_WORKBOOK");
  }
  const sheetsByName = new Map(workbook.worksheets.map((ws) => [ws.name.toLowerCase(), ws]));
  const defects: TemplateDefect[] = [];

  const layouts: Layout[] = [];
  const formulas = new Map<Worksheet, string[]>();
  for (const ws of workbook.worksheets) {
    const { layout, others, broken } = scanSheet(ws);
    if (layout) layouts.push(layout);
    formulas.set(ws, others);
    if (broken) defects.push({ code: "BROKEN_REFERENCE", sheet: ws.name, detail: { cells: broken } });
  }
  if (!layouts.length) throw new TemplateReadError("NO_ACCOUNT_SHEET");

  const columns = layouts.flatMap((l) => [...l.formulaRows.keys()]);
  const first = Math.min(...columns);
  const positions = Array.from({ length: Math.max(...columns) - first + 1 }, (_, i) => first + i);
  const layoutOf = (name: string) => layouts.find((l) => l.ws.name.toLowerCase() === name.toLowerCase());

  // Trial-balance reads: cells outside the account sheets that reference a heading,
  // and the cells there that reference a total below the data rows.
  const sheetMeta = new Map(layouts.map((l) => [l, sheetRows(l)]));
  const reads = new Map<number, number>(positions.map((p) => [p, 0]));
  const readRows = new Set<string>();
  for (const ws of workbook.worksheets) {
    if (layouts.some((l) => l.ws === ws)) continue;
    const cells = formulas.get(ws)!.map((formula) => refs(formula, ws.name));
    const readsHeadings = cells.some((cellRefs) => cellRefs.some((ref) => {
      const layout = layoutOf(ref.sheet);
      return layout && ref.row === layout.headingRow && positions.includes(ref.column);
    }));
    if (!readsHeadings) continue;
    for (const cellRefs of cells) {
      const columnsRead = new Set<number>();
      for (const ref of cellRefs) {
        const layout = layoutOf(ref.sheet);
        if (!layout || ref.row <= sheetMeta.get(layout)!.lastDataRow || !positions.includes(ref.column)) continue;
        columnsRead.add(ref.column);
        readRows.add(rowKey(layout.ws.name, ref.row));
      }
      for (const column of columnsRead) reads.set(column, reads.get(column)! + 1);
    }
  }
  // One level of consolidation: rows the trial balance reads may add other sheets' totals.
  const reached = new Set(readRows);
  for (const key of readRows) {
    const [name, row] = key.split("\u0000");
    const ws = sheetsByName.get(name)!;
    for (const column of positions) {
      const formula = formulaOf(ws.getCell(Number(row), column));
      for (const ref of formula ? refs(formula, ws.name) : []) reached.add(rowKey(ref.sheet, ref.row));
    }
  }

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
      let last = layout.firstDataRow - 1;
      const rows = layout.formulaRows.get(heading.position);
      while (last < meta.lastDataRow && rows?.has(last + 1)) last++;
      if (last < meta.lastDataRow) {
        defects.push({ code: "TRUNCATED_ANALYSIS_COLUMN", sheet: layout.ws.name, position: heading.position, detail: { lastFormulaRow: last, lastDataRow: meta.lastDataRow } });
        if (!heading.blockedReason) safeLastRow = Math.min(safeLastRow, last);
      }
    }
    if (meta.closingRow !== null && meta.closingRow !== meta.lastDataRow) {
      defects.push({ code: "STALE_CLOSING_BALANCE", sheet: layout.ws.name, detail: { referencedRow: meta.closingRow, lastDataRow: meta.lastDataRow } });
    }
    const consolidated = reached.has(rowKey(layout.ws.name, meta.totalsRow));
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

function scanSheet(ws: Worksheet) {
  let layout: Layout | null = null;
  let broken = 0;
  const others: string[] = [];
  ws.eachRow((row, rowNumber) => {
    row.eachCell((cell, column) => {
      if (cell.type !== ExcelJS.ValueType.Formula) return;
      const formula = formulaOf(cell);
      if (!formula) return;
      if (formula.includes("#REF!")) broken++;
      const match = ANALYSIS.exec(formula);
      if (match && columnIndex(match[1]) === column && Number(match[4]) === rowNumber && Number(match[6]) === rowNumber) {
        const [headingRow, codeColumn, amountColumn] = [Number(match[2]), columnIndex(match[3]), columnIndex(match[5])];
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

function sheetRows(layout: Layout) {
  const { ws, headingRow, amountColumn, firstDataRow } = layout;
  const labels = new Map<number, string>();
  for (let column = 1; column < amountColumn; column++) labels.set(column, text(ws.getCell(headingRow, column).value).trim());
  const labelled = (pattern: RegExp) => [...labels].find(([, label]) => pattern.test(label))?.[0];
  const dateColumn = labelled(/^date/i);
  const narrativeColumn = labelled(/^narr/i);
  // The running balance: `=+<balance><row-1>+<amount><row>` on the first data row.
  const amountRef = `${columnLetter(amountColumn)}${firstDataRow}`;
  const balanceColumn = [...labels.keys()].find((column) => {
    const formula = formulaOf(ws.getCell(firstDataRow, column));
    return formula?.replace(/^\+/, "") === `${columnLetter(column)}${firstDataRow - 1}+${amountRef}`;
  });

  const amount = columnLetter(amountColumn);
  const sum = new RegExp(`^SUM\\(\\$?${amount}\\$?${firstDataRow}:\\$?${amount}\\$?(\\d+)\\)$`);
  let totalsRow: number | null = null;
  let lastDataRow = 0;
  for (let row = firstDataRow; row <= ws.rowCount && totalsRow === null; row++) {
    const match = sum.exec(formulaOf(ws.getCell(row, amountColumn)) ?? "");
    if (match && Number(match[1]) === row - 1) [totalsRow, lastDataRow] = [row, row - 1];
  }
  if (dateColumn === undefined || narrativeColumn === undefined || balanceColumn === undefined || totalsRow === null) {
    throw new TemplateReadError("UNRECOGNISED_LAYOUT", ws.name);
  }
  const closing = refs(formulaOf(ws.getCell(totalsRow, balanceColumn)) ?? "", ws.name);
  const closingRow = closing.length === 1 && closing[0].sheet === ws.name && closing[0].column === balanceColumn ? closing[0].row : null;
  return { dateColumn, narrativeColumn, balanceColumn, totalsRow, lastDataRow, closingRow };
}

function headingValue(layouts: Layout[], position: number, sheets: Map<string, Worksheet>): string | number | null {
  for (const layout of layouts) {
    const value = resolve(layout.ws.getCell(layout.headingRow, position), sheets);
    if (value !== undefined) return value;
  }
  return null;
}

function headingGroup(layouts: Layout[], position: number, sheets: Map<string, Worksheet>): HeadingGroup | null {
  const labelAt = (row: (l: Layout) => number) => layouts.map((l) => text(resolve(l.ws.getCell(row(l), position), sheets) ?? null));
  const block = labelAt((l) => l.headingRow - 2).map((label) => BLOCKS.find(([pattern]) => pattern.test(label))?.[1]).find(Boolean);
  if (!block) return null;
  if (block === "expenses" && labelAt((l) => l.headingRow - 3).some((label) => /cost of sales/i.test(label))) return "cost_of_sales";
  return block;
}

/** Follows `=+Sheet!A1` references to the typed value. Undefined when it cannot. */
function resolve(cell: Cell, sheets: Map<string, Worksheet>, depth = 0): string | number | null | undefined {
  const formula = formulaOf(cell);
  if (formula === null) {
    const value = cell.value;
    if (value === null || value === undefined) return null;
    if (typeof value === "number" || typeof value === "string") return value;
    return text(value);
  }
  const target = /^\+?(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_.]*))!\$?([A-Z]{1,3})\$?(\d+)$/.exec(formula);
  const sheet = target && sheets.get((target[1]?.replace(/''/g, "'") ?? target[2]).toLowerCase());
  if (!target || !sheet || depth > 5) return undefined;
  return resolve(sheet.getCell(Number(target[4]), columnIndex(target[3])), sheets, depth + 1);
}

function rowKey(sheet: string, row: number) {
  return `${sheet.toLowerCase()}\u0000${row}`;
}

function formulaOf(cell: Cell): string | null {
  return cell.type === ExcelJS.ValueType.Formula ? cell.formula ?? null : null;
}

function text(value: ExcelJS.CellValue | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && "richText" in value) return value.richText.map((part) => part.text).join("");
  return typeof value === "object" ? "" : String(value);
}

function refs(formula: string, currentSheet: string): Ref[] {
  const out: Ref[] = [];
  const withoutStrings = formula.replace(/"[^"]*"/g, '""');
  for (const match of withoutStrings.matchAll(REF)) {
    const sheet = match[1]?.replace(/''/g, "'") ?? match[2] ?? currentSheet;
    const [c1, r1] = [columnIndex(match[3]), Number(match[4])];
    const [c2, r2] = match[5] ? [columnIndex(match[5]), Number(match[6])] : [c1, r1];
    for (let column = Math.min(c1, c2); column <= Math.max(c1, c2); column++) {
      for (const row of r1 === r2 ? [r1] : [r1, r2]) out.push({ sheet, column, row });
    }
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
