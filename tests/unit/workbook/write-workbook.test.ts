import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";

import { readTemplate } from "../../../src/modules/workbook/read-template";
import type { AccountSheet, TemplateProfile } from "../../../src/modules/workbook/template-profile";
import { cellText, fillWorkbook, readWrittenRows, type WriteRow, type WriteSheet } from "../../../src/modules/workbook/write-workbook";
import { SYNTHETIC_HEADINGS, SYNTHETIC_SHEETS, buildSyntheticTemplate, columnLetter } from "../../fixtures/workbook/synthetic-template";
import { rawEntries, unzip, zip } from "../../fixtures/workbook/zip";

const PART = { main: "xl/worksheets/sheet1.xml", deposit: "xl/worksheets/sheet2.xml", cash: "xl/worksheets/sheet3.xml" } as const;
const text = (value: string): WriteRow["code"] => ({ value, type: "text" });
const row = (date: string, narrative: string, code: WriteRow["code"], amount: string): WriteRow => ({ date, narrative, code, amount });

// Every case the export must carry exactly: a trailing-space heading, a numeric one,
// escaped and non-ASCII text, leading and trailing spaces, pence that a float would lose.
const MAIN_ROWS: WriteRow[] = [
  row("2026-04-06", "Takings & tips <till 1>", text("Sales"), "1250.10"),
  row("2026-04-06", '  "Quoted" supplier \'A\' 😀  ', text("Premises"), "-12.30"),
  row("2026-05-31", "Interest", text("Sundry income "), "0.01"),
  row("2027-04-05", "Placeholder", { value: "17", type: "number" }, "-999999999999.99"),
  row("2026-12-25", "Refund on rent", text("Premises"), "45.67"),
];
const DEPOSIT_ROWS: WriteRow[] = [row("2026-06-01", "Transfer in", text("Owner capital"), "500.00")];
const CASH_ROWS: WriteRow[] = [
  row("2026-07-01", "Float top-up", text("Owner capital"), "20.00"),
  row("2026-07-02", "Stamps", text("Phone"), "-1.20"),
];

function sheetsToWrite(): WriteSheet[] {
  return [
    { sheetName: SYNTHETIC_SHEETS.main, openingBalance: "-12.30", rows: MAIN_ROWS },
    { sheetName: SYNTHETIC_SHEETS.deposit, openingBalance: "0.00", rows: DEPOSIT_ROWS },
    { sheetName: SYNTHETIC_SHEETS.cash, openingBalance: null, rows: CASH_ROWS },
  ];
}

/** A sheet's XML split into the part outside `<sheetData>`, its row tags and its raw cells by address. */
function splitSheet(xml: string) {
  const start = xml.indexOf("<sheetData>");
  const end = xml.indexOf("</sheetData>");
  const data = xml.slice(start, end);
  return {
    outside: xml.slice(0, start) + xml.slice(end),
    rows: new Map([...data.matchAll(/<row r="(\d+)"[^>]*>/g)].map((m) => [Number(m[1]), m[0]])),
    cells: new Map([...data.matchAll(/<c r="([A-Z]+\d+)"[^>]*?(?:\/>|>.*?<\/c>)/g)].map((m) => [m[1], m[0]])),
  };
}

function inputAddresses(sheet: AccountSheet): Set<string> {
  const addresses = new Set([sheet.openingBalanceCell]);
  for (let r = sheet.firstDataRow; r <= sheet.lastDataRow; r++) {
    for (const c of [sheet.dateColumn, sheet.narrativeColumn, sheet.codeColumn, sheet.amountColumn]) addresses.add(`${columnLetter(c)}${r}`);
  }
  return addresses;
}

