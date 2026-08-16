import { describe, expect, it } from "vitest";

import {
  MAX_UPLOAD_SIZE_BYTES,
  UPLOAD_ERROR_CODES,
  validateUpload,
  type UploadMetadata,
} from "../../../src/modules/documents/file-validation";

const bytes = (...values: number[]) => new Uint8Array(values);
const repeated = (length: number, value = 0) => {
  const data = new Uint8Array(length);
  data.fill(value);
  return data;
};

const upload = (name: string, mimeType: string, data: Uint8Array): UploadMetadata => ({
  name,
  mimeType,
  sizeBytes: data.byteLength,
  data,
});

const pdfBytes = new Uint8Array(Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\nstartxref\n0\n%%EOF\n"));
const jpegBytes = bytes(
  0xff, 0xd8,
  0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
  0xff, 0xda, 0x00, 0x02,
  0x11, 0xff, 0x00, 0x22, 0xff, 0xd0, 0x33,
  0xff, 0xd9,
);
const realBaselineJpegBytes = new Uint8Array(Buffer.from(
  "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABv/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKgASfv/2Q==",
  "base64",
));
const realProgressiveJpegBytes = new Uint8Array(Buffer.from(
  "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wgARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAT/xAAVAQEBAAAAAAAAAAAAAAAAAAAFBv/aAAwDAQACEAMQAAABlFET/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAP/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=",
  "base64",
));
const pngBytes = new Uint8Array(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
));
const tiffBytes = bytes(
  0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
  0x02, 0x00,
  0x00, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
);
const box = (...values: number[]) => bytes(...values);
const heicBytes = new Uint8Array([
  ...box(0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0x00, 0x00, 0x00, 0x00, 0x68, 0x65, 0x69, 0x63, 0x6d, 0x69, 0x66, 0x31),
  ...box(0x00, 0x00, 0x00, 0x08, 0x6d, 0x65, 0x74, 0x61),
  ...box(0x00, 0x00, 0x00, 0x09, 0x6d, 0x64, 0x61, 0x74, 0x00),
]);

const validFiles = [
  ["invoice.pdf", "application/pdf", pdfBytes],
  ["invoice.jpg", "image/jpeg", realBaselineJpegBytes],
  ["invoice.jpeg", "image/jpeg", realProgressiveJpegBytes],
  ["invoice.png", "image/png", pngBytes],
  ["invoice.heic", "image/heic", heicBytes],
  ["invoice.tiff", "image/tiff", tiffBytes],
] as const;

