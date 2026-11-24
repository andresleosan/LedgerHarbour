import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { command: string; args: string[] }[] = [];
let readings: Record<string, string> = {};
let failEnlarging = false;

vi.mock("node:child_process", () => ({
  execFile: (
    command: string,
    args: string[],
    options: { cwd: string },
    callback: (error: Error | null, result: { stdout: string }) => void,
  ) => {
    calls.push({ command, args });
    const enlarging = command === "convert" && args.includes("2240x2240<");
    if (enlarging && failEnlarging) return callback(new Error("convert failed"), { stdout: "" });
    if (command === "convert") writeFileSync(join(options.cwd, enlarging ? "large-00.pgm" : "page-00.pgm"), "");
    if (command === "pdfinfo") return callback(null, { stdout: "Pages: 1\n" });
    if (command === "pdftoppm") writeFileSync(join(options.cwd, "page-1.pgm"), "");
    const page = command === "tesseract" ? args[0].split("/").at(-1)! : "";
    callback(null, { stdout: readings[page] ?? "" });
  },
}));

const { LocalOcrProvider } = await import("../../../src/modules/invoices/local-ocr-provider");

const extract = (mimeType = "image/jpeg") =>
  new LocalOcrProvider().extract({ documentId: "document-1", fileName: "receipt", mimeType, data: new Uint8Array([1]) });

describe("local OCR provider", () => {
  beforeEach(() => {
    calls.length = 0;
    failEnlarging = false;
    readings = {
      "page-00.pgm": "Total £120.60\n16/08/2026 10:14",
      "large-00.pgm": "Total £999.99\n17/08/2026 10:14",
      "page-1.pgm": "Total £120.60\n16/08/2026 10:14",
    };
  });

  it("stretches the contrast of a grey photo before Tesseract reads it", async () => {
    await extract();

    const convert = calls.find((call) => call.command === "convert")!.args;
    const gray = convert.indexOf("gray");
    expect(convert.slice(gray + 1, gray + 2)).toEqual(["-normalize"]);
  });

  it("reads an enlarged copy of a small photo for the date only when no labelled date was found", async () => {
    const result = await extract();

    expect(calls.map((call) => call.command)).toEqual(["convert", "tesseract", "convert", "tesseract"]);
    expect(result.fields).toMatchObject({ invoiceDate: "17/08/2026", total: "£120.60" });

    calls.length = 0;
    readings["page-00.pgm"] = "Invoice date: 16/08/2026\nTotal £120.60";
    expect((await extract()).fields.invoiceDate).toBe("16/08/2026");
    expect(calls.map((call) => call.command)).toEqual(["convert", "tesseract"]);
  });

  it("keeps the first reading when the enlarged one fails, and never enlarges a PDF", async () => {
    failEnlarging = true;
    expect((await extract()).fields).toMatchObject({ invoiceDate: null, total: "£120.60" });

    calls.length = 0;
    expect((await extract("application/pdf")).fields.invoiceDate).toBeNull();
    expect(calls.map((call) => call.command)).toEqual(["pdfinfo", "pdftoppm", "tesseract"]);
  });
});
