import { describe, expect, it } from "vitest";

import { LocalPrivateStorage } from "../../../src/modules/documents/local-private-storage";
import { createStorageAdapter } from "../../../src/modules/documents/storage-factory";

describe("createStorageAdapter", () => {
  it("uses local storage by default", () => {
    expect(createStorageAdapter("local")).toBeInstanceOf(LocalPrivateStorage);
  });

  it("rejects an unsupported storage mode", () => {
    expect(() => createStorageAdapter("s3" as never)).toThrow("Unsupported storage mode");
  });
});
