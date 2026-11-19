import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { readTemplate, readTemplateWithin } from "../../../src/modules/workbook/read-template";
import type { TemplateProfile } from "../../../src/modules/workbook/template-profile";
import { buildSyntheticTemplate, type SyntheticTemplateOptions } from "../../fixtures/workbook/synthetic-template";
import { unzip, zip } from "../../fixtures/workbook/zip";

// The reader parses the SpreadsheetML parts itself: text as an XML parser decodes it,
// and anything it cannot read plainly is refused.

const SHEET = "xl/worksheets/sheet1.xml";
const STRINGS = "xl/sharedStrings.xml";
// Positions in the synthetic template: analysis columns start at column 8 (H).
const P = (index: number) => 7 + index;
const heading = (profile: TemplateProfile, position: number) => profile.headings.find((h) => h.position === position)!;

/** The synthetic template with some entries' XML patched, re-zipped. */
async function patched(edits: Record<string, (xml: string) => string>, options?: SyntheticTemplateOptions): Promise<Buffer> {
  const entries = unzip(await buildSyntheticTemplate(options));
  for (const [name, edit] of Object.entries(edits)) {
    const entry = entries.find((e) => e.name === name)!;
    const before = entry.data.toString("utf8");
    const after = edit(before);
    expect(after).not.toBe(before);
    entry.data = Buffer.from(after, "utf8");
  }
  return zip(entries);
}

const refused = async (bytes: Buffer, code: string) =>
  expect(readTemplate(bytes)).rejects.toMatchObject({ name: "TemplateReadError", code });

describe("readTemplate text", () => {
  it("decodes entities and character references in a shared-string heading", async () => {
    const bytes = await patched({ [STRINGS]: (xml) => xml.replace("<si><t>Sales</t></si>", "<si><t>Sales &amp; returns &#38; &#x3C;more&gt;</t></si>") });
    expect(heading(await readTemplate(bytes), P(1)).templateValue).toBe("Sales & returns & <more>");
  });

  it("reads an inline-string heading, entities decoded and spaces kept", async () => {
    const bytes = await patched({
      [SHEET]: (xml) => xml.replace(/<c r="J5" s="(\d+)" t="s"><v>\d+<\/v><\/c>/, '<c r="J5" s="$1" t="inlineStr"><is><t xml:space="preserve">Stock &amp; parts </t></is></c>'),
    });
    expect(heading(await readTemplate(bytes), P(3))).toMatchObject({ templateValue: "Stock & parts ", valueType: "text", group: "cost_of_sales" });
  });

  it("joins the runs of rich text and leaves out phonetic runs", async () => {
    const bytes = await patched({
      [STRINGS]: (xml) => xml.replace("<si><t>Phone</t></si>", '<si><r><t>Ph</t></r><r><rPr><b/></rPr><t xml:space="preserve">one &amp; fax</t></r><rPh sb="0" eb="2"><t>ふぉん</t></rPh></si>'),
      [SHEET]: (xml) => xml.replace(/<c r="I5" s="(\d+)" t="s"><v>\d+<\/v><\/c>/, '<c r="I5" s="$1" t="inlineStr"><is><r><t>Sundry</t></r><r><t xml:space="preserve"> income</t></r></is></c>'),
    });
    const profile = await readTemplate(bytes);
    expect(heading(profile, P(10)).templateValue).toBe("Phone & fax");
    expect(heading(profile, P(2)).templateValue).toBe("Sundry income");
  });
});

