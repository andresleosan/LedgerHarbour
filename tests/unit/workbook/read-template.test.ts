import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";

import { readTemplate } from "../../../src/modules/workbook/read-template";
import { TemplateReadError, type TemplateDefect, type TemplateProfile } from "../../../src/modules/workbook/template-profile";
import {
  SYNTHETIC_HEADINGS,
  SYNTHETIC_SHEETS,
  buildSyntheticTemplate,
  type SyntheticTemplateOptions,
} from "../../fixtures/workbook/synthetic-template";

const read = async (options?: SyntheticTemplateOptions) => readTemplate(await buildSyntheticTemplate(options));
const sheet = (profile: TemplateProfile, name: string) => profile.sheets.find((s) => s.name === name)!;
const heading = (profile: TemplateProfile, position: number) => profile.headings.find((h) => h.position === position)!;
const defects = (profile: TemplateProfile, code: TemplateDefect["code"]) => profile.defects.filter((d) => d.code === code);

// Positions in the synthetic template: analysis columns start at column 8 (H).
const P = (index: number) => 7 + index;

describe("readTemplate on the synthetic template", () => {
  let profile: TemplateProfile;
  beforeAll(async () => {
    profile = await read();
  });

  it("finds the account sheets by structure, with their columns and rows", () => {
    expect(profile.sheets.map((s) => s.name)).toEqual([SYNTHETIC_SHEETS.main, SYNTHETIC_SHEETS.deposit, SYNTHETIC_SHEETS.cash]);
    expect(sheet(profile, SYNTHETIC_SHEETS.main)).toEqual({
      name: SYNTHETIC_SHEETS.main,
      dateColumn: 2,
      narrativeColumn: 4,
      codeColumn: 5,
      balanceColumn: 6,
      amountColumn: 7,
      headingRow: 5,
      openingBalanceCell: "F6",
      firstDataRow: 7,
      lastDataRow: 36,
      totalsRow: 37,
      safeLastRow: 36,
      consolidated: true,
    });
    expect(sheet(profile, SYNTHETIC_SHEETS.deposit)).toMatchObject({ firstDataRow: 7, lastDataRow: 26, totalsRow: 27, safeLastRow: 26, consolidated: true });
    expect(sheet(profile, SYNTHETIC_SHEETS.cash)).toMatchObject({ lastDataRow: 26, consolidated: false });
  });

  it("returns the headings in order with their typed value, value type and group from the block labels", () => {
    expect(profile.headings).toHaveLength(SYNTHETIC_HEADINGS.length);
    profile.headings.forEach((h, i) => {
      const expected = SYNTHETIC_HEADINGS[i];
      expect(h.position).toBe(P(i + 1));
      expect(h.order).toBe(i);
      expect(h.group).toBe(expected.group);
      expect(h.valueType).toBe(typeof expected.value === "number" ? "number" : "text");
      expect(h.templateValue).toBe(expected.value === null ? "" : String(expected.value));
    });
    expect(heading(profile, P(2)).templateValue).toBe("Sundry income ");
    expect(heading(profile, P(7))).toMatchObject({ templateValue: "17", valueType: "number" });
  });

  it("blocks the blank heading and the one marked not to be used, and nothing else", () => {
    expect(profile.headings.filter((h) => h.blockedReason).map((h) => [h.position, h.blockedReason])).toEqual([
      [P(8), "blank_heading"],
      [P(9), "marked_do_not_use"],
    ]);
  });

  it("reports the informational heading defects and the unconsolidated cash sheet", () => {
    expect(profile.defects).toHaveLength(5);
    expect(profile.defects).toEqual(expect.arrayContaining([
      { code: "BLANK_HEADING", position: P(8), detail: {} },
      { code: "TRAILING_SPACE", position: P(2), detail: {} },
      { code: "NUMERIC_HEADING", position: P(7), detail: {} },
      { code: "NUMERIC_HEADING", position: P(12), detail: {} },
      { code: "UNCONSOLIDATED_SHEET", sheet: SYNTHETIC_SHEETS.cash, detail: {} },
    ]));
  });
});

