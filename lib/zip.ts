interface ZipEntry {
  data: Blob;
  name: string;
}

interface CentralDirectoryRecord {
  compressedSize: number;
  crc: number;
  nameBytes: Uint8Array;
  offset: number;
  size: number;
}

const textEncoder = new TextEncoder();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeU16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function writeU32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, true);
}

function concat(parts: Uint8Array[]): Blob {
  return new Blob(
    parts.map((part) => part.slice().buffer as ArrayBuffer),
    { type: 'application/zip' },
  );
}

export async function createZipBlob(entries: readonly ZipEntry[]): Promise<Blob> {
  if (entries.length === 0) {
    throw new Error('没有可打包的截图。');
  }

  const chunks: Uint8Array[] = [];
  const central: CentralDirectoryRecord[] = [];
  let offset = 0;

  for (const entry of entries) {
    const data = new Uint8Array(await entry.data.arrayBuffer());
    const nameBytes = textEncoder.encode(entry.name);
    const header = new Uint8Array(30 + nameBytes.length);
    const headerView = new DataView(header.buffer);
    writeU32(headerView, 0, 0x04034b50);
    writeU16(headerView, 4, 20);
    writeU16(headerView, 6, 0x800);
    writeU16(headerView, 8, 0);
    writeU16(headerView, 10, 0);
    writeU16(headerView, 12, 0);
    writeU32(headerView, 14, crc32(data));
    writeU32(headerView, 18, data.byteLength);
    writeU32(headerView, 22, data.byteLength);
    writeU16(headerView, 26, nameBytes.length);
    writeU16(headerView, 28, 0);
    header.set(nameBytes, 30);
    chunks.push(header, data);
    central.push({
      compressedSize: data.byteLength,
      crc: crc32(data),
      nameBytes,
      offset,
      size: data.byteLength,
    });
    offset += header.byteLength + data.byteLength;
  }

  const centralOffset = offset;
  for (const record of central) {
    const header = new Uint8Array(46 + record.nameBytes.length);
    const view = new DataView(header.buffer);
    writeU32(view, 0, 0x02014b50);
    writeU16(view, 4, 20);
    writeU16(view, 6, 20);
    writeU16(view, 8, 0x800);
    writeU16(view, 10, 0);
    writeU16(view, 12, 0);
    writeU16(view, 14, 0);
    writeU32(view, 16, record.crc);
    writeU32(view, 20, record.compressedSize);
    writeU32(view, 24, record.size);
    writeU16(view, 28, record.nameBytes.length);
    writeU16(view, 30, 0);
    writeU16(view, 32, 0);
    writeU16(view, 34, 0);
    writeU16(view, 36, 0);
    writeU32(view, 38, 0);
    writeU32(view, 42, record.offset);
    header.set(record.nameBytes, 46);
    chunks.push(header);
    offset += header.byteLength;
  }

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  writeU32(endView, 0, 0x06054b50);
  writeU16(endView, 4, 0);
  writeU16(endView, 6, 0);
  writeU16(endView, 8, central.length);
  writeU16(endView, 10, central.length);
  writeU32(endView, 12, offset - centralOffset);
  writeU32(endView, 16, centralOffset);
  writeU16(endView, 20, 0);
  chunks.push(end);

  return concat(chunks);
}

export type { ZipEntry };
