import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

import type { PrivateFileInput, StorageAdapter, StoredObject } from "./storage-adapter";

const PRIVATE_DIRECTORY = join("storage", ".private");

function safeObjectKey(objectKey: string): boolean {
  return typeof objectKey === "string" && objectKey.length > 0 && !objectKey.includes("\\") &&
    !objectKey.startsWith("/") && !/^[A-Za-z]:/.test(objectKey) &&
    !objectKey.split("/").some((part) => part === ".." || part === ".");
}

export class LocalPrivateStorage implements StorageAdapter {
  readonly baseDirectory: string;

  constructor(rootDirectory = process.cwd()) {
    this.baseDirectory = resolve(rootDirectory, PRIVATE_DIRECTORY);
  }

  private pathFor(objectKey: string): string {
    if (!safeObjectKey(objectKey)) throw new Error("Invalid private object key");
    const candidate = resolve(this.baseDirectory, objectKey);
    const prefix = `${this.baseDirectory}${sep}`;
    if (!candidate.startsWith(prefix)) throw new Error("Invalid private object key");
    return candidate;
  }

  async put(input: PrivateFileInput): Promise<StoredObject> {
    const path = this.pathFor(input.objectKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, input.data, { flag: "wx" });
    return { objectKey: input.objectKey, sizeBytes: input.data.byteLength };
  }

  async get(objectKey: string): Promise<ReadableStream<Uint8Array>> {
    const data = await readFile(this.pathFor(objectKey));
    return new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(data); controller.close(); } });
  }

  async delete(objectKey: string): Promise<void> {
    await rm(this.pathFor(objectKey), { force: true });
  }

  async listKeys(): Promise<string[]> {
    const walk = async (directory: string): Promise<string[]> => {
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch {
        return [];
      }
      const keys = await Promise.all(entries.map((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? walk(path) : [relative(this.baseDirectory, path).replaceAll("\\", "/")];
      }));
      return keys.flat();
    };
    return walk(this.baseDirectory);
  }

  async clearForTests(): Promise<void> {
    await rm(this.baseDirectory, { recursive: true, force: true });
  }
}
