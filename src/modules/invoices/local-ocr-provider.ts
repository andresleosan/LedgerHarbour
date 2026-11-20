import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { MAX_UPLOAD_SIZE_BYTES } from "../documents/file-validation";
import { extractLocalOcrFields } from "./local-ocr-fields";
import { OcrProviderError, type OcrInput, type OcrProvider, type OcrResult } from "./ocr-provider";

const runFile = promisify(execFile);
const MAX_PAGES = 15;
const MAX_EDGE = "2400";
const TIME_LIMIT_MS = 90_000;
const imageFormats = new Map([
  ["image/jpeg", "jpeg"],
  ["image/png", "png"],
  ["image/heic", "heic"],
  ["image/tiff", "tiff"],
]);

async function run(command: string, args: string[], directory: string, deadline: number): Promise<string> {
  const timeout = deadline - Date.now();
  if (timeout <= 0) throw new OcrProviderError(false);
  const { stdout } = await runFile(command, args, {
    cwd: directory,
    encoding: "utf8",
    timeout,
    killSignal: "SIGKILL",
    maxBuffer: 512 * 1024,
    env: {
      NODE_ENV: process.env.NODE_ENV,
      PATH: process.env.PATH,
      LANG: "C.UTF-8",
      OMP_THREAD_LIMIT: "1",
      MAGICK_THREAD_LIMIT: "1",
      MAGICK_TEMPORARY_PATH: directory,
    },
  });
  return stdout;
}

async function preparePages(inputFile: string, directory: string, mimeType: string, deadline: number): Promise<string[]> {
  if (mimeType === "application/pdf") {
    const info = await run("pdfinfo", [inputFile], directory, deadline);
    const pages = Number(/^Pages:\s+(\d+)$/m.exec(info)?.[1]);
    if (!Number.isInteger(pages) || pages < 1 || pages > MAX_PAGES) throw new OcrProviderError(false);
    await run("pdftoppm", ["-scale-to", MAX_EDGE, "-gray", inputFile, join(directory, "page")], directory, deadline);
  } else {
    const format = imageFormats.get(mimeType);
    if (!format) throw new OcrProviderError(false);
    const frame = format === "tiff" ? "" : "[0]";
    await run("convert", [
      "-limit", "thread", "1",
      "-limit", "width", "12000",
      "-limit", "height", "12000",
      "-limit", "memory", "128MiB",
      "-limit", "map", "256MiB",
      "-limit", "disk", "128MiB",
      "-limit", "list-length", String(MAX_PAGES + 1),
      `${format}:${inputFile}${frame}`,
      "-auto-orient", "-resize", `${MAX_EDGE}x${MAX_EDGE}>`,
      "-background", "white", "-alpha", "remove", "-colorspace", "gray", "-depth", "8",
      join(directory, "page-%02d.pgm"),
    ], directory, deadline);
  }
  const pages = (await readdir(directory)).filter((name) => /^page-\d+\.pgm$/.test(name)).sort();
  if (pages.length < 1 || pages.length > MAX_PAGES) throw new OcrProviderError(false);
  return pages;
}

export class LocalOcrProvider implements OcrProvider {
  async extract(input: OcrInput): Promise<OcrResult> {
    if (
      input.data.length < 1 || input.data.length > MAX_UPLOAD_SIZE_BYTES ||
      (input.mimeType !== "application/pdf" && !imageFormats.has(input.mimeType))
    ) throw new OcrProviderError(false);

    let directory: string | undefined;
    try {
      directory = await mkdtemp(join(tmpdir(), "ledgerharbour-ocr-"));
      const inputFile = join(directory, "input");
      const deadline = Date.now() + TIME_LIMIT_MS;
      await writeFile(inputFile, input.data, { mode: 0o600 });
      const pages = await preparePages(inputFile, directory, input.mimeType, deadline);
      const text: string[] = [];
      for (const page of pages) {
        text.push(await run("tesseract", [join(directory, page), "stdout", "-l", "eng", "--psm", "6"], directory, deadline));
      }
      return extractLocalOcrFields(text);
    } catch {
      // Tool output can contain document text or temporary paths.
      throw new OcrProviderError(false);
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
