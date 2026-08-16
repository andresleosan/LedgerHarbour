import { LocalPrivateStorage } from "./local-private-storage";
import { createR2PrivateStorage } from "./r2-private-storage";
import type { StorageAdapter } from "./storage-adapter";

export type StorageMode = "local" | "r2";

export function createStorageAdapter(mode: StorageMode = (process.env.STORAGE_MODE as StorageMode | undefined) ?? "local"): StorageAdapter {
  if (mode === "local") return new LocalPrivateStorage();
  if (mode === "r2") return createR2PrivateStorage();
  throw new Error(`Unsupported storage mode: ${mode}`);
}
