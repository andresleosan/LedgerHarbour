export interface PrivateFileInput {
  objectKey: string;
  data: Uint8Array;
}

export interface StoredObject {
  objectKey: string;
  sizeBytes: number;
}

export interface StorageAdapter {
  put(input: PrivateFileInput): Promise<StoredObject>;
  get(objectKey: string): Promise<ReadableStream<Uint8Array>>;
  delete?(objectKey: string): Promise<void>;
}
