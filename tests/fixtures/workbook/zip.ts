import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

// A minimal zip reader and writer, so tests can patch a generated workbook's XML
// and build hostile archives without fixture files.

export interface ZipEntry {
  name: string;
  data: Buffer;
  /** 0 = stored (default), 8 = deflated. */
  method?: 0 | 8;
  /** Uncompressed size written in the headers; defaults to the real one. */
  declaredSize?: number;
}

export function unzip(bytes: Buffer): ZipEntry[] {
  let end = bytes.length - 22;
  while (end >= 0 && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  const count = bytes.readUInt16LE(end + 10);
  let p = bytes.readUInt32LE(end + 16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    const method = bytes.readUInt16LE(p + 10);
    const compressedSize = bytes.readUInt32LE(p + 20);
    const nameLength = bytes.readUInt16LE(p + 28);
    const local = bytes.readUInt32LE(p + 42);
    const name = bytes.toString("utf8", p + 46, p + 46 + nameLength);
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const raw = bytes.subarray(start, start + compressedSize);
    entries.push({ name, data: method === 8 ? inflateRawSync(raw) : Buffer.from(raw) });
    p += 46 + nameLength + bytes.readUInt16LE(p + 30) + bytes.readUInt16LE(p + 32);
  }
  return entries;
}

export function zip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const method = entry.method ?? 0;
    const body = method === 8 ? deflateRawSync(entry.data) : entry.data;
    const size = entry.declaredSize ?? entry.data.length;
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    directory.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const directoryBytes = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directoryBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directoryBytes, end]);
}