describe("readTemplate defects on demand", () => {
  it("reports nothing on a template without defects", async () => {
    const headings = SYNTHETIC_HEADINGS.map((h, i) => ({ ...h, value: `Heading ${i + 1}` }));
    const profile = await read({ headings, consolidateCash: true });
    expect(profile.defects).toEqual([]);
    expect(profile.headings.every((h) => h.blockedReason === null)).toBe(true);
    expect(profile.sheets.every((s) => s.consolidated)).toBe(true);
  });

  it("reports a truncated analysis column and lowers the safe last row of that sheet only", async () => {
    const profile = await read({ truncate: [{ sheet: "main", position: 3, lastFormulaRow: 20 }] });
    expect(defects(profile, "TRUNCATED_ANALYSIS_COLUMN")).toEqual([
      { code: "TRUNCATED_ANALYSIS_COLUMN", sheet: SYNTHETIC_SHEETS.main, position: P(3), detail: { lastFormulaRow: 20, lastDataRow: 36 } },
    ]);
    expect(sheet(profile, SYNTHETIC_SHEETS.main).safeLastRow).toBe(20);
    expect(sheet(profile, SYNTHETIC_SHEETS.deposit).safeLastRow).toBe(26);
    expect(heading(profile, P(3)).blockedReason).toBeNull();
  });

  it("blocks a heading whose formula is missing on every data row of a sheet", async () => {
    const profile = await read({ truncate: [{ sheet: "deposit", position: 1, lastFormulaRow: 6 }] });
    expect(heading(profile, P(1)).blockedReason).toBe("truncated_formula");
    expect(defects(profile, "TRUNCATED_ANALYSIS_COLUMN")).toEqual([
      { code: "TRUNCATED_ANALYSIS_COLUMN", sheet: SYNTHETIC_SHEETS.deposit, position: P(1), detail: { lastFormulaRow: 6, lastDataRow: 26 } },
    ]);
    expect(sheet(profile, SYNTHETIC_SHEETS.deposit).safeLastRow).toBe(26);
  });

  it("reports a truncated blocked column without lowering the safe last row", async () => {
    const profile = await read({ truncate: [{ sheet: "main", position: 8, lastFormulaRow: 10 }] });
    expect(defects(profile, "TRUNCATED_ANALYSIS_COLUMN")).toHaveLength(1);
    expect(sheet(profile, SYNTHETIC_SHEETS.main).safeLastRow).toBe(36);
  });

  it("counts broken references per sheet", async () => {
    const profile = await read({ brokenReferenceCells: 3 });
    expect(defects(profile, "BROKEN_REFERENCE")).toEqual([
      { code: "BROKEN_REFERENCE", sheet: SYNTHETIC_SHEETS.trialBalance, detail: { cells: 3 } },
    ]);
  });

  it("reports a closing balance that reads a fixed row", async () => {
    const profile = await read({ staleClosingBalanceRow: 12 });
    expect(defects(profile, "STALE_CLOSING_BALANCE")).toEqual([
      { code: "STALE_CLOSING_BALANCE", sheet: SYNTHETIC_SHEETS.main, detail: { referencedRow: 12, lastDataRow: 36 } },
    ]);
  });

  it("blocks a heading whose total the trial balance reads twice", async () => {
    const profile = await read({ readTwicePosition: 1 });
    expect(defects(profile, "HEADING_TOTAL_READ_TWICE")).toEqual([{ code: "HEADING_TOTAL_READ_TWICE", position: P(1), detail: { reads: 2 } }]);
    expect(heading(profile, P(1)).blockedReason).toBe("total_read_twice");
  });

  it("blocks a heading whose total the trial balance does not read", async () => {
    const profile = await read({ notReadPosition: 2 });
    expect(defects(profile, "HEADING_TOTAL_NOT_READ")).toEqual([{ code: "HEADING_TOTAL_NOT_READ", position: P(2), detail: {} }]);
    expect(heading(profile, P(2)).blockedReason).toBe("total_not_read");
  });

  it("keeps the blocking precedence: blank before an unread total", async () => {
    const profile = await read({ notReadPosition: 8 });
    expect(defects(profile, "HEADING_TOTAL_NOT_READ")).toHaveLength(1);
    expect(heading(profile, P(8)).blockedReason).toBe("blank_heading");
  });
});

describe("readTemplate errors", () => {
  it("rejects bytes that are not a workbook", async () => {
    await expect(readTemplate(Buffer.from("not a workbook"))).rejects.toMatchObject({ name: "TemplateReadError", code: "NOT_A_WORKBOOK" });
  });

  it("rejects a workbook with no account sheet", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Notes").getCell("A1").value = { formula: "IF(A2=1,B2,0)" };
    const error = await readTemplate(Buffer.from(await workbook.xlsx.writeBuffer())).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TemplateReadError);
    expect(error).toMatchObject({ code: "NO_ACCOUNT_SHEET" });
  });
});