describe("readTemplate refuses XML it cannot read plainly", () => {
  it("refuses CDATA", async () => {
    await refused(await patched({ [SHEET]: (xml) => xml.replace(/(<c r="J5" s="\d+" t="s"><v>)(\d+)(<\/v>)/, "$1<![CDATA[$2]]>$3") }), "NOT_A_WORKBOOK");
  });

  it("refuses a tag it cannot parse", async () => {
    await refused(await patched({ [SHEET]: (xml) => xml.replace(/<c r="J5" s="(\d+)"/, "<c r=J5 s=\"$1\"") }), "NOT_A_WORKBOOK");
  });

  it("refuses a mismatched end tag", async () => {
    await refused(await patched({ [SHEET]: (xml) => xml.replace(/(<c r="J5" s="\d+" t="s"><v>\d+)<\/v>/, "$1</f>") }), "NOT_A_WORKBOOK");
  });

  it("refuses a stray ampersand or an unknown entity in text", async () => {
    await refused(await patched({ [STRINGS]: (xml) => xml.replace("<si><t>Sales</t></si>", "<si><t>Sales & returns</t></si>") }), "NOT_A_WORKBOOK");
    await refused(await patched({ [STRINGS]: (xml) => xml.replace("<si><t>Sales</t></si>", "<si><t>Sales &nbsp;</t></si>") }), "NOT_A_WORKBOOK");
  });

  it("refuses rows out of order and a cell outside its row", async () => {
    const swapRows = (xml: string) => xml.replace(/(<row r="5"[^>]*>.*?<\/row>)(<row r="6"[^>]*>.*?<\/row>)/, "$2$1");
    await refused(await patched({ [SHEET]: swapRows }), "NOT_A_WORKBOOK");
    await refused(await patched({ [SHEET]: (xml) => xml.replace('<c r="J5"', '<c r="J6"') }), "NOT_A_WORKBOOK");
  });

  it("refuses overlapping merged ranges", async () => {
    await refused(await patched({ [SHEET]: (xml) => xml.replace('<mergeCell ref="H3:I3"/>', '<mergeCell ref="H3:I3"/><mergeCell ref="I3:J3"/>') }), "NOT_A_WORKBOOK");
  });
});

describe("readTemplate limits on time and memory", () => {
  it("refuses a reading that passes its deadline as too large", async () => {
    await expect(readTemplateWithin(await buildSyntheticTemplate(), 0)).rejects.toMatchObject({ name: "TemplateReadError", code: "TOO_LARGE" });
  });

  // Excel's own limit on a formula's length is 8,192 characters.
  const formulaOf = (length: number) => `${"A1+".repeat((length - 2) / 3)}A1`;
  const analysisMaster = /(<f t="shared" ref="H7:[A-Z]+\d+" si="\d+">)IF\(H\$5=\$E7,\$G7,0\)(<\/f>)/;

  it("refuses a shared master or a plain formula longer than Excel allows, quickly", async () => {
    const start = performance.now();
    await refused(await patched({ [SHEET]: (xml) => xml.replace(analysisMaster, `$1${formulaOf(8_195)}$2`) }), "TOO_LARGE");
    await refused(await patched({ [SHEET]: (xml) => xml.replace("<f>SUM(H7:W7)-G7</f>", `<f>${formulaOf(8_195)}</f>`) }), "TOO_LARGE");
    // Generous for a loaded machine; the regression rebuilds megabytes of text per clone.
    expect(performance.now() - start).toBeLessThan(10_000);
  });

  it("bounds the work on a master at the limit with thousands of clones", async () => {
    // 16 analysis columns × 300 rows: about 4,800 clones of an 8,192-character master.
    const bytes = await patched({ [SHEET]: (xml) => xml.replace(analysisMaster, `$1${formulaOf(8_192)}$2`) }, { dataRows: 300 });
    const start = performance.now();
    const error = await readTemplate(bytes).catch((e: unknown) => e);
    // Thousands of references per clone exceed the reference budget: refused, well inside the deadline.
    expect(error).toMatchObject({ name: "TemplateReadError", code: "TOO_LARGE" });
    expect(performance.now() - start).toBeLessThan(15_000);
  }, 30_000);

  it("reads a large template within a small heap", async () => {
    // 5 account sheets of 2,000 rows, read in a process whose heap is capped at 96 MB; the
    // reader needs under 40 MB for it. A regression looks like the reader building the whole
    // workbook in memory, as the previous exceljs-based reader did: it needed more than
    // 128 MB of heap for this file and runs out of heap here.
    const bytes = await buildSyntheticTemplate({ dataRows: 2_000, extraAccountSheets: 2 });
    const dir = mkdtempSync(join(tmpdir(), "template-heap-"));
    try {
      const file = join(dir, "large.xlsx");
      writeFileSync(file, bytes);
      const child = spawnSync(
        process.execPath,
        ["--max-old-space-size=96", "--import", "tsx", fileURLToPath(new URL("../../fixtures/workbook/read-template-child.ts", import.meta.url)), file],
        { cwd: process.cwd(), encoding: "utf8", timeout: 60_000 },
      );
      expect(child.status, child.stderr).toBe(0);
      expect(JSON.parse(child.stdout)).toEqual({ sheets: 5, headings: 16 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