function expectOnlyInputsChanged(before: string, after: string, sheet: AccountSheet) {
  const [a, b] = [splitSheet(before), splitSheet(after)];
  expect(b.outside).toBe(a.outside);
  for (const [r, tag] of a.rows) expect(b.rows.get(r)).toBe(tag);
  const allowed = inputAddresses(sheet);
  const addresses = new Set([...a.cells.keys(), ...b.cells.keys()]);
  let formulas = 0;
  for (const address of addresses) {
    if (allowed.has(address)) continue;
    expect(b.cells.get(address), address).toBe(a.cells.get(address));
    if (a.cells.get(address)?.includes("<f")) formulas++;
  }
  // Masters and clones alike, byte for byte.
  expect(formulas).toBe([...b.cells.values()].filter((cell) => cell.includes("<f")).length);
  expect(formulas).toBeGreaterThan(sheet.lastDataRow - sheet.firstDataRow);
}

function entry(bytes: Buffer, name: string): string {
  return unzip(bytes).find((e) => e.name === name)!.data.toString("utf8");
}

function patchEntry(bytes: Buffer, name: string, edit: (xml: string) => string): Buffer {
  return zip(unzip(bytes).map((e) => (e.name === name ? { ...e, data: Buffer.from(edit(e.data.toString("utf8"))) } : e)));
}

const sheetOf = (profile: TemplateProfile, name: string) => profile.sheets.find((s) => s.name === name)!;

