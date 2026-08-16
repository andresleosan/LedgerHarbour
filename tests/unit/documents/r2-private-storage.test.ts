import { describe, expect, it, vi } from "vitest";

import { createR2PrivateStorage, R2PrivateStorage, type R2StorageClient } from "../../../src/modules/documents/r2-private-storage";

function streamFrom(data: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
}

describe("R2PrivateStorage", () => {
  it("writes and reads private objects through the S3-compatible client", async () => {
    const client: R2StorageClient = {
      send: vi.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ Body: { transformToWebStream: () => streamFrom(new Uint8Array([1, 2, 3])) } }),
    };
    const storage = new R2PrivateStorage({ client, bucket: "ledgerharbour" });

    await expect(storage.put({ objectKey: "business-1/document-1.pdf", data: new Uint8Array([1, 2, 3]) }))
      .resolves.toEqual({ objectKey: "business-1/document-1.pdf", sizeBytes: 3 });
    const body = await storage.get("business-1/document-1.pdf");

    expect(Array.from(await new Response(body).bytes())).toEqual([1, 2, 3]);
    expect(client.send).toHaveBeenCalledTimes(2);
    expect((client.send as ReturnType<typeof vi.fn>).mock.calls[0][0].input).toMatchObject({
      Bucket: "ledgerharbour",
      Key: "business-1/document-1.pdf",
    });
  });

  it("deletes an object and rejects traversal keys", async () => {
    const client: R2StorageClient = { send: vi.fn().mockResolvedValue({}) };
    const storage = new R2PrivateStorage({ client, bucket: "ledgerharbour" });

    await storage.delete("business-1/document-1.pdf");

    await expect(storage.get("../secrets.txt")).rejects.toThrow("Invalid private object key");
    expect(client.send).toHaveBeenCalledTimes(1);
  });

  it("fails closed when R2 credentials are incomplete", () => {
    vi.stubEnv("R2_ENDPOINT", "");
    vi.stubEnv("R2_ACCESS_KEY_ID", "");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "");
    vi.stubEnv("R2_BUCKET_NAME", "");

    expect(() => createR2PrivateStorage()).toThrow("R2 storage requires");
    vi.unstubAllEnvs();
  });

  it("rejects non-HTTPS R2 endpoints", () => {
    vi.stubEnv("R2_ENDPOINT", "http://account-id.r2.cloudflarestorage.com");
    vi.stubEnv("R2_ACCESS_KEY_ID", "access-key");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "secret-key");
    vi.stubEnv("R2_BUCKET_NAME", "ledgerharbour");

    expect(() => createR2PrivateStorage()).toThrow("R2 endpoint must use HTTPS");
    vi.unstubAllEnvs();
  });
});
