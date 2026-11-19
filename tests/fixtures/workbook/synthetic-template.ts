import ExcelJS from "exceljs";

import type { HeadingGroup } from "../../../src/modules/workbook/template-profile";

// A synthetic accounts workbook with the same mechanism as an accountant's
// template. Every name, heading and amount here is invented.

export const SYNTHETIC_SHEETS = {
  main: "Current Account",
  deposit: "Deposit Account",
  cash: "Cash Float",
  trialBalance: "Trial Balance",
} as const;

export type SyntheticAccountSheet = "main" | "deposit" | "cash";

export interface SyntheticHeading {
  value: string | number | null;
  group: HeadingGroup;
}

// Covers every case: plain text, trailing space, numeric placeholders, a blank
// heading and one marked as not to be used.
export const SYNTHETIC_HEADINGS: SyntheticHeading[] = [
  { value: "Sales", group: "income" },
  { value: "Sundry income ", group: "income" },
  { value: "Stock bought", group: "cost_of_sales" },
  { value: "Freight in", group: "cost_of_sales" },
  { value: "Premises", group: "expenses" },
  { value: "Staff costs", group: "expenses" },
  { value: 17, group: "expenses" },
  { value: null, group: "expenses" },
  { value: "Motor - do not use", group: "expenses" },
  { value: "Phone", group: "expenses" },
  { value: "Tools", group: "assets" },
  { value: 31, group: "assets" },
  { value: "Loans", group: "liabilities" },
  { value: "Tax owed", group: "liabilities" },
  { value: "Owner capital", group: "equity" },
  { value: "Owner drawings", group: "equity" },
];

export const SYNTHETIC_LAYOUT = {
  headingRow: 5,
  firstDataRow: 7,
  firstAnalysisColumn: 8,
  columns: { account: 1, date: 2, narrative: 4, code: 5, balance: 6, amount: 7 },
  dataRows: { main: 30, deposit: 20, cash: 20 } as Record<SyntheticAccountSheet, number>,
  consolidationRowOffset: 3,
} as const;

export interface SyntheticTemplateOptions {
  headings?: SyntheticHeading[];
  /** Also add the cash sheet's totals to the consolidation row. */
  consolidateCash?: boolean;
  /** Analysis formula only down to `lastFormulaRow` (below the first data row: none at all). */
  truncate?: Array<{ sheet: SyntheticAccountSheet; position: number; lastFormulaRow: number }>;
  /** The main sheet's closing-balance cell reads this fixed row instead of the last data row. */
  staleClosingBalanceRow?: number;
  /** Number of trial-balance cells holding a broken reference. */
  brokenReferenceCells?: number;
  /** Heading position whose consolidated total the trial balance reads twice. */
  readTwicePosition?: number;
  /** Heading position whose consolidated total the trial balance does not read. */
  notReadPosition?: number;
  /** Data rows on every account sheet, instead of the defaults (for size tests). */
  dataRows?: number;
  /** More account sheets like the cash one, named "Account 1", "Account 2"… (for size tests). */
  extraAccountSheets?: number;
  /** Sample rows typed into the input cells of every account sheet's first data rows, as templates arrive. */
  sampleRows?: number;
  /** The date column's data cells have no date number format. */
  plainDateColumn?: boolean;
}

const blockLabels: Record<Exclude<HeadingGroup, "cost_of_sales">, string> = {
  income: "P&L INCOME",
  expenses: "P&L EXPENSES",
  assets: "BALANCE SHEET ASSETS",
  liabilities: "BALANCE SHEET LIABILITIES ",
  equity: "CAPITAL AND EQUITY",
};
const debitGroups = new Set<HeadingGroup>(["cost_of_sales", "expenses", "assets"]);

