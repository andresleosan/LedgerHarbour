import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildSyntheticTemplate } from "../../fixtures/workbook/synthetic-template";

describe("fillWorkbook on a large template", () => {
  it("exports and reads back hundreds of rows within a small heap and a generous time", async () => {
    // 5 account sheets of 2,000 rows with sample rows to clear, 120 rows written on each,
    // the template read, written, read back and read again, in a process whose heap is
    // capped at 96 MB.
    const bytes = await buildSyntheticTemplate({ dataRows: 2_000, extraAccountSheets: 2, sampleRows: 50 });
    const dir = mkdtempSync(join(tmpdir(), "workbook-fill-"));
    try {
      const file = join(dir, "large.xlsx");
      writeFileSync(file, bytes);
      const child = spawnSync(
        process.execPath,
        ["--max-old-space-size=96", "--import", "tsx", fileURLToPath(new URL("../../fixtures/workbook/fill-workbook-child.ts", import.meta.url)), file, "120"],
        { cwd: process.cwd(), encoding: "utf8", timeout: 90_000 },
      );
      expect(child.status, child.stderr).toBe(0);
      const result = JSON.parse(child.stdout);
      expect(result).toMatchObject({ sheets: 5, rows: 600, same: true });
      expect(result.ms).toBeLessThan(60_000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
