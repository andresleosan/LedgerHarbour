import { createHash } from "node:crypto";

export const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
export const MAX_FILE_NAME_LENGTH = 255;

export const UPLOAD_ERROR_CODES = {
  INVALID_METADATA: "INVALID_UPLOAD_METADATA",
  EMPTY_FILE: "EMPTY_DOCUMENT",
  FILE_TOO_LARGE: "DOCUMENT_TOO_LARGE",
  SIZE_MISMATCH: "DOCUMENT_SIZE_MISMATCH",
  UNSUPPORTED_FORMAT: "UNSUPPORTED_DOCUMENT_FORMAT",
  MIME_EXTENSION_MISMATCH: "DOCUMENT_MIME_EXTENSION_MISMATCH",
  SIGNATURE_MISMATCH: "DOCUMENT_SIGNATURE_MISMATCH",
} as const;

export type UploadErrorCode = (typeof UPLOAD_ERROR_CODES)[keyof typeof UPLOAD_ERROR_CODES];

const publicMessages: Record<UploadErrorCode, string> = {
  INVALID_UPLOAD_METADATA: "The upload metadata is invalid.",
  EMPTY_DOCUMENT: "The document is empty.",
  DOCUMENT_TOO_LARGE: "The document exceeds the 10 MiB limit.",
  DOCUMENT_SIZE_MISMATCH: "The declared document size is invalid.",
  UNSUPPORTED_DOCUMENT_FORMAT: "The document format is not supported.",
  DOCUMENT_MIME_EXTENSION_MISMATCH: "The document metadata does not match its content.",
  DOCUMENT_SIGNATURE_MISMATCH: "The document content is corrupt or does not match its format.",
};

const formats = {
  ".pdf": { mimeType: "application/pdf", format: "pdf" },
  ".jpg": { mimeType: "image/jpeg", format: "jpeg" },
  ".jpeg": { mimeType: "image/jpeg", format: "jpeg" },
  ".png": { mimeType: "image/png", format: "png" },
  ".heic": { mimeType: "image/heic", format: "heic" },
  ".tif": { mimeType: "image/tiff", format: "tiff" },
  ".tiff": { mimeType: "image/tiff", format: "tiff" },
} as const;

type UploadFormat = (typeof formats)[keyof typeof formats]["format"];

export class UploadValidationError extends Error {
  readonly name = "UploadValidationError";

  constructor(readonly code: UploadErrorCode) {
    super(publicMessages[code]);
  }
}

export interface UploadMetadata {
  name: string;
  mimeType: string;
  sizeBytes: number;
  data: Uint8Array;
}

export interface ValidatedUpload {
  originalFileName: string;
  originalMimeType: string;
  originalSizeBytes: number;
  checksum: string;
  format: UploadFormat;
  data: Uint8Array;
}

function fail(code: UploadErrorCode): never {
  throw new UploadValidationError(code);
}

function matchesPrefix(data: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((value, index) => data[index] === value);
}

function asciiAt(data: Uint8Array, offset: number, value: string): boolean {
  return [...value].every((character, index) => data[offset + index] === character.charCodeAt(0));
}

function readU16(data: Uint8Array, offset: number, littleEndian: boolean): number {
  return littleEndian ? data[offset] | (data[offset + 1] << 8) : (data[offset] << 8) | data[offset + 1];
}

