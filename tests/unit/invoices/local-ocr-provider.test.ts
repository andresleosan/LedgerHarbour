import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

const calls: { command: string; args: string[] }[] = [];

vi.mock("node:child_process", () => ({
  execFile: (
    command: string,
    args: string[],
    options: { cwd: string },
    callback: (error: Error | null, result: { stdout: string }) => void,
  ) => {
    calls.push({ command, args });
    if (command === "convert") writeFileSync(join(options.cwd, "page-00.pgm"), "");
    callback(null, { stdout: command === "tesseract" ? "Invoice date: 16/08/2026\nTotal £120.60" : "" });
  },
}));

const { LocalOcrProvider } = await import("../../../src/modules/invoices/local-ocr-provider");

describe("local OCR provider", () => {
  it("stretches the contrast of a grey photo before Tesseract reads it", async () => {
    const result = await new LocalOcrProvider().extract({
      documentId: "document-1",
      fileName: "receipt.jpg",
      mimeType: "image/jpeg",
      data: new Uint8Array([1]),
    });

    const convert = calls.find((call) => call.command === "convert")!.args;
    const gray = convert.indexOf("gray");
    expect(convert.slice(gray + 1, gray + 2)).toEqual(["-normalize"]);
    expect(result.fields).toMatchObject({ invoiceDate: "16/08/2026", total: "£120.60" });
  });
});