describe("fillWorkbook on the synthetic template", () => {
  let template: Buffer;
  let profile: TemplateProfile;
  let filled: ReturnType<typeof fillWorkbook>;
  beforeAll(async () => {
    template = await buildSyntheticTemplate({ sampleRows: 4 });
    profile = await readTemplate(template);
    filled = fillWorkbook(template, profile, sheetsToWrite());
  });

  it("changes nothing but the input cells, the opening cells and the recalculation flag", () => {
    const before = rawEntries(template);
    const after = rawEntries(filled.bytes);
    expect(after.map((e) => e.name)).toEqual(before.map((e) => e.name));
    const rewritten = new Set([...Object.values(PART), "xl/workbook.xml"]);
    for (const [i, original] of before.entries()) {
      if (rewritten.has(original.name)) continue;
      expect({ name: after[i].name, method: after[i].method, crc: after[i].crc }).toEqual({ name: original.name, method: original.method, crc: original.crc });
      expect(after[i].compressed.equals(original.compressed), original.name).toBe(true);
      expect(after[i].data.equals(original.data), original.name).toBe(true);
    }

    const workbook = before.find((e) => e.name === "xl/workbook.xml")!.data.toString();
    expect(workbook).toContain('<calcPr calcId="171027"/>');
    expect(entry(filled.bytes, "xl/workbook.xml")).toBe(workbook.replace('<calcPr calcId="171027"/>', '<calcPr calcId="171027" fullCalcOnLoad="1"/>'));

    for (const [key, name] of [["main", SYNTHETIC_SHEETS.main], ["deposit", SYNTHETIC_SHEETS.deposit], ["cash", SYNTHETIC_SHEETS.cash]] as const) {
      expectOnlyInputsChanged(entry(template, PART[key]), entry(filled.bytes, PART[key]), sheetOf(profile, name));
    }
  });

  it("keeps each cell's style and date format, and writes amounts and numeric codes as numbers", () => {
    const main = splitSheet(entry(filled.bytes, PART.main)).cells;
    expect(main.get("B7")).toBe('<c r="B7" s="2"><v>46118</v></c>');
    expect(main.get("G8")).toBe('<c r="G8" s="3"><v>-12.30</v></c>');
    expect(main.get("E10")).toBe('<c r="E10"><v>17</v></c>');
    expect(main.get("E9")).toBe('<c r="E9" t="inlineStr"><is><t xml:space="preserve">Sundry income </t></is></c>');
    expect(main.get("F6")).toBe('<c r="F6"><v>-12.30</v></c>');
    expect(entry(filled.bytes, "xl/styles.xml")).toBe(entry(template, "xl/styles.xml"));
  });

  it("reads back exactly the rows and opening balances written", () => {
    const read = readWrittenRows(filled.bytes, profile);
    expect(read).toEqual([
      { sheetName: SYNTHETIC_SHEETS.main, openingBalance: "-12.30", rows: MAIN_ROWS },
      { sheetName: SYNTHETIC_SHEETS.deposit, openingBalance: "0.00", rows: DEPOSIT_ROWS },
      { sheetName: SYNTHETIC_SHEETS.cash, openingBalance: "1000.00", rows: CASH_ROWS },
    ]);
  });

  it("leaves the profile unchanged and opens in a workbook library with the written values", async () => {
    expect(await readTemplate(filled.bytes)).toEqual(profile);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(filled.bytes as unknown as ExcelJS.Buffer);
    const main = workbook.getWorksheet(SYNTHETIC_SHEETS.main)!;
    expect(main.getCell("B7").value).toEqual(new Date(Date.UTC(2026, 3, 6)));
    expect(main.getCell("D8").value).toBe(MAIN_ROWS[1].narrative);
    expect(main.getCell("E9").value).toBe("Sundry income ");
    expect(main.getCell("E10").value).toBe(17);
    expect(main.getCell("G7").value).toBe(1250.1);
    expect(main.getCell("F6").value).toBe(-12.3);
    expect(main.getCell("H7").formula).toBe("IF(H$5=$E7,$G7,0)");
    expect(workbook.getWorksheet(SYNTHETIC_SHEETS.cash)!.getCell("E8").value).toBe("Phone");
  });

  it("clears and counts the template's sample rows", () => {
    expect(filled.written).toEqual([
      { sheetName: SYNTHETIC_SHEETS.main, rowsWritten: 5, clearedTemplateRows: 4 },
      { sheetName: SYNTHETIC_SHEETS.deposit, rowsWritten: 1, clearedTemplateRows: 4 },
      { sheetName: SYNTHETIC_SHEETS.cash, rowsWritten: 2, clearedTemplateRows: 4 },
    ]);
    const deposit = splitSheet(entry(filled.bytes, PART.deposit)).cells;
    for (const address of ["B8", "D8", "E8", "G8", "B10", "D10", "E10", "G10"]) expect(deposit.get(address) ?? "", address).not.toMatch(/<v>|<is>/);
    expect(deposit.get("G10")).toBe('<c r="G10" s="3"/>');
  });

  it("writes the hostile text of a heading and a narrative so the file still parses", async () => {
    const hostile = 'Fees & "charges" <b>]]></t></is></c><c r="Z9"><v>1</v></c>';
    const headings = SYNTHETIC_HEADINGS.map((h, i) => (i === 0 ? { ...h, value: hostile } : h));
    const own = await buildSyntheticTemplate({ headings });
    const ownProfile = await readTemplate(own);
    expect(ownProfile.headings[0]).toMatchObject({ templateValue: hostile, blockedReason: null });
    const narrative = "\u0001a]]></c>\u0008b\u000b\r\n\tc\uFFFE\uD800 _x0041_ end";
    const rows = [row("2026-04-06", narrative, text(hostile), "1.00")];
    const { bytes } = fillWorkbook(own, ownProfile, [{ sheetName: SYNTHETIC_SHEETS.main, openingBalance: null, rows }]);
    expect(await readTemplate(bytes)).toEqual(ownProfile);
    const [main] = readWrittenRows(bytes, ownProfile);
    expect(main.rows).toEqual([{ ...rows[0], narrative: "a]]></c>b\r\n\tc _x0041_ end" }]);
    expect(cellText(narrative)).toBe("a]]></c>b\r\n\tc _x0041_ end");
    expect(splitSheet(entry(bytes, PART.main)).cells.has("Z9")).toBe(false);
  });
});

