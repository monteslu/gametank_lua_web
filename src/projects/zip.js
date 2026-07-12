// zip.js - minimal ZIP reader/writer (STORE method, no compression) for the
// .gtlua project bundle. Dependency-free; projects are small and the assets
// (.gtg/.gsi) are already compact, so stored entries are fine and keep the
// bundle trivially inspectable. If we ever want deflate we can route through the
// SDK's codec, but STORE is the honest, simplest canonical form for v1.

const enc = new TextEncoder();

// CRC-32 (IEEE) - table built once.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const toBytes = (v) => (typeof v === "string" ? enc.encode(v) : v instanceof Uint8Array ? v : new Uint8Array(v));

/**
 * Build a ZIP (stored) from { path: string|Uint8Array }. dosTime/dosDate are
 * optional (default 0 = no timestamp, since scripts can't read the clock; the
 * caller may pass real DOS time if it has one).
 * @returns {Uint8Array}
 */
export function zipStore(files, { dosTime = 0, dosDate = 0x21 } = {}) {
  const names = Object.keys(files);
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const name of names) {
    const nameBytes = enc.encode(name);
    const data = toBytes(files[name]);
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);       // local file header sig
    lv.setUint16(4, 20, true);               // version needed
    lv.setUint16(6, 0, true);                // flags
    lv.setUint16(8, 0, true);                // method: 0 = store
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);     // compressed size
    lv.setUint32(22, data.length, true);     // uncompressed size
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);               // extra len
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);       // central dir header sig
    cv.setUint16(4, 20, true);               // version made by
    cv.setUint16(6, 20, true);               // version needed
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);               // method store
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);               // extra
    cv.setUint16(32, 0, true);               // comment
    cv.setUint16(34, 0, true);               // disk #
    cv.setUint16(36, 0, true);               // internal attrs
    cv.setUint32(38, 0, true);               // external attrs
    cv.setUint32(42, offset, true);          // local header offset
    central.set(nameBytes, 46);
    centrals.push(central);

    offset += local.length;
  }

  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);         // EOCD sig
  ev.setUint16(8, names.length, true);       // entries this disk
  ev.setUint16(10, names.length, true);      // total entries
  ev.setUint32(12, centralSize, true);       // central dir size
  ev.setUint32(16, offset, true);            // central dir offset

  const total = offset + centralSize + eocd.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const l of locals) { out.set(l, p); p += l.length; }
  for (const c of centrals) { out.set(c, p); p += c.length; }
  out.set(eocd, p);
  return out;
}

/**
 * Read a ZIP (any stored entries; deflate entries throw). Returns { path:
 * Uint8Array }. Enough to import a .gtlua we wrote.
 * @param {Uint8Array} buf
 */
export function unzip(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // find EOCD (scan backward for the sig; no zip comment in ours)
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip (no EOCD)");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);     // central dir offset
  const files = {};
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("bad central header");
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    if (method !== 0) throw new Error(`entry ${name} is compressed (unsupported)`);
    // read from the local header
    const lNameLen = dv.getUint16(localOff + 26, true);
    const lExtraLen = dv.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    files[name] = buf.slice(dataStart, dataStart + compSize);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}