export function columnLetter(index: number): string {
  let letters = "";
  for (let n = index; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  return letters;
}

function quoted(sheet: string) {
  return `'${sheet.replace(/'/g, "''")}'`;
}

export async function buildSyntheticTemplate(options: SyntheticTemplateOptions = {}): Promise<Buffer> {
  const headings = options.headings ?? SYNTHETIC_HEADINGS;
  const { headingRow, firstDataRow, firstAnalysisColumn, columns } = SYNTHETIC_LAYOUT;
  const lastAnalysisColumn = firstAnalysisColumn + headings.length - 1;
  const col = columnLetter;
  const workbook = new ExcelJS.Workbook();
  const lastDataRow = (sheet: SyntheticAccountSheet) => firstDataRow + (options.dataRows ?? SYNTHETIC_LAYOUT.dataRows[sheet]) - 1;
  const totalsRow = (sheet: SyntheticAccountSheet) => lastDataRow(sheet) + 1;
  const consolidationRow = totalsRow("main") + SYNTHETIC_LAYOUT.consolidationRowOffset;
  const accountSheets: Array<[SyntheticAccountSheet | "extra", string]> = [
    ...(["main", "deposit", "cash"] as const).map((key): [SyntheticAccountSheet, string] => [key, SYNTHETIC_SHEETS[key]]),
    ...Array.from({ length: options.extraAccountSheets ?? 0 }, (_, i): ["extra", string] => ["extra", `Account ${i + 1}`]),
  ];

  for (const [key, name] of accountSheets) {
    const ws = workbook.addWorksheet(name);
    const last = lastDataRow(key === "extra" ? "cash" : key);
    const labels = ["Account", "Date", null, "Narrative", "Code", "Balance", "Amount"];
    labels.forEach((label, i) => {
      if (label) ws.getCell(headingRow, i + 1).value = label;
    });
    ws.getRow(headingRow).font = { bold: true };

    headings.forEach((heading, i) => {
      const c = firstAnalysisColumn + i;
      ws.getCell(headingRow, c).value = key === "main"
        ? heading.value
        : { formula: `+${quoted(SYNTHETIC_SHEETS.main)}!${col(c)}${headingRow}` };
      ws.getCell(headingRow - 1, c).value = debitGroups.has(heading.group) ? "Dr" : "Cr";
      if (key === "main" && heading.group === "cost_of_sales") ws.getCell(headingRow - 3, c).value = "Cost of sales";
    });

    // Block labels, merged over each block; the main sheet lacks the liabilities one.
    let start = 0;
    for (let i = 1; i <= headings.length; i++) {
      const group = (g: HeadingGroup) => (g === "cost_of_sales" ? "expenses" : g);
      if (i < headings.length && group(headings[i].group) === group(headings[start].group)) continue;
      const block = group(headings[start].group);
      const from = firstAnalysisColumn + start;
      const to = firstAnalysisColumn + i - 1;
      ws.getCell(headingRow - 2, from).value = key === "main" && block === "liabilities" ? 0 : blockLabels[block];
      if (to > from) ws.mergeCells(headingRow - 2, from, headingRow - 2, to);
      start = i;
    }

    const opening = ws.getCell(firstDataRow - 1, columns.balance);
    opening.value = 1000;
    ws.getCell(firstDataRow - 1, columns.narrative).value = "Opening balance";

    const truncated = new Map((options.truncate ?? []).filter((t) => t.sheet === key).map((t) => [firstAnalysisColumn + t.position - 1, t.lastFormulaRow]));
    let masterColumn = firstAnalysisColumn;
    while ((truncated.get(masterColumn) ?? last) < firstDataRow) masterColumn++;
    const master = `${col(masterColumn)}${firstDataRow}`;
    for (let r = firstDataRow; r <= last; r++) {
      ws.getCell(r, columns.balance).value = { formula: `+${col(columns.balance)}${r - 1}+${col(columns.amount)}${r}` };
      if (!options.plainDateColumn) ws.getCell(r, columns.date).numFmt = "dd/mm/yyyy";
      if (r - firstDataRow < (options.sampleRows ?? 0)) {
        ws.getCell(r, columns.date).value = new Date(Date.UTC(2020, 0, 1 + r));
        ws.getCell(r, columns.narrative).value = `Sample line ${r}`;
        ws.getCell(r, columns.code).value = "Sales";
        ws.getCell(r, columns.amount).value = 9.99;
      }
      ws.getCell(r, columns.amount).numFmt = "#,##0.00";
      ws.getCell(r, columns.code).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [`$${col(firstAnalysisColumn)}$${headingRow}:$${col(lastAnalysisColumn)}$${headingRow}`],
      };
      for (let c = firstAnalysisColumn; c <= lastAnalysisColumn; c++) {
        if (r > (truncated.get(c) ?? last)) continue;
        const cell = ws.getCell(r, c);
        if (`${col(c)}${r}` === master) {
          cell.value = {
            formula: `IF(${col(c)}$${headingRow}=$${col(columns.code)}${r},$${col(columns.amount)}${r},0)`,
            shareType: "shared",
            ref: `${master}:${col(lastAnalysisColumn)}${last}`,
          } as ExcelJS.CellFormulaValue;
        } else {
          cell.value = { sharedFormula: master } as ExcelJS.CellSharedFormulaValue;
        }
      }
      if (key === "main") ws.getCell(r, lastAnalysisColumn + 2).value = { formula: `SUM(${col(firstAnalysisColumn)}${r}:${col(lastAnalysisColumn)}${r})-${col(columns.amount)}${r}` };
    }

    const totals = last + 1;
    const closingRow = key === "main" && options.staleClosingBalanceRow ? options.staleClosingBalanceRow : last;
    ws.getCell(totals, columns.balance).value = { formula: `+${col(columns.balance)}${closingRow}` };
    for (let c = columns.amount; c <= lastAnalysisColumn; c++) {
      ws.getCell(totals, c).value = { formula: `SUM(${col(c)}${firstDataRow}:${col(c)}${last})` };
    }
  }

  const main = workbook.getWorksheet(SYNTHETIC_SHEETS.main)!;
  const consolidated: SyntheticAccountSheet[] = options.consolidateCash ? ["deposit", "cash"] : ["deposit"];
  for (let c = columns.amount; c <= lastAnalysisColumn; c++) {
    const others = consolidated.map((key) => `+${quoted(SYNTHETIC_SHEETS[key])}!${col(c)}${totalsRow(key)}`).join("");
    main.getCell(consolidationRow, c).value = { formula: `+${col(c)}${totalsRow("main")}${others}` };
  }

  const tb = workbook.addWorksheet(SYNTHETIC_SHEETS.trialBalance);
  tb.getCell("A1").value = "Trial balance";
  const mainRef = quoted(SYNTHETIC_SHEETS.main);
  let row = 3;
  const amountLine = (position: number) => {
    const c = firstAnalysisColumn + position - 1;
    const sign = debitGroups.has(headings[position - 1].group) ? "-" : "+";
    tb.getCell(row, 1).value = { formula: `+${mainRef}!${col(c)}${headingRow}` };
    if (position !== options.notReadPosition) tb.getCell(row, 2).value = { formula: `${sign}${mainRef}!${col(c)}$${consolidationRow}` };
    row++;
  };
  headings.forEach((_, i) => amountLine(i + 1));
  if (options.readTwicePosition) amountLine(options.readTwicePosition);
  for (let i = 0; i < (options.brokenReferenceCells ?? 0); i++) tb.getCell(3 + i, 4).value = { formula: "+#REF!+#REF!" };
  tb.getCell(row + 1, 1).value = "Check";
  tb.getCell(row + 1, 2).value = { formula: `SUM(B3:B${row - 1})` };

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