function readU32(data: Uint8Array, offset: number, littleEndian: boolean): number {
  if (littleEndian) return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
  return ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concatenate(left: Uint8Array, right: Uint8Array): Uint8Array {
  const result = new Uint8Array(left.length + right.length);
  result.set(left);
  result.set(right, left.length);
  return result;
}

function hasPdfStructure(data: Uint8Array): boolean {
  if (data.length < 12 || !asciiAt(data, 0, "%PDF-1.")) return false;
  let eof = -1;
  for (let offset = data.length - 5; offset >= 0; offset -= 1) {
    if (asciiAt(data, offset, "%%EOF")) { eof = offset; break; }
  }
  if (eof < 0 || !asciiAt(data, eof, "%%EOF")) return false;
  return data.slice(eof + 5).every((byte) => byte === 0x09 || byte === 0x0a || byte === 0x0d || byte === 0x20);
}

function hasJpegStructure(data: Uint8Array): boolean {
  if (data.length < 8 || !matchesPrefix(data, [0xff, 0xd8]) || !matchesPrefix(data.slice(-2), [0xff, 0xd9])) return false;
  let offset = 2;
  let hasFrame = false;
  let hasScan = false;
  while (offset < data.length) {
    if (data[offset++] !== 0xff) return false;
    while (data[offset] === 0xff) offset += 1;
    if (offset >= data.length) return false;
    const marker = data[offset++];
    if (marker === 0xda) {
      hasScan = true;
      if (offset + 2 > data.length) return false;
      const scanLength = (data[offset] << 8) | data[offset + 1];
      if (scanLength < 2 || offset + scanLength > data.length) return false;
      offset += scanLength;
      let nextSegment = false;
      while (offset < data.length) {
        const scanByte = data[offset++];
        if (scanByte !== 0xff) continue;
        if (offset >= data.length) return false;
        const scanMarkerStart = offset - 1;
        let scanMarker = data[offset++];
        while (scanMarker === 0xff) {
          if (offset >= data.length) return false;
          scanMarker = data[offset++];
        }
        if (scanMarker === 0x00 || (scanMarker >= 0xd0 && scanMarker <= 0xd7)) continue;
        if (scanMarker === 0xd9) return offset === data.length && hasFrame && hasScan;
        offset = scanMarkerStart;
        nextSegment = true;
        break;
      }
      if (!nextSegment) return false;
      continue;
    }
    if (marker === 0xd9) return false;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) hasFrame = true;
    if (offset + 2 > data.length) return false;
    const segmentLength = (data[offset] << 8) | data[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > data.length) return false;
    offset += segmentLength;
  }
  return false;
}

