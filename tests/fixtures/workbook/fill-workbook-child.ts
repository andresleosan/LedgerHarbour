import { readFileSync } from "node:fs";

import { readTemplate } from "../../../src/modules/workbook/read-template";
import { fillWorkbook, readWrittenRows, usableHeadings } from "../../../src/modules/workbook/write-workbook";

// Exports argv[3] invented rows per account sheet into the template at argv[2], reads the
// result back, in a process of its own so a test can cap the heap.
const template = readFileSync(process.argv[2]);
const perSheet = Number(process.argv[3]);
const started = performance.now();
const profile = await readTemplate(template);
const codes = usableHeadings(profile);
const sheets = profile.sheets.map((sheet) => ({
  sheetName: sheet.name,
  openingBalance: "100.00",
  rows: Array.from({ length: perSheet }, (_, i) => ({
    date: `2026-${String(4 + (i % 9)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`,
    narrative: `Invented line ${i} & co`,
    code: { value: codes[i % codes.length].templateValue, type: codes[i % codes.length].valueType },
    amount: `${i % 2 ? "-" : ""}${i + 1}.${String(i % 100).padStart(2, "0")}`,
  })),
}));
const { bytes } = fillWorkbook(template, profile, sheets);
const rows = readWrittenRows(bytes, profile).reduce((n, sheet) => n + sheet.rows.length, 0);
const same = JSON.stringify(await readTemplate(bytes)) === JSON.stringify(profile);
process.stdout.write(JSON.stringify({ sheets: profile.sheets.length, rows, same, ms: Math.round(performance.now() - started), maxRssMb: Math.round(process.resourceUsage().maxRSS / 1024) }));
