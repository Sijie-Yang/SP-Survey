/**
 * Minimal store-only (no compression) ZIP writer for browser downloads.
 * Avoids adding a zip dependency.
 */

function crc32Table() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = crc32Table();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function encodeUtf8(str) {
  return new TextEncoder().encode(str);
}

function u16(n) {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}

function u32(n) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return b;
}

function concatBytes(parts) {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/**
 * @param {Array<{ path: string, content: string|Uint8Array }>} files
 * @returns {Blob}
 */
export function buildZipBlob(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files || []) {
    const name = String(file.path || '').replace(/^\/+/, '');
    if (!name) continue;
    const nameBytes = encodeUtf8(name);
    const data = typeof file.content === 'string'
      ? encodeUtf8(file.content)
      : (file.content instanceof Uint8Array ? file.content : encodeUtf8(String(file.content ?? '')));
    const checksum = crc32(data);
    const size = data.length;

    const localHeader = concatBytes([
      u32(0x04034b50),
      u16(20),
      u16(0x0800), // UTF-8 flag
      u16(0), // store
      u16(0),
      u16(0),
      u32(checksum),
      u32(size),
      u32(size),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
    ]);

    localParts.push(localHeader, data);

    const centralHeader = concatBytes([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0),
      u32(checksum),
      u32(size),
      u32(size),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBytes,
    ]);
    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  }

  const centralDir = concatBytes(centralParts);
  const end = concatBytes([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(centralParts.length),
    u16(centralParts.length),
    u32(centralDir.length),
    u32(offset),
    u16(0),
  ]);

  return new Blob([concatBytes([...localParts, centralDir, end])], { type: 'application/zip' });
}

/** Trigger a browser download of a ZIP built from { path, content } entries. */
export function downloadZip(filename, files) {
  const blob = buildZipBlob(files);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
