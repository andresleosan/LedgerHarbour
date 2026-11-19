import {
  columnIndex,
  formulaOf,
  openBook,
  own,
  readSheet,
  type CellValue,
  type SharedMaster,
  type SheetCell,
  type SheetScan,
} from "./spreadsheet";
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
import { MAX_ACCOUNT_COLUMNS, MAX_ACCOUNT_ROWS, inspectWorkbookZip } from "./zip-gate";

// Reads an accountant's accounts workbook into a profile. The layout is found by
// structure (the analysis formula), never by sheet names or fixed addresses.
// The file comes from a user, so every size and every address parsed from it is bounded.
//
// Memory: sheets are streamed from their XML one at a time and only what the profile
// needs is kept (each analysis column's extent, the references other sheets make, a few
// cells); a later step that needs other cells of a sheet reads it again rather than
// keeping it. Time: one deadline for the whole reading.

interface Layout {
  sheet: number;
  name: string;
  headingRow: number;
  codeColumn: number;
  amountColumn: number;
  firstDataRow: number;
  /** Per analysis column: last row of the unbroken run of analysis formulas from the first data row (one above it when none). */
  runs: Map<number, number>;
}

/** A reference or range, kept compact: never expanded into cells. */
interface Ref {
  sheet: string;
  c1: number;
  c2: number;
  r1: number;
  r2: number;
}

/** A reference with its sheet as the index of a sheet of the workbook, or -1 for none. */
type SheetRef = Omit<Ref, "sheet"> & { sheet: number };

interface Analysis {
  headingRow: number;
  codeColumn: number;
  amountColumn: number;
}

type Stream = (sheet: number, onCell: (cell: SheetCell) => void) => Promise<SheetScan>;
type Resolve = (sheet: number, row: number, column: number) => CellValue | undefined;
/** Cells kept to follow references from the headings, per sheet, by cell key. */
type Kept = Map<number, Map<number, { value: CellValue; formula: string | null }>>;

/** Longest a reading may take; past it the file is refused as too large. */
export const READ_TIME_LIMIT_MS = 20_000;

const MAX_SHEETS = 64;
const MAX_FORMULAS = 2_000_000;
const MAX_REFERENCES = 100_000;
const MAX_COLUMNS = 16_384;
const MAX_ROWS = 1_048_576;

const ANALYSIS = /^IF\(([A-Z]{1,3})\$(\d+)=\$([A-Z]{1,3})(\d+),\$([A-Z]{1,3})(\d+),0\)$/;
const REF = /(?<![A-Za-z0-9_.$'!])(?:(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_.]*))!)?\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?(?![A-Za-z0-9_(!])/g;
const TARGET = /^\+?(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_.]*))!\$?([A-Z]{1,3})\$?(\d+)$/;
const BLOCKS: Array<[RegExp, HeadingGroup]> = [
  [/liabilit/i, "liabilities"],
  [/equity|capital/i, "equity"],
  [/asset/i, "assets"],
  [/income/i, "income"],
  [/expense|overhead/i, "expenses"],
];

const tooLarge = (sheet?: string) => new TemplateReadError("TOO_LARGE", sheet);

export async function readTemplate(bytes: Uint8Array | Buffer): Promise<TemplateProfile> {
  return readTemplateWithin(bytes, READ_TIME_LIMIT_MS);
}

