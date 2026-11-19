import { describe, expect, it } from "vitest";

import { readTemplate } from "../../../src/modules/workbook/read-template";
import { buildSyntheticTemplate } from "../../fixtures/workbook/synthetic-template";
import { unzip, zip } from "../../fixtures/workbook/zip";

const SHEET = "xl/worksheets/sheet1.xml";
const WHOLE_SHEET = "A1:XFD1048576";

/** The synthetic template with one entry's XML patched, re-zipped with stored entries. */
async function patched(name: string, edit: (xml: string) => string): Promise<Buffer> {
  const entries = unzip(await buildSyntheticTemplate());
  const entry = entries.find((e) => e.name === name)!;
  const before = entry.data.toString("utf8");
  const after = edit(before);
  expect(after).not.toBe(before);
  entry.data = Buffer.from(after, "utf8");
  return zip(entries);
}

// Generous bounds for a loaded machine. A regression here looks like minutes of CPU
// or running out of memory: exceljs expands these ranges cell by cell on load.
async function refusedQuickly(bytes: Buffer, code: string) {
  const start = performance.now();
  const error = await readTemplate(bytes).catch((e: unknown) => e);
  expect(error).toMatchObject({ name: "TemplateReadError", code });
  expect(performance.now() - start).toBeLessThan(10_000);
}

describe("readTemplate zip inspection", () => {
  it("still reads the synthetic template after a stored re-zip", async () => {
    const profile = await readTemplate(zip(unzip(await buildSyntheticTemplate())));
    expect(profile.sheets).toHaveLength(3);
  });

  it("refuses a merged range covering the whole sheet without loading it", async () => {
    await refusedQuickly(await patched(SHEET, (xml) => xml.replace('<mergeCell ref="H3:I3"/>', `<mergeCell ref="${WHOLE_SHEET}"/>`)), "TOO_LARGE");
  }, 20_000);

  it("refuses a data validation over the whole sheet", async () => {
    await refusedQuickly(await patched(SHEET, (xml) => xml.replace('sqref="E7:E36"', `sqref="E7 ${WHOLE_SHEET}"`)), "TOO_LARGE");
  }, 20_000);

  it("allows a whole-column data validation, which is not expanded on load", async () => {
    const profile = await readTemplate(await patched(SHEET, (xml) => xml.replace('sqref="E7:E36"', 'sqref="E:E"')));
    expect(profile.sheets).toHaveLength(3);
  });

  it("refuses a shared formula whose range covers the whole sheet", async () => {
    await refusedQuickly(await patched(SHEET, (xml) => xml.replace('ref="H7:W36"', `ref="${WHOLE_SHEET}"`)), "TOO_LARGE");
  }, 20_000);

  it("refuses a sheet dimension covering the whole sheet", async () => {
    await refusedQuickly(await patched(SHEET, (xml) => xml.replace(/<dimension ref="[^"]+"/, `<dimension ref="${WHOLE_SHEET}"`)), "TOO_LARGE");
  }, 20_000);

  it("refuses a defined name covering the whole sheet", async () => {
    const definedName = `<definedNames><definedName name="Everything">'Current Account'!$A$1:$XFD$1048576</definedName></definedNames>`;
    await refusedQuickly(await patched("xl/workbook.xml", (xml) => xml.replace("<calcPr", `${definedName}<calcPr`)), "TOO_LARGE");
  }, 20_000);

  it("refuses an entry whose real inflated size exceeds the cap while its declared size is small", async () => {
    const entries = unzip(await buildSyntheticTemplate());
    entries.push({ name: "xl/padding.xml", data: Buffer.alloc(65 * 1024 * 1024, 0x20), method: 8, declaredSize: 100 });
    await refusedQuickly(zip(entries), "TOO_LARGE");
  }, 20_000);

  it("treats a corrupt deflated entry as not a workbook", async () => {
    const entries = unzip(await buildSyntheticTemplate());
    const bytes = zip([...entries, { name: "xl/broken.xml", data: Buffer.from("x".repeat(200)), method: 8 }]);
    // Corrupt the deflated body of the last entry (it starts after its 30-byte header and name).
    const offset = bytes.lastIndexOf(Buffer.from("xl/broken.xml"));
    const local = bytes.lastIndexOf(Buffer.from("xl/broken.xml"), offset - 1);
    bytes.fill(0xff, local + "xl/broken.xml".length, local + "xl/broken.xml".length + 4);
    await refusedQuickly(bytes, "NOT_A_WORKBOOK");
  }, 20_000);
});