function hasPngStructure(data: Uint8Array): boolean {
  if (!matchesPrefix(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return false;
  let offset = 8;
  let hasHeader = false;
  let hasData = false;
  while (offset + 12 <= data.length) {
    const length = readU32(data, offset, false);
    const typeStart = offset + 4;
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > data.length) return false;
    const type = String.fromCharCode(...data.slice(typeStart, typeStart + 4));
    const chunkData = data.slice(typeStart + 4, typeStart + 4 + length);
    const expectedCrc = readU32(data, typeStart + 4 + length, false);
    if (crc32(concatenate(data.slice(typeStart, typeStart + 4), chunkData)) !== expectedCrc) return false;
    if (type === "IHDR") {
      if (hasHeader || length !== 13 || readU32(chunkData, 0, false) === 0 || readU32(chunkData, 4, false) === 0) return false;
      hasHeader = true;
    }
    if (type === "IDAT") hasData = true;
    if (type === "IEND") return hasHeader && hasData && length === 0 && chunkEnd === data.length;
    offset = chunkEnd;
  }
  return false;
}

function hasTiffStructure(data: Uint8Array): boolean {
  const littleEndian = matchesPrefix(data, [0x49, 0x49]);
  if ((!littleEndian && !matchesPrefix(data, [0x4d, 0x4d])) || data.length < 14 || readU16(data, 2, littleEndian) !== 42) return false;
  const ifdOffset = readU32(data, 4, littleEndian);
  if (ifdOffset + 2 > data.length) return false;
  const entryCount = readU16(data, ifdOffset, littleEndian);
  const entriesEnd = ifdOffset + 2 + entryCount * 12;
  if (entriesEnd + 4 > data.length) return false;
  let hasWidth = false;
  let hasHeight = false;
  for (let offset = ifdOffset + 2; offset < entriesEnd; offset += 12) {
    const tag = readU16(data, offset, littleEndian);
    const type = readU16(data, offset + 2, littleEndian);
    const count = readU32(data, offset + 4, littleEndian);
    if (count !== 1 || (type !== 3 && type !== 4)) continue;
    const value = type === 3 ? readU16(data, offset + 8, littleEndian) : readU32(data, offset + 8, littleEndian);
    if (tag === 256 && value > 0) hasWidth = true;
    if (tag === 257 && value > 0) hasHeight = true;
  }
  return hasWidth && hasHeight;
}

function hasHeicStructure(data: Uint8Array): boolean {
  const brands = ["heic", "heix", "hevc", "hevx", "mif1", "msf1"];
  let offset = 0;
  let hasFileType = false;
  let hasMeta = false;
  let hasMediaData = false;
  while (offset + 8 <= data.length) {
    const size = readU32(data, offset, false);
    const type = String.fromCharCode(...data.slice(offset + 4, offset + 8));
    const end = size === 0 ? data.length : offset + size;
    if (size !== 0 && (size < 8 || end > data.length)) return false;
    if (offset === 0) {
      if (type !== "ftyp" || end - offset < 16) return false;
      const majorBrand = String.fromCharCode(...data.slice(offset + 8, offset + 12));
      let hasCompatibleBrand = false;
      for (let brandOffset = offset + 16; brandOffset + 4 <= end; brandOffset += 4) {
        if (brands.includes(String.fromCharCode(...data.slice(brandOffset, brandOffset + 4)))) hasCompatibleBrand = true;
      }
      hasFileType = brands.includes(majorBrand) || hasCompatibleBrand;
      if (!hasFileType) return false;
    }
    if (type === "meta") hasMeta = true;
    if (type === "mdat") hasMediaData = true;
    offset = end;
    if (size === 0) break;
  }
  return offset === data.length && hasFileType && hasMeta && hasMediaData;
}

function hasSignature(format: UploadFormat, data: Uint8Array): boolean {
  if (format === "pdf") return hasPdfStructure(data);
  if (format === "jpeg") return hasJpegStructure(data);
  if (format === "png") return hasPngStructure(data);
  if (format === "tiff") return hasTiffStructure(data);
  return hasHeicStructure(data);
}

export function validateUpload(input: UploadMetadata): ValidatedUpload {
  if (!input || typeof input.name !== "string" || typeof input.mimeType !== "string" ||
    !Number.isInteger(input.sizeBytes) || !(input.data instanceof Uint8Array)) {
    return fail(UPLOAD_ERROR_CODES.INVALID_METADATA);
  }
  if ([...input.name].length > MAX_FILE_NAME_LENGTH) fail(UPLOAD_ERROR_CODES.INVALID_METADATA);
  if (input.data.byteLength === 0) fail(UPLOAD_ERROR_CODES.EMPTY_FILE);
  if (input.sizeBytes !== input.data.byteLength) fail(UPLOAD_ERROR_CODES.SIZE_MISMATCH);
  if (input.sizeBytes > MAX_UPLOAD_SIZE_BYTES) fail(UPLOAD_ERROR_CODES.FILE_TOO_LARGE);

  const dot = input.name.lastIndexOf(".");
  const extension = dot >= 0 ? input.name.slice(dot).toLowerCase() : "";
  const descriptor = formats[extension as keyof typeof formats];
  if (!descriptor) fail(UPLOAD_ERROR_CODES.UNSUPPORTED_FORMAT);
  if (input.mimeType.toLowerCase() !== descriptor.mimeType) fail(UPLOAD_ERROR_CODES.MIME_EXTENSION_MISMATCH);
  if (!hasSignature(descriptor.format, input.data)) fail(UPLOAD_ERROR_CODES.SIGNATURE_MISMATCH);

  return {
    originalFileName: input.name,
    originalMimeType: descriptor.mimeType,
    originalSizeBytes: input.sizeBytes,
    checksum: createHash("sha256").update(input.data).digest("hex"),
    format: descriptor.format,
    data: input.data,
  };
}
