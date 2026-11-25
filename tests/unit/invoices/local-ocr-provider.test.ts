import { writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { command: string; args: string[] }[] = [];
let readings: Record<string, string> = {};
let failEnlarging = false;
let pageHeader = "";
let pdfText: string | Error = "";

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
    if (command === "convert") writeFileSync(join(options.cwd, enlarging ? "large-00.pgm" : "page-00.pgm"), enlarging ? "" : pageHeader);
    if (command === "pdfinfo") return callback(null, { stdout: "Pages: 1\n" });
    if (command === "pdftotext") {
      return pdfText instanceof Error ? callback(pdfText, { stdout: "" }) : callback(null, { stdout: pdfText });
    }
    if (command === "pdftoppm") writeFileSync(join(options.cwd, "page-1.pgm"), "");
    const page = command === "tesseract" ? basename(args[0]) : "";
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
    pageHeader = "";
    pdfText = "";
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

  it("does not read again a photo that is already 2240 px or more on its longest edge", async () => {
    pageHeader = "P5\n1600 2240\n255\n";
    expect((await extract()).fields.invoiceDate).toBeNull();
    expect(calls.map((call) => call.command)).toEqual(["convert", "tesseract"]);

    calls.length = 0;
    pageHeader = "P5\n1260 2239\n255\n";
    expect((await extract()).fields.invoiceDate).toBe("17/08/2026");
  });

  it("keeps the first photo reading when enlargement fails", async () => {
    failEnlarging = true;
    expect((await extract()).fields).toMatchObject({ invoiceDate: null, total: "£120.60" });
  });

  it("recovers only a missing PDF invoice number from its text layer", async () => {
    readings["page-1.pgm"] = "Supplier: Harbour Test Supplies Ltd\nInvoice Date: 2026-11-24\nTotal: GBP 120.00";
    pdfText = "Invoice Number: QA-PDF-001\nInvoice Date: 2026-11-25\nSubtotal: GBP 999.00\nTotal GBP 999.00";

    const result = await extract("application/pdf");

    expect(result.fields).toMatchObject({
      invoiceNumber: "QA-PDF-001",
      supplier: "Harbour Test Supplies Ltd",
      invoiceDate: "2026-11-24",
      subtotal: null,
      total: "GBP 120.00",
      currencyReference: "GBP",
    });
    expect(result.confidence).toMatchObject({ invoiceNumber: 0.79, invoiceDate: 0.79, subtotal: 0, total: 0.79 });
    expect(calls.map((call) => call.command)).toEqual(["pdfinfo", "pdftoppm", "tesseract", "pdftotext"]);
    expect(calls.at(-1)?.args).toEqual(["-enc", "UTF-8", "-layout", expect.any(String), "-"]);
  });

  it("skips the text layer when Tesseract already found a PDF invoice number", async () => {
    readings["page-1.pgm"] = "Invoice Number: OCR-123\nTotal £120.60";
    pdfText = "Invoice Number: TEXT-456";

    expect((await extract("application/pdf")).fields.invoiceNumber).toBe("OCR-123");
    expect(calls.map((call) => call.command)).toEqual(["pdfinfo", "pdftoppm", "tesseract"]);
  });

  it("does not pick an invoice number from conflicting PDF text-layer labels", async () => {
    pdfText = "Invoice Number: QA-PDF-001\nInvoice Number: QA-PDF-002";

    const result = await extract("application/pdf");

    expect(result.fields).toMatchObject({ invoiceNumber: null, total: "£120.60" });
    expect(result.confidence.invoiceNumber).toBe(0);
    expect(calls.map((call) => call.command)).toEqual(["pdfinfo", "pdftoppm", "tesseract", "pdftotext"]);
  });

  it("keeps the rasterized PDF reading if extracting the text layer fails", async () => {
    pdfText = new Error("pdftotext failed");

    expect((await extract("application/pdf")).fields).toMatchObject({ invoiceNumber: null, invoiceDate: null, total: "£120.60" });
    expect(calls.map((call) => call.command)).toEqual(["pdfinfo", "pdftoppm", "tesseract", "pdftotext"]);
  });
});
