import { describe, expect, it } from "vitest";

import { readTemplate } from "../../../src/modules/workbook/read-template";
import { inspectWorkbookZip } from "../../../src/modules/workbook/zip-gate";
import { buildSyntheticTemplate } from "../../fixtures/workbook/synthetic-template";
import { unzip, zip, type ZipEntry } from "../../fixtures/workbook/zip";

// The gate must see every range exceljs's XML parser would see. These cases are
// written the way an XML parser accepts them but a naive scan would miss, and the
// gate (not exceljs) must refuse them: the "gate" assertions call it directly.

const SHEET = "xl/worksheets/sheet1.xml";
const WHOLE = "A1:XFD1048576";

async function entries(): Promise<ZipEntry[]> {
  return unzip(await buildSyntheticTemplate());
}

async function patchedEntries(name: string, edit: (xml: string) => string): Promise<ZipEntry[]> {
  const all = await entries();
  const entry = all.find((e) => e.name === name)!;
  const before = entry.data.toString("utf8");
  const after = edit(before);
  expect(after).not.toBe(before);
  entry.data = Buffer.from(after, "utf8");
  return all;
}

const sheetPatch = async (edit: (xml: string) => string) => zip(await patchedEntries(SHEET, edit));
const replaceMerge = (merge: string) => (xml: string) => xml.replace('<mergeCell ref="H3:I3"/>', merge);

function gateRefuses(bytes: Buffer, code: string) {
  const start = performance.now();
  let error: unknown;
  try {
    inspectWorkbookZip(bytes);
  } catch (e) {
    error = e;
  }
  expect(error).toMatchObject({ name: "TemplateReadError", code });
  // Generous for a loaded machine; a regression is exceljs expanding the range (minutes).
  expect(performance.now() - start).toBeLessThan(10_000);
}

describe("zip gate: attributes are parsed like an XML parser would", () => {
  it("measures a single-quoted ref", async () => {
    gateRefuses(await sheetPatch(replaceMerge(`<mergeCell ref='${WHOLE}'/>`)), "TOO_LARGE");
  });

  it("measures a ref with whitespace around the equals sign", async () => {
    gateRefuses(await sheetPatch(replaceMerge(`<mergeCell ref \n= "${WHOLE}"/>`)), "TOO_LARGE");
  });

  it("measures a ref that follows an attribute whose value holds '>'", async () => {
    gateRefuses(await sheetPatch(replaceMerge(`<mergeCell x="a>b" ref="${WHOLE}"/>`)), "TOO_LARGE");
  });

  it("measures a data validation sqref written with single quotes", async () => {
    gateRefuses(await sheetPatch((xml) => xml.replace('sqref="E7:E36"', `sqref='E7 ${WHOLE}'`)), "TOO_LARGE");
  });

  it("refuses a character reference in a ref", async () => {
    gateRefuses(await sheetPatch(replaceMerge('<mergeCell ref="A1:&#88;FD1048576"/>')), "NOT_A_WORKBOOK");
  });

  it("refuses a tag it cannot parse", async () => {
    gateRefuses(await sheetPatch(replaceMerge(`<mergeCell ref="${WHOLE}/>`)), "NOT_A_WORKBOOK");
  });

  it("refuses a duplicated range attribute", async () => {
    gateRefuses(await sheetPatch(replaceMerge(`<mergeCell ref="H3:I3" ref="${WHOLE}"/>`)), "NOT_A_WORKBOOK");
  });

  it("refuses a defined name whose text is split by a comment", async () => {
    const definedName = `<definedNames><definedName name="Split">'Current Account'!$A$1<!-- -->:$XFD$1048576</definedName></definedNames>`;
    gateRefuses(zip(await patchedEntries("xl/workbook.xml", (xml) => xml.replace("<calcPr", `${definedName}<calcPr`))), "NOT_A_WORKBOOK");
  });
});

describe("zip gate: encoding, entities and parts", () => {
  it("refuses a UTF-16 sheet entry", async () => {
    const all = await entries();
    const sheet = all.find((e) => e.name === SHEET)!;
    sheet.data = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(sheet.data.toString("utf8").replace('encoding="UTF-8"', 'encoding="UTF-16"'), "utf16le")]);
    gateRefuses(zip(all), "NOT_A_WORKBOOK");
  });

  it("refuses an encoding declaration other than UTF-8", async () => {
    gateRefuses(await sheetPatch((xml) => xml.replace('encoding="UTF-8"', 'encoding="ISO-8859-1"')), "NOT_A_WORKBOOK");
  });

  it("refuses a sheet that is not valid UTF-8", async () => {
    const all = await entries();
    const sheet = all.find((e) => e.name === SHEET)!;
    sheet.data = Buffer.concat([sheet.data, Buffer.from([0xc3, 0x28])]);
    gateRefuses(zip(all), "NOT_A_WORKBOOK");
  });

  it("refuses a DOCTYPE with an entity", async () => {
    gateRefuses(
      await sheetPatch((xml) => xml.replace("?>", `?><!DOCTYPE worksheet [<!ENTITY big "${WHOLE}">]>`).replace('<mergeCell ref="H3:I3"/>', '<mergeCell ref="&big;"/>')),
      "NOT_A_WORKBOOK",
    );
  });

  it("refuses duplicate entry names, also after removing a leading slash", async () => {
    const all = await entries();
    const sheet = all.find((e) => e.name === SHEET)!;
    gateRefuses(zip([...all, { name: SHEET, data: sheet.data }]), "NOT_A_WORKBOOK");
    gateRefuses(zip([...all, { name: `/${SHEET}`, data: sheet.data }]), "NOT_A_WORKBOOK");
  });

  it("refuses a local header name that differs from the central directory", async () => {
    const all = await entries();
    all.find((e) => e.name === SHEET)!.localName = "xl/worksheets/sheet9.xml";
    gateRefuses(zip(all), "NOT_A_WORKBOOK");
  });

  it("refuses a Unicode path extra field, which would rename the entry", async () => {
    const all = await entries();
    const extra = Buffer.alloc(4 + 5);
    extra.writeUInt16LE(0x7075, 0);
    extra.writeUInt16LE(5, 2);
    all.find((e) => e.name === "docProps/app.xml")!.centralExtra = extra;
    gateRefuses(zip(all), "NOT_A_WORKBOOK");
  });

  it("refuses bytes after the end-of-central-directory record", async () => {
    gateRefuses(Buffer.concat([zip(await entries()), Buffer.from("trailing")]), "NOT_A_WORKBOOK");
  });
});

describe("zip gate: legitimate files", () => {
  it("passes the synthetic template, which still reads", async () => {
    const bytes = await buildSyntheticTemplate();
    expect(() => inspectWorkbookZip(bytes)).not.toThrow();
    expect((await readTemplate(bytes)).sheets).toHaveLength(3);
  });

  it("passes a small single-quoted range with spaces, which still reads", async () => {
    const bytes = await sheetPatch(replaceMerge("<mergeCell  ref = 'H3:I3' />"));
    expect(() => inspectWorkbookZip(bytes)).not.toThrow();
    expect((await readTemplate(bytes)).sheets).toHaveLength(3);
  });
});
