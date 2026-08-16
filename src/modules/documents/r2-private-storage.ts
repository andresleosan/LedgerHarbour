import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import type { PrivateFileInput, StorageAdapter, StoredObject } from "./storage-adapter";

export interface R2StorageClient {
  send(command: PutObjectCommand | GetObjectCommand | DeleteObjectCommand): Promise<unknown>;
}

export interface R2PrivateStorageOptions {
  client: R2StorageClient;
  bucket: string;
}

interface R2ObjectBody {
  transformToWebStream?: () => ReadableStream<Uint8Array>;
  transformToByteArray?: () => Promise<Uint8Array>;
}

function safeObjectKey(objectKey: string): boolean {
  return typeof objectKey === "string" && objectKey.length > 0 && !objectKey.includes("\\") &&
    !objectKey.startsWith("/") && !/^[A-Za-z]:/.test(objectKey) &&
    !objectKey.split("/").some((part) => part === ".." || part === ".");
}

function keyFor(objectKey: string): string {
  if (!safeObjectKey(objectKey)) throw new Error("Invalid private object key");
  return objectKey;
}

export class R2PrivateStorage implements StorageAdapter {
  private readonly client: R2StorageClient;
  private readonly bucket: string;

  constructor(options: R2PrivateStorageOptions) {
    if (!options.bucket.trim()) throw new Error("R2 bucket is required");
    this.client = options.client;
    this.bucket = options.bucket;
  }

  async put(input: PrivateFileInput): Promise<StoredObject> {
    const objectKey = keyFor(input.objectKey);
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      Body: input.data,
      ContentLength: input.data.byteLength,
    }));
    return { objectKey, sizeBytes: input.data.byteLength };
  }

  async get(objectKey: string): Promise<ReadableStream<Uint8Array>> {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: keyFor(objectKey) })) as { Body?: R2ObjectBody };
    if (!response.Body) throw new Error("R2 object response has no body");
    if (response.Body.transformToWebStream) return response.Body.transformToWebStream();
    if (response.Body.transformToByteArray) {
      const data = await response.Body.transformToByteArray();
      return new ReadableStream({
        start(controller) {
          controller.enqueue(data);
          controller.close();
        },
      });
    }
    throw new Error("R2 object response body is not readable");
  }

  async delete(objectKey: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: keyFor(objectKey) }));
  }
}

export function createR2PrivateStorage(): R2PrivateStorage {
  const endpoint = process.env.R2_ENDPOINT?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME?.trim();
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error("R2 storage requires R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME");
  }
  if (new URL(endpoint).protocol !== "https:") throw new Error("R2 endpoint must use HTTPS");
  return new R2PrivateStorage({
    bucket,
    client: new S3Client({ endpoint, region: "auto", maxAttempts: 1, credentials: { accessKeyId, secretAccessKey } }),
  });
}