describe("document upload validation", () => {
  it.each(validFiles)("accepts a valid %s signature", (name, mimeType, data) => {
    expect(validateUpload(upload(name, mimeType, data))).toMatchObject({
      originalFileName: name,
      originalMimeType: mimeType,
      originalSizeBytes: data.byteLength,
      data,
      checksum: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it("accepts entropy-coded JPEG scan data with stuffed bytes, restart markers, and EOI", () => {
    expect(validateUpload(upload("realistic.jpg", "image/jpeg", jpegBytes)).format).toBe("jpeg");
  });

  it("rejects a JPEG truncated inside entropy-coded scan data", () => {
    expect(() => validateUpload(upload("truncated.jpg", "image/jpeg", jpegBytes.slice(0, -1)))).toThrowError(
      expect.objectContaining({ code: UPLOAD_ERROR_CODES.SIGNATURE_MISMATCH }),
    );
  });

  it("accepts real baseline and progressive JPEG fixtures", () => {
    expect(validateUpload(upload("baseline.jpg", "image/jpeg", realBaselineJpegBytes)).format).toBe("jpeg");
    expect(validateUpload(upload("progressive.jpeg", "image/jpeg", realProgressiveJpegBytes)).format).toBe("jpeg");
  });

  it("rejects a real progressive JPEG truncated before EOI", () => {
    expect(() => validateUpload(upload("progressive-truncated.jpeg", "image/jpeg", realProgressiveJpegBytes.slice(0, -2)))).toThrowError(
      expect.objectContaining({ code: UPLOAD_ERROR_CODES.SIGNATURE_MISMATCH }),
    );
  });

  it.each([
    ["invoice.pdf", "application/pdf", new Uint8Array(Buffer.from("%PDF-1.7\ncorrupt body"))],
    ["invoice.jpg", "image/jpeg", bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xd9)],
    ["invoice.png", "image/png", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00)],
    ["invoice.tiff", "image/tiff", bytes(0x49, 0x49, 0x2a, 0x00, 0x08)],
    ["invoice.heic", "image/heic", bytes(0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0x00, 0x00, 0x00, 0x00, 0x68, 0x65, 0x69, 0x63, 0x6d, 0x69, 0x66, 0x31)],
  ])("rejects a signed prefix with corrupt %s body", (name, mimeType, data) => {
    expect(() => validateUpload(upload(name, mimeType, data))).toThrowError(
      expect.objectContaining({ code: UPLOAD_ERROR_CODES.SIGNATURE_MISMATCH }),
    );
  });

  it.each([
    ["invoice.pdf", "image/png", bytes(0x25, 0x50, 0x44, 0x46, 0x2d)],
    ["invoice.png", "application/pdf", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)],
    ["invoice.jpg", "image/png", bytes(0xff, 0xd8, 0xff, 0xe0)],
  ])("rejects extension and MIME mismatch for %s", (name, mimeType, data) => {
    expect(() => validateUpload(upload(name, mimeType, data))).toThrowError(
      expect.objectContaining({ code: UPLOAD_ERROR_CODES.MIME_EXTENSION_MISMATCH }),
    );
  });

  it.each([
    ["invoice.pdf", "application/pdf", new Uint8Array()],
    ["invoice.pdf", "application/pdf", bytes(0x00, 0x01, 0x02, 0x03)],
    ["invoice.exe", "application/octet-stream", bytes(0x4d, 0x5a)],
  ])("rejects empty, corrupt, and unsupported content", (name, mimeType, data) => {
    expect(() => validateUpload(upload(name, mimeType, data))).toThrow();
  });

  it("accepts exactly 10 MiB when its signature is valid", () => {
    const data = repeated(MAX_UPLOAD_SIZE_BYTES, 0x20);
    data.set(pdfBytes, 0);
    data.set(bytes(0x25, 0x25, 0x45, 0x4f, 0x46, 0x0a), MAX_UPLOAD_SIZE_BYTES - 6);

    expect(validateUpload(upload("large.pdf", "application/pdf", data)).originalSizeBytes).toBe(
      MAX_UPLOAD_SIZE_BYTES,
    );
  });

  it("rejects content larger than 10 MiB with a stable size code", () => {
    const data = repeated(MAX_UPLOAD_SIZE_BYTES + 1, 0x20);
    data.set(pdfBytes, 0);

    expect(() => validateUpload(upload("large.pdf", "application/pdf", data))).toThrowError(
      expect.objectContaining({ code: UPLOAD_ERROR_CODES.FILE_TOO_LARGE }),
    );
  });

  it("does not use a traversal filename in validated metadata or checksum", () => {
    const data = pdfBytes;

    expect(validateUpload(upload("../../private/../../invoice.pdf", "application/pdf", data))).toMatchObject({
      originalFileName: "../../private/../../invoice.pdf",
      checksum: expect.any(String),
    });
  });

  it("returns a deterministic SHA-256 checksum for the content", () => {
    const data = pdfBytes;

    expect(validateUpload(upload("one.pdf", "application/pdf", data)).checksum).toBe(
      validateUpload(upload("renamed.pdf", "application/pdf", data)).checksum,
    );
  });

  it("rejects declared size that differs from the byte boundary", () => {
    expect(() => validateUpload({
      ...upload("invoice.pdf", "application/pdf", pdfBytes),
      sizeBytes: 99,
    })).toThrowError(expect.objectContaining({ code: UPLOAD_ERROR_CODES.SIZE_MISMATCH }));
  });

  it("rejects filenames longer than 255 characters before content validation", () => {
    expect(() => validateUpload(upload(`${"a".repeat(256)}.pdf`, "application/pdf", pdfBytes))).toThrowError(
      expect.objectContaining({ code: UPLOAD_ERROR_CODES.INVALID_METADATA }),
    );
  });
});