/** `readTemplate` with the time limit given; for tests. */
export async function readTemplateWithin(bytes: Uint8Array | Buffer, timeLimitMs: number): Promise<TemplateProfile> {
  if (bytes.byteLength > TEMPLATE_MAX_BYTES) throw tooLarge();
  const started = performance.now();
  const check = () => {
    if (performance.now() - started > timeLimitMs) throw tooLarge();
  };
  const book = openBook(inspectWorkbookZip(bytes), check);
  if (book.sheets.length > MAX_SHEETS) throw tooLarge();
  const sheetIndex = new Map(book.sheets.map((sheet, i) => [sheet.name.toLowerCase(), i]));
  const indexOf = (name: string) => sheetIndex.get(name.toLowerCase()) ?? -1;
  // Other work may run between two sheets.
  const stream: Stream = async (sheet, onCell) => {
    await new Promise((resolve) => setImmediate(resolve));
    return readSheet(book, book.sheets[sheet], onCell, check);
  };
  const budget = { formulas: 0, refs: 0 };
  const defects: TemplateDefect[] = [];

  // Every sheet is parsed, even once a refusal is known: a file that does not parse is
  // refused as not a workbook first, as it always was.
  const layouts: Layout[] = [];
  const otherRefs: Array<{ cells: SheetRef[][]; count: number }> = [];
  let failure: TemplateReadError | null = null;
  for (const [index, sheet] of book.sheets.entries()) {
    if (failure) {
      await stream(index, () => {});
      continue;
    }
    const scan = scanSheet(sheet.name, index, indexOf, budget);
    const { rows, columns } = await stream(index, scan.onCell);
    const { layout, broken, refs } = scan.result();
    failure = scan.failure(columns);
    if (failure) continue;
    if (layout) {
      if (rows > MAX_ACCOUNT_ROWS || columns > MAX_ACCOUNT_COLUMNS) {
        failure = tooLarge(sheet.name);
        continue;
      }
      layouts.push(layout);
    } else {
      otherRefs.push(refs);
    }
    if (broken) defects.push({ code: "BROKEN_REFERENCE", sheet: sheet.name, detail: { cells: broken } });
  }
  if (failure) throw failure;
  if (!layouts.length) throw new TemplateReadError("NO_ACCOUNT_SHEET");

  const columns = layouts.flatMap((l) => [...l.runs.keys()]);
  const first = Math.min(...columns);
  const last = Math.max(...columns);
  const positions = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  const layoutOf = new Map(layouts.map((l) => [l.sheet, l]));
  const coversPositions = (ref: SheetRef) => ref.c1 <= last && ref.c2 >= first;

  // The trial balance: sheets other than the account sheets with a cell that references a heading.
  const readsHeadings = otherRefs.map(({ cells }) => cells.some((cellRefs) => cellRefs.some((ref) => {
    const layout = layoutOf.get(ref.sheet);
    return layout && ref.r1 <= layout.headingRow && layout.headingRow <= ref.r2 && coversPositions(ref);
  })));
  // Single rows below an account sheet's data that the trial balance reads (consolidation rows).
  const rowsRead = (layout: Layout, lastDataRow: number) => new Set(otherRefs.flatMap(({ cells }, i) => (readsHeadings[i] ? cells : []))
    .flat()
    .filter((ref) => ref.sheet === layout.sheet && ref.r1 === ref.r2 && ref.r2 > lastDataRow && coversPositions(ref))
    .map((ref) => ref.r1));

  // Reading an account sheet's rows also keeps its heading and block-label cells, and the
  // references of its consolidation rows.
  const kept: Kept = new Map();
  const sheetMeta = new Map<Layout, Awaited<ReturnType<typeof sheetRows>>>();
  for (const layout of layouts) {
    const labels = [0, 2, 3].map((above) => layout.headingRow - above).filter((row) => row >= 1);
    const keep = keeper(kept, layout.sheet, new Set(labels.flatMap((row) => positions.map((p) => cellKey(row, p)))));
    const consolidation = { rows: (lastDataRow: number) => rowsRead(layout, lastDataRow), first, last, indexOf };
    sheetMeta.set(layout, await sheetRows(layout, stream, budget, keep, consolidation));
  }

  // Trial-balance reads: cells outside the account sheets that reference a heading,
  // and the cells there that reference a total below the data rows.
  const reads = new Map<number, number>(positions.map((p) => [p, 0]));
  const reachedRanges: Array<{ sheet: number; r1: number; r2: number }> = [];
  for (const [i, { cells, count }] of otherRefs.entries()) {
    budget.refs += count;
    if (budget.refs > MAX_REFERENCES) throw tooLarge();
    if (!readsHeadings[i]) continue;
    for (const cellRefs of cells) {
      const columnsRead = new Set<number>();
      for (const ref of cellRefs) {
        const layout = layoutOf.get(ref.sheet);
        const lastDataRow = layout ? sheetMeta.get(layout)!.lastDataRow : 0;
        if (!layout || ref.r2 <= lastDataRow || !coversPositions(ref)) continue;
        for (let column = Math.max(ref.c1, first); column <= Math.min(ref.c2, last); column++) columnsRead.add(column);
        reachedRanges.push({ sheet: layout.sheet, r1: Math.max(ref.r1, lastDataRow + 1), r2: ref.r2 });
      }
      for (const column of columnsRead) reads.set(column, reads.get(column)! + 1);
    }
  }
  // One level of consolidation: single rows the trial balance reads may add other sheets' totals.
  for (const { consolidated } of sheetMeta.values()) {
    budget.refs += consolidated.count;
    if (budget.refs > MAX_REFERENCES) throw tooLarge();
    for (const range of consolidated.ranges) reachedRanges.push(range);
  }
  const reached = (sheet: number, row: number) =>
    reachedRanges.some((range) => range.sheet === sheet && range.r1 <= row && row <= range.r2);

  const resolve = await resolver(layouts, positions, stream, indexOf, kept);
  let group: HeadingGroup | null = null;
  const headings: TemplateHeading[] = positions.map((position, order) => {
    const value = headingValue(layouts, position, resolve);
    const templateValue = value === null ? "" : String(value);
    const valueType = typeof value === "number" ? "number" : "text";
    const blank = valueType === "text" && templateValue.trim() === "";
    if (blank) defects.push({ code: "BLANK_HEADING", position, detail: {} });
    else if (valueType === "text" && /\s$/.test(templateValue)) defects.push({ code: "TRAILING_SPACE", position, detail: {} });
    if (valueType === "number") defects.push({ code: "NUMERIC_HEADING", position, detail: {} });
    const readCount = reads.get(position)!;
    if (readCount === 0) defects.push({ code: "HEADING_TOTAL_NOT_READ", position, detail: {} });
    if (readCount > 1) defects.push({ code: "HEADING_TOTAL_READ_TWICE", position, detail: { reads: readCount } });
    const noFormula = layouts.some((l) => !((l.runs.get(position) ?? 0) >= l.firstDataRow));
    const blockedReason: HeadingBlockedReason | null =
      blank ? "blank_heading"
        : /do not use/i.test(templateValue) ? "marked_do_not_use"
          : readCount > 1 ? "total_read_twice"
            : readCount === 0 ? "total_not_read"
              : noFormula ? "truncated_formula"
                : null;
    // A column with no block label of its own belongs to the block on its left.
    group = headingGroup(layouts, position, resolve) ?? group;
    if (!group) throw new TemplateReadError("UNRECOGNISED_LAYOUT");
    return { position, templateValue, valueType, group, order, blockedReason };
  });

  const sheets: AccountSheet[] = layouts.map((layout) => {
    const meta = sheetMeta.get(layout)!;
    let safeLastRow = meta.lastDataRow;
    for (const heading of headings) {
      const run = layout.runs.get(heading.position) ?? layout.firstDataRow - 1;
      const lastFormulaRow = Math.max(layout.firstDataRow - 1, Math.min(run, meta.lastDataRow));
      if (lastFormulaRow < meta.lastDataRow) {
        defects.push({ code: "TRUNCATED_ANALYSIS_COLUMN", sheet: layout.name, position: heading.position, detail: { lastFormulaRow, lastDataRow: meta.lastDataRow } });
        if (!heading.blockedReason) safeLastRow = Math.min(safeLastRow, lastFormulaRow);
      }
    }
    if (meta.closingRow !== null && meta.closingRow !== meta.lastDataRow) {
      defects.push({ code: "STALE_CLOSING_BALANCE", sheet: layout.name, detail: { referencedRow: meta.closingRow, lastDataRow: meta.lastDataRow } });
    }
    const consolidated = reached(layout.sheet, meta.totalsRow);
    if (!consolidated) defects.push({ code: "UNCONSOLIDATED_SHEET", sheet: layout.name, detail: {} });
    return {
      name: layout.name,
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

/**
 * First reading of a sheet, cell by cell: finds its layout from the analysis formula,
 * counts broken references and keeps the references of its other formulas (unused if it
 * is an account sheet). A refusal is remembered rather than thrown, so the rest of the
 * sheet is still parsed.
 */
function scanSheet(name: string, index: number, indexOf: (name: string) => number, budget: { formulas: number }) {
  let layout: Layout | null = null;
  let broken = 0;
  let unrecognised = false;
  let tooMany = false;
  // Analysis cells must point inside the sheet, whose width is known only at its end.
  let widest = 0;
  const cells: SheetRef[][] = [];
  let count = 0;
  const masters = new Map<SharedMaster, Analysis | null>();

  const onCell = (cell: SheetCell) => {
    if (unrecognised || tooMany || (cell.text === null && !cell.master)) return;
    if (++budget.formulas > MAX_FORMULAS) {
      tooMany = true;
      return;
    }
    // A clone of an analysis formula of its own cell is one of its own cell too, with the
    // same heading row, code and amount columns (its references move with it): its text
    // is not built.
    const master = cell.text === null ? cell.master : null;
    if (master && !masters.has(master)) masters.set(master, analysisAt(master.text, master.row, master.column));
    let formula: string | null = null;
    let analysis = master ? masters.get(master)! : null;
    if (!analysis) {
      formula = formulaOf(cell)!;
      if (formula.includes("#REF!")) broken++;
      analysis = analysisAt(formula, cell.row, cell.column);
    }
    if (analysis) {
      const { headingRow, codeColumn, amountColumn } = analysis;
      if (headingRow < 1 || headingRow >= cell.row) {
        unrecognised = true;
        return;
      }
      widest = Math.max(widest, codeColumn, amountColumn);
      layout ??= { sheet: index, name, headingRow, codeColumn, amountColumn, firstDataRow: cell.row, runs: new Map() };
      if (layout.headingRow === headingRow && layout.codeColumn === codeColumn && layout.amountColumn === amountColumn) {
        const run = layout.runs.get(cell.column);
        if (run === undefined) layout.runs.set(cell.column, cell.row === layout.firstDataRow ? cell.row : layout.firstDataRow - 1);
        else if (cell.row === run + 1) layout.runs.set(cell.column, cell.row);
        return;
      }
    }
    // Past the cap the workbook is refused anyway, unless this turns out to be an account sheet.
    if (count > MAX_REFERENCES) return;
    const counted = { refs: count };
    try {
      const cellRefs = refs(formula ?? formulaOf(cell)!, name, counted);
      if (cellRefs.length) cells.push(cellRefs.map((ref) => ({ ...ref, sheet: indexOf(ref.sheet) })));
      count = counted.refs;
    } catch {
      count = MAX_REFERENCES + 1;
      cells.length = 0;
    }
  };

  return {
    onCell,
    failure: (columns: number) =>
      unrecognised || widest > columns ? new TemplateReadError("UNRECOGNISED_LAYOUT", name) : tooMany ? tooLarge() : null,
    result: () => ({ layout: layout as Layout | null, broken, refs: { cells, count } }),
  };
}

function analysisAt(formula: string, row: number, column: number): Analysis | null {
  const match = ANALYSIS.exec(formula);
  if (!match || columnIndex(match[1]) !== column || Number(match[4]) !== row || Number(match[6]) !== row) return null;
  return { headingRow: Number(match[2]), codeColumn: columnIndex(match[3]), amountColumn: columnIndex(match[5]) };
}

interface Consolidation {
  /** The consolidation rows, once the last data row is known. */
  rows: (lastDataRow: number) => Set<number>;
  first: number;
  last: number;
  indexOf: (name: string) => number;
}

async function sheetRows(layout: Layout, stream: Stream, budget: { refs: number }, keep: ReturnType<typeof keeper>, consolidation: Consolidation) {
  const { headingRow, amountColumn, firstDataRow } = layout;
  // What the consolidation rows reference, counted here and charged to the budget later, in order.
  const consolidated = { ranges: [] as Array<{ sheet: number; r1: number; r2: number }>, count: 0 };
  let consolidationRows = new Set<number>();
  const consolidate = (cell: SheetCell) => {
    if (!consolidationRows.has(cell.row) || cell.column < consolidation.first || cell.column > consolidation.last) return;
    const formula = formulaOf(cell);
    if (!formula || consolidated.count > MAX_REFERENCES) return;
    const counted = { refs: consolidated.count };
    try {
      for (const ref of refs(formula, layout.name, counted)) consolidated.ranges.push({ sheet: consolidation.indexOf(ref.sheet), r1: ref.r1, r2: ref.r2 });
      consolidated.count = counted.refs;
    } catch {
      consolidated.count = MAX_REFERENCES + 1;
      consolidated.ranges = [];
    }
  };
  const amount = columnLetter(amountColumn);
  const sum = new RegExp(`^SUM\\(\\$?${amount}\\$?${firstDataRow}:\\$?${amount}\\$?(\\d+)\\)$`);
  // The cells left of the amount column on the heading row, the first data row and the totals row.
  const headingValues = new Map<number, CellValue>();
  let firstRow = new Map<number, SheetCell>();
  let row = new Map<number, SheetCell>();
  let totals = new Map<number, SheetCell>();
  let totalsRow: number | null = null;
  let lastDataRow = 0;
  const rowOf = (cells: Map<number, SheetCell>) => cells.values().next().value?.row;
  const scan = await stream(layout.sheet, (cell) => {
    keep.onCell(cell);
    consolidate(cell);
    if (cell.row === headingRow && cell.column < amountColumn) headingValues.set(cell.column, cell.value);
    if (cell.row < firstDataRow || totalsRow !== null) return;
    if (cell.column < amountColumn) {
      if (rowOf(row) !== cell.row) row = new Map();
      row.set(cell.column, cell);
      if (cell.row === firstDataRow) firstRow = row;
    } else if (cell.column === amountColumn) {
      const match = sum.exec(formulaOf(cell) ?? "");
      if (match && Number(match[1]) === cell.row - 1) {
        [totalsRow, lastDataRow] = [cell.row, cell.row - 1];
        if (rowOf(row) === cell.row) totals = row;
        // The totals row may be a consolidation row: its cells so far are consolidated now.
        consolidationRows = consolidation.rows(lastDataRow);
        [...totals.values(), cell].forEach(consolidate);
      }
    }
  });

  keep.done(scan);
  const labels = new Map<number, string>();
  for (let column = 1; column < amountColumn; column++) {
    labels.set(column, text(headingValues.has(column) ? headingValues.get(column) : scan.valueAt(headingRow, column)).trim());
  }
  const labelled = (pattern: RegExp) => [...labels].find(([, label]) => pattern.test(label))?.[0];
  const dateColumn = labelled(/^date/i);
  const narrativeColumn = labelled(/^narr/i);
  // The running balance: `=+<balance><row-1>+<amount><row>` on the first data row.
  const amountRef = `${amount}${firstDataRow}`;
  const balanceColumn = [...labels.keys()].find((column) => {
    const formula = formulaOf(firstRow.get(column));
    return formula?.replace(/^\+/, "") === `${columnLetter(column)}${firstDataRow - 1}+${amountRef}`;
  });

  if (dateColumn === undefined || narrativeColumn === undefined || balanceColumn === undefined || totalsRow === null) {
    throw new TemplateReadError("UNRECOGNISED_LAYOUT", layout.name);
  }
  const closing = refs(formulaOf(totals.get(balanceColumn)) ?? "", layout.name, budget);
  const closingRow = closing.length === 1 && closing[0].sheet === layout.name && closing[0].c1 === balanceColumn && closing[0].r1 === closing[0].r2
    ? closing[0].r1
    : null;
  return { dateColumn, narrativeColumn, balanceColumn, totalsRow: totalsRow as number, lastDataRow, closingRow, consolidated };
}

/**
 * Follows `=+Sheet!A1` references to the typed value (undefined when it cannot) from the
 * heading rows and the block-label rows above them. Cells not kept yet are fetched one
 * round of references at a time, each round reading only the sheets it points into.
 */
async function resolver(layouts: Layout[], positions: number[], stream: Stream, indexOf: (name: string) => number, kept: Kept): Promise<Resolve> {
  const missing = new Map<number, Set<number>>();
  const resolve = (sheet: number, row: number, column: number, depth = 0): CellValue | undefined => {
    if (row < 1 || column < 1 || row > MAX_ROWS || column > MAX_COLUMNS) return null;
    const cell = kept.get(sheet)?.get(cellKey(row, column));
    if (!cell) {
      missing.set(sheet, (missing.get(sheet) ?? new Set()).add(cellKey(row, column)));
      return undefined;
    }
    if (cell.formula === null) return cell.value;
    const target = TARGET.exec(cell.formula);
    const next = target ? indexOf(target[1]?.replace(/''/g, "'") ?? target[2]) : -1;
    if (!target || next < 0 || depth > 5) return undefined;
    return resolve(next, Number(target[4]), columnIndex(target[3]), depth + 1);
  };
  const roots = layouts.flatMap((l) => positions.flatMap((p) => [0, 2, 3].map((above) => [l.sheet, l.headingRow - above, p])));
  for (;;) {
    missing.clear();
    for (const [sheet, row, column] of roots) resolve(sheet, row, column);
    if (!missing.size) return resolve;
    for (const [sheet, wanted] of missing) {
      const keep = keeper(kept, sheet, wanted);
      keep.done(await stream(sheet, keep.onCell));
    }
  }
}

/** Keeps the wanted cells met while reading `sheet`; one not met keeps its merged range's value, or null. */
function keeper(kept: Kept, sheet: number, wanted: Set<number>) {
  const cells = kept.get(sheet) ?? new Map();
  kept.set(sheet, cells);
  return {
    onCell(cell: SheetCell) {
      const at = cellKey(cell.row, cell.column);
      if (!wanted.delete(at)) return;
      const formula = formulaOf(cell);
      cells.set(at, { value: typeof cell.value === "string" ? own(cell.value) : cell.value, formula: formula && own(formula) });
    },
    done(scan: SheetScan) {
      for (const at of wanted) cells.set(at, { value: scan.valueAt(Math.floor(at / MAX_COLUMNS), (at % MAX_COLUMNS) + 1), formula: null });
    },
  };
}

function cellKey(row: number, column: number): number {
  return row * MAX_COLUMNS + column - 1;
}

function headingValue(layouts: Layout[], position: number, resolve: Resolve): CellValue {
  for (const layout of layouts) {
    const value = resolve(layout.sheet, layout.headingRow, position);
    if (value !== undefined) return value;
  }
  return null;
}

function headingGroup(layouts: Layout[], position: number, resolve: Resolve): HeadingGroup | null {
  const labelAt = (row: (l: Layout) => number) => layouts.map((l) => text(resolve(l.sheet, row(l), position) ?? null));
  const block = labelAt((l) => l.headingRow - 2).map((label) => BLOCKS.find(([pattern]) => pattern.test(label))?.[1]).find(Boolean);
  if (!block) return null;
  if (block === "expenses" && labelAt((l) => l.headingRow - 3).some((label) => /cost of sales/i.test(label))) return "cost_of_sales";
  return block;
}

function text(value: CellValue | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

function refs(formula: string, currentSheet: string, budget: { refs: number }): Ref[] {
  const out: Ref[] = [];
  const withoutStrings = formula.replace(/"[^"]*"/g, '""');
  for (const match of withoutStrings.matchAll(REF)) {
    if (++budget.refs > MAX_REFERENCES) throw tooLarge();
    const sheet = match[1]?.replace(/''/g, "'") ?? match[2] ?? currentSheet;
    const [c1, r1] = [columnIndex(match[3]), Number(match[4])];
    const [c2, r2] = match[5] ? [columnIndex(match[5]), Number(match[6])] : [c1, r1];
    out.push({ sheet, c1: Math.min(c1, c2), c2: Math.max(c1, c2), r1: Math.min(r1, r2), r2: Math.max(r1, r2) });
  }
  return out;
}

function columnLetter(index: number): string {
  let letters = "";
  for (let n = index; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  return letters;
}
