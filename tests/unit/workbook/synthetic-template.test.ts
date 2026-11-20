import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { SYNTHETIC_SHEETS, buildSyntheticTemplate } from "../../fixtures/workbook/synthetic-template";

describe("synthetic accounts template", () => {
  it("has the mechanism of the accountant's template", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await buildSyntheticTemplate()) as unknown as ExcelJS.Buffer);
    expect(workbook.worksheets.map((ws) => ws.name)).toEqual(Object.values(SYNTHETIC_SHEETS));

    const main = workbook.getWorksheet(SYNTHETIC_SHEETS.main)!;
    const deposit = workbook.getWorksheet(SYNTHETIC_SHEETS.deposit)!;

    // Analysis formulas are shared: the first cell holds the text, the rest point at it.
    expect(main.getCell("H7").formula).toBe("IF(H$5=$E7,$G7,0)");
    expect(main.getCell("I8").value).toMatchObject({ sharedFormula: "H7" });
    expect(main.getCell("I8").formula).toBe("IF(I$5=$E8,$G8,0)");
    expect(main.getCell("F7").formula).toBe("+F6+G7");
    expect(main.getCell("F6").value).toBe(1000);
    expect(main.getCell("G37").formula).toBe("SUM(G7:G36)");
    expect(main.getCell("H40").formula).toBe("+H37+'Deposit Account'!H27");
    expect(main.getCell("Y7").formula).toBe("SUM(H7:W7)-G7");

    // Headings typed on the main sheet, referenced from the others.
    expect(main.getCell("H5").value).toBe("Sales");
    expect(deposit.getCell("H5").formula).toBe("+'Current Account'!H5");

    // Block labels merged over each block; the main sheet lacks the liabilities one.
    expect(main.getCell("I3").value).toBe("P&L INCOME");
    expect(main.getCell("T3").value).toBe(0);
    expect(deposit.getCell("T3").value).toBe("BALANCE SHEET LIABILITIES ");
    expect(main.getCell("J2").value).toBe("Cost of sales");

    // Something for the export's "nothing else changed" proof to protect.
    expect(main.getCell("E7").dataValidation).toMatchObject({ type: "list", formulae: ["$H$5:$W$5"] });
    expect(main.getCell("G7").numFmt).toBe("#,##0.00");
    expect(main.getCell("H5").font?.bold).toBe(true);

    const tb = workbook.getWorksheet(SYNTHETIC_SHEETS.trialBalance)!;
    expect(tb.getCell("A3").formula).toBe("+'Current Account'!H5");
    expect(tb.getCell("B3").formula).toBe("+'Current Account'!H$40");
    expect(tb.getCell("B5").formula).toBe("-'Current Account'!J$40");
  });
});
