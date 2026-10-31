/**
 * Minimal ZIP writer: STORED (uncompressed) entries only.

 * Why no library: all inputs are PNG/JPEG, already compressed. Deflate adds
 * time without reducing file size. Local headers, central directory and CRC32
 * need about 70 lines, not another dependency.

 * Limits: generated ASCII filenames, total size <4 GB (no ZIP64), fewer than
 * 65,535 entries. Store sets approach none of these limits.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  return (crcStep(0xffffffff, data, 0, data.length) ^ 0xffffffff) >>> 0;
}

function crcStep(c: number, data: Uint8Array, from: number, to: number): number {
  for (let i = from; i < to; i += 1) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return c;
}

/**
 * Checksums of many entries in 4 MB slices, yielding between them so the page stays responsive and a
 * cancel (AbortError) is noticed while a large archive is packed.
 */
export async function crc32All(list: Uint8Array[], signal?: AbortSignal): Promise<number[]> {
  const SLICE = 4 * 1024 * 1024;
  const out: number[] = [];
  for (const data of list) {
    let c = 0xffffffff;
    for (let at = 0; at < data.length || at === 0; at += SLICE) {
      if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
      c = crcStep(c, data, at, Math.min(data.length, at + SLICE));
      await new Promise((r) => setTimeout(r, 0));
      if (data.length === 0) break;
    }
    out.push((c ^ 0xffffffff) >>> 0);
  }
  return out;
}

export type ZipEntry = { name: string; data: Uint8Array };

/** DOS date/time fields: use the current time so archive tools do not show 1980. */
function dosTime(d: Date) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/** `crcs`: precomputed checksums in entry order (crc32All); computed here when omitted. */
export function buildZip(entries: ZipEntry[], crcs?: number[]): Blob {
  const enc = new TextEncoder();
  const { time, date } = dosTime(new Date());
  const parts: BlobPart[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  entries.forEach((e, i) => {
    const name = enc.encode(e.name);
    const crc = crcs?.[i] ?? crc32(e.data);
    const size = e.data.length;

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // Local header signature
    lv.setUint16(4, 20, true); // Required version 2.0
    lv.setUint16(6, 0, true); // No flags
    lv.setUint16(8, 0, true); // Method 0 = STORED
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true); // Compressed size
    lv.setUint32(22, size, true); // Uncompressed size
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true); // No extra fields
    local.set(name, 30);
    parts.push(local, e.data as Uint8Array<ArrayBuffer>);

    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true); // Central directory signature
    cv.setUint16(4, 20, true); // Writer version
    cv.setUint16(6, 20, true); // Required version
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    // 30 extra fields, 32 comment, 34 disk number, 36 internal attributes: all zero.
    cv.setUint32(38, 0, true); // External attributes
    cv.setUint32(42, offset, true); // Local header offset
    cen.set(name, 46);
    central.push(cen);

    offset += local.length + size;
  });

  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); // End-of-directory signature
  ev.setUint16(8, entries.length, true); // Entries on this disk
  ev.setUint16(10, entries.length, true); // Total entries
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true); // Central directory offset

  return new Blob([...parts, ...(central as Uint8Array<ArrayBuffer>[]), end], { type: 'application/zip' });
}
