import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { readTemplate } from "../../../src/modules/workbook/read-template";
import { TEMPLATE_MAX_BYTES } from "../../../src/modules/workbook/template-profile";
import { SYNTHETIC_SHEETS, buildSyntheticTemplate } from "../../fixtures/workbook/synthetic-template";

/** Central directory + end-of-central-directory record only; enough for the size gate. */
function zipDirectory(entries: Array<{ name: string; size: number }>, declaredCount = entries.length): Uint8Array {
  const names = entries.map((e) => new TextEncoder().encode(e.name));
  const directorySize = names.reduce((n, name) => n + 46 + name.length, 0);
  const bytes = new Uint8Array(directorySize + 22);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  entries.forEach((entry, i) => {
    view.setUint32(offset, 0x02014b50, true);
    view.setUint32(offset + 20, 100, true);
    view.setUint32(offset + 24, entry.size, true);
    view.setUint16(offset + 28, names[i].length, true);
    bytes.set(names[i], offset + 46);
    offset += 46 + names[i].length;
  });
  view.setUint32(offset, 0x06054b50, true);
  view.setUint16(offset + 8, declaredCount, true);
  view.setUint16(offset + 10, declaredCount, true);
  view.setUint32(offset + 12, directorySize, true);
  view.setUint32(offset + 16, 0, true);
  return bytes;
}

async function editSynthetic(edit: (workbook: ExcelJS.Workbook) => void): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load((await buildSyntheticTemplate()) as unknown as ExcelJS.Buffer);
  edit(workbook);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function timed<T>(work: () => Promise<T>): Promise<{ ms: number; result: T | unknown }> {
  const start = performance.now();
  const result = await work().catch((error: unknown) => error);
  return { ms: performance.now() - start, result };
}

describe("readTemplate limits", () => {
  it("refuses input larger than the byte limit", async () => {
    await expect(readTemplate(new Uint8Array(TEMPLATE_MAX_BYTES + 1))).rejects.toMatchObject({ code: "TOO_LARGE" });
  });

  it("refuses a zip whose central directory declares a huge uncompressed size", async () => {
    const bytes = zipDirectory([{ name: "xl/worksheets/sheet1.xml", size: 0xfffffffe }]);
    await expect(readTemplate(bytes)).rejects.toMatchObject({ code: "TOO_LARGE" });
  });

  it("refuses a zip with an absurd number of entries", async () => {
    const entries = Array.from({ length: 2001 }, (_, i) => ({ name: `x${i}`, size: 1 }));
    await expect(readTemplate(zipDirectory(entries))).rejects.toMatchObject({ code: "TOO_LARGE" });
  });

  it("treats a zip directory that does not fit the file as not a workbook", async () => {
    await expect(readTemplate(zipDirectory([{ name: "a", size: 1 }], 9))).rejects.toMatchObject({ code: "NOT_A_WORKBOOK" });
  });

  it("refuses a workbook with too many sheets", async () => {
    const workbook = new ExcelJS.Workbook();
    for (let i = 0; i < 65; i++) workbook.addWorksheet(`S${i}`);
    await expect(readTemplate(Buffer.from(await workbook.xlsx.writeBuffer()))).rejects.toMatchObject({ code: "TOO_LARGE" });
  });

  it("refuses an account sheet with too many rows or columns", async () => {
    const tallSheet = await editSynthetic((wb) => { wb.getWorksheet(SYNTHETIC_SHEETS.deposit)!.getCell(20_001, 1).value = 1; });
    await expect(readTemplate(tallSheet)).rejects.toMatchObject({ code: "TOO_LARGE" });
    const wideSheet = await editSynthetic((wb) => { wb.getWorksheet(SYNTHETIC_SHEETS.deposit)!.getCell(1, 401).value = 1; });
    await expect(readTemplate(wideSheet)).rejects.toMatchObject({ code: "TOO_LARGE" });
  });

  it("keeps whole-sheet ranges compact instead of expanding them", async () => {
    const bytes = await editSynthetic((wb) => {
      const tb = wb.getWorksheet(SYNTHETIC_SHEETS.trialBalance)!;
      for (let r = 1; r <= 500; r++) tb.getCell(r, 10).value = { formula: `SUM('${SYNTHETIC_SHEETS.main}'!A1:XFD1048576)` };
    });
    const { ms, result } = await timed(() => readTemplate(bytes));
    expect(ms).toBeLessThan(3000);
    expect(result).toMatchObject({ headings: expect.any(Array) });
  });

  it("refuses a workbook whose formulas hold too many references", async () => {
    const manyRefs = Array.from({ length: 500 }, (_, i) => `'${SYNTHETIC_SHEETS.main}'!A${i + 1}`).join("+");
    const bytes = await editSynthetic((wb) => {
      const tb = wb.getWorksheet(SYNTHETIC_SHEETS.trialBalance)!;
      for (let r = 1; r <= 300; r++) tb.getCell(r, 10).value = { formula: manyRefs };
    });
    await expect(readTemplate(bytes)).rejects.toMatchObject({ code: "TOO_LARGE" });
  });

  it("refuses an analysis formula pointing far outside the sheet without allocating", async () => {
    for (const formula of ["IF(H$1048576=$E7,$G7,0)", "IF(H$5=$XFD7,$G7,0)", "IF(H$5=$E7,$XFD7,0)"]) {
      const workbook = new ExcelJS.Workbook();
      const ws = workbook.addWorksheet("Odd");
      ws.getCell("B5").value = "Date";
      ws.getCell("D5").value = "Narrative";
      ws.getCell("H7").value = { formula };
      const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
      const { ms, result } = await timed(() => readTemplate(bytes));
      expect(result).toMatchObject({ name: "TemplateReadError", code: "UNRECOGNISED_LAYOUT" });
      expect(ms).toBeLessThan(1000);
    }
  });
});
