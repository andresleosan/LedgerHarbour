import { readFileSync } from "node:fs";

import { readTemplate } from "../../../src/modules/workbook/read-template";

// Reads the template at argv[2] in a process of its own, so a test can cap the reader's heap.
const profile = await readTemplate(readFileSync(process.argv[2]));
process.stdout.write(JSON.stringify({ sheets: profile.sheets.length, headings: profile.headings.length }));