describe("fillWorkbook date styles and structure", () => {
  it("adds one date format when the date column has none, and uses it for the dates only", async () => {
    const template = await buildSyntheticTemplate({ plainDateColumn: true });
    const profile = await readTemplate(template);
    const { bytes } = fillWorkbook(template, profile, sheetsToWrite());
    const before = entry(template, "xl/styles.xml");
    const after = entry(bytes, "xl/styles.xml");
    const xfs = (xml: string) => [...xml.matchAll(/<xf [^>]*\/>/g)].map((m) => m[0]);
    const added = '<xf applyNumberFormat="1" numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0"/>';
    expect(before).toContain('<cellXfs count="3">');
    expect(after).toBe(before.replace('<cellXfs count="3">', '<cellXfs count="4">').replace("</cellXfs>", `${added}</cellXfs>`));
    expect(xfs(after)).toHaveLength(xfs(before).length + 1);

    const main = splitSheet(entry(bytes, PART.main)).cells;
    expect(main.get("B7")).toBe('<c r="B7" s="3"><v>46118</v></c>');
    expect(main.get("G7")).toBe('<c r="G7" s="2"><v>1250.10</v></c>');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
    expect(workbook.getWorksheet(SYNTHETIC_SHEETS.main)!.getCell("B7").value).toEqual(new Date(Date.UTC(2026, 3, 6)));
    expect(readWrittenRows(bytes, profile)[0].rows).toEqual(MAIN_ROWS);

    for (const [key, name] of [["main", SYNTHETIC_SHEETS.main], ["cash", SYNTHETIC_SHEETS.cash]] as const) {
      expectOnlyInputsChanged(entry(template, PART[key]), entry(bytes, PART[key]), sheetOf(profile, name));
    }
  });

  it("adds the recalculation flag where calcPr belongs when the workbook has none", async () => {
    const base = await buildSyntheticTemplate();
    const profile = await readTemplate(base);
    const write = (bytes: Buffer) => entry(fillWorkbook(bytes, profile, []).bytes, "xl/workbook.xml");
    const without = patchEntry(base, "xl/workbook.xml", (xml) => xml.replace('<calcPr calcId="171027"/>', ""));
    expect(write(without)).toMatch(/<\/sheets><calcPr fullCalcOnLoad="1"\/><\/workbook>$/);
    const withExt = patchEntry(base, "xl/workbook.xml", (xml) => xml.replace('<calcPr calcId="171027"/>', "<extLst/>"));
    expect(write(withExt)).toContain('</sheets><calcPr fullCalcOnLoad="1"/><extLst/></workbook>');
    const withFlag = patchEntry(base, "xl/workbook.xml", (xml) => xml.replace('<calcPr calcId="171027"/>', '<calcPr fullCalcOnLoad="0" calcId="1"/>'));
    expect(write(withFlag)).toContain('<calcPr fullCalcOnLoad="1" calcId="1"/>');
  });

  it("creates a missing row in order, and the cells in column order", async () => {
    const base = await buildSyntheticTemplate();
    const template = patchEntry(base, PART.main, (xml) => xml.replace(/<row r="6"[^>]*>.*?<\/row>/, ""));
    const profile = await readTemplate(template);
    const { bytes } = fillWorkbook(template, profile, [{ sheetName: SYNTHETIC_SHEETS.main, openingBalance: "5.00", rows: MAIN_ROWS.slice(0, 1) }]);
    const xml = entry(bytes, PART.main);
    expect(xml).toMatch(/<\/row><row r="6"><c r="F6"><v>5.00<\/v><\/c><\/row><row r="7"/);
    const cells = [...splitSheet(xml).cells.keys()].filter((address) => /^[A-Z]+7$/.test(address));
    expect(cells.slice(0, 5)).toEqual(["B7", "D7", "E7", "F7", "G7"]);
    expect(readWrittenRows(bytes, profile)[0].openingBalance).toBe("5.00");
  });
});

describe("fillWorkbook refusals", () => {
  let template: Buffer;
  let profile: TemplateProfile;
  beforeAll(async () => {
    template = await buildSyntheticTemplate();
    profile = await readTemplate(template);
  });
  const fill = (rows: WriteRow[], sheetName: string = SYNTHETIC_SHEETS.main, bytes = template) => () => fillWorkbook(bytes, profile, [{ sheetName, openingBalance: null, rows }]);
  const one = (change: Partial<WriteRow>) => [{ ...MAIN_ROWS[0], ...change }];

  it("refuses a sheet that is not an account sheet of the profile", () => {
    expect(fill([], SYNTHETIC_SHEETS.trialBalance)).toThrow(expect.objectContaining({ code: "UNKNOWN_SHEET" }));
    expect(fill([], "Nowhere")).toThrow(expect.objectContaining({ code: "UNKNOWN_SHEET" }));
  });

  it("refuses more rows than the sheet's safe capacity", async () => {
    const rows = Array.from({ length: 21 }, () => MAIN_ROWS[0]);
    expect(fill(rows.slice(0, 20), SYNTHETIC_SHEETS.deposit)).not.toThrow();
    expect(fill(rows, SYNTHETIC_SHEETS.deposit)).toThrow(expect.objectContaining({ code: "TOO_MANY_ROWS", detail: { sheet: SYNTHETIC_SHEETS.deposit } }));
    const truncated = await buildSyntheticTemplate({ truncate: [{ sheet: "deposit", position: 1, lastFormulaRow: 10 }] });
    const truncatedProfile = await readTemplate(truncated);
    expect(sheetOf(truncatedProfile, SYNTHETIC_SHEETS.deposit).safeLastRow).toBe(10);
    expect(() => fillWorkbook(truncated, truncatedProfile, [{ sheetName: SYNTHETIC_SHEETS.deposit, openingBalance: null, rows: rows.slice(0, 5) }]))
      .toThrow(expect.objectContaining({ code: "TOO_MANY_ROWS" }));
  });

  it("refuses to overwrite a formula in an input cell, written or cleared", () => {
    const formulaAt = (address: string) => patchEntry(template, PART.main, (xml) => xml.replace(new RegExp(`<c r="${address}"( s="\\d+")?/>`), `<c r="${address}"$1><f>TODAY()</f></c>`));
    expect(fill(MAIN_ROWS, SYNTHETIC_SHEETS.main, formulaAt("B8"))).toThrow(expect.objectContaining({ code: "INPUT_CELL_HAS_FORMULA", detail: { sheet: SYNTHETIC_SHEETS.main, cell: "B8" } }));
    expect(fill([], SYNTHETIC_SHEETS.main, formulaAt("G30"))).toThrow(expect.objectContaining({ code: "INPUT_CELL_HAS_FORMULA", detail: { sheet: SYNTHETIC_SHEETS.main, cell: "G30" } }));
    const merged = patchEntry(template, PART.main, (xml) => xml.replace('<mergeCell ref="H3:I3"/>', '<mergeCell ref="H3:I3"/><mergeCell ref="D8:E8"/>').replace('count="5"', 'count="6"'));
    expect(fill(MAIN_ROWS, SYNTHETIC_SHEETS.main, merged)).toThrow(expect.objectContaining({ code: "INPUT_CELL_MERGED" }));
  });

  it("refuses a code that is not exactly one usable heading", () => {
    for (const code of [text("Motor - do not use"), text(""), text("sales"), text("Sundry income"), { value: "17", type: "text" as const }, text("Unknown"), { value: "18", type: "number" as const }]) {
      expect(fill(one({ code })), JSON.stringify(code)).toThrow(expect.objectContaining({ code: "INVALID_CODE" }));
    }
  });

  it("refuses an amount that is zero or not pounds with two decimals, and an invalid date", () => {
    for (const amount of ["0.00", "-0.00", "1.5", "1", "1e3", "01.00", " 1.00", "1.001"]) {
      expect(fill(one({ amount })), amount).toThrow(expect.objectContaining({ code: "INVALID_AMOUNT" }));
    }
    expect(() => fillWorkbook(template, profile, [{ sheetName: SYNTHETIC_SHEETS.main, openingBalance: "1", rows: [] }])).toThrow(expect.objectContaining({ code: "INVALID_AMOUNT" }));
    for (const date of ["2026-02-30", "2026-4-1", "1900-02-28", "06/04/2026", ""]) {
      expect(fill(one({ date })), date).toThrow(expect.objectContaining({ code: "INVALID_DATE" }));
    }
  });

  it("refuses a workbook in the 1904 date system", () => {
    const bytes = patchEntry(template, "xl/workbook.xml", (xml) => xml.replace("<workbookPr ", '<workbookPr date1904="1" '));
    expect(fill([], SYNTHETIC_SHEETS.main, bytes)).toThrow(expect.objectContaining({ code: "DATE1904_UNSUPPORTED" }));
  });
});
