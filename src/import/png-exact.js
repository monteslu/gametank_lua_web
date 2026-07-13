// png-exact.js - decode a PNG to exact RGBA bytes, no canvas.
//
// Canvas getImageData round-trips through premultiplied alpha, which corrupts
// the low bits of r/g/b whenever alpha < 255 - and a .p8.png cart stores its
// data in exactly those low 2 bits (alpha included). So cart extraction needs
// a bit-exact decode: DecompressionStream inflates the IDAT stream, and the
// scanline filters are reconstructed here. Supports 8-bit RGB / RGBA /
// palette, non-interlaced (what PICO-8 emits).

async function inflate(bytes) {
  const ds = new DecompressionStream("deflate");
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

export async function decodePngExact(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] !== 0x89 || b[1] !== 0x50) throw new Error("not a PNG");
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let pos = 8, w = 0, h = 0, bitDepth = 0, colorType = 0, interlace = 0, pal = null;
  const idat = [];
  while (pos < b.length) {
    const len = dv.getUint32(pos);
    const type = String.fromCharCode(b[pos + 4], b[pos + 5], b[pos + 6], b[pos + 7]);
    const data = b.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      w = dv.getUint32(pos + 8); h = dv.getUint32(pos + 12);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === "PLTE") pal = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth}`);
  if (interlace) throw new Error("interlaced PNG not supported");
  const ch = colorType === 2 ? 3 : colorType === 6 ? 4 : colorType === 3 ? 1 : 0;
  if (!ch) throw new Error(`unsupported PNG color type ${colorType}`);

  const total = idat.reduce((n, d) => n + d.length, 0);
  const z = new Uint8Array(total);
  let zo = 0;
  for (const d of idat) { z.set(d, zo); zo += d.length; }
  const raw = await inflate(z);

  const stride = w * ch;
  const rgba = new Uint8Array(w * h * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const row = raw.slice(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? row[i - ch] : 0, up = prev[i], c = i >= ch ? prev[i - ch] : 0;
      if (f === 1) row[i] = (row[i] + a) & 255;
      else if (f === 2) row[i] = (row[i] + up) & 255;
      else if (f === 3) row[i] = (row[i] + ((a + up) >> 1)) & 255;
      else if (f === 4) {
        const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c);
        row[i] = (row[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? up : c)) & 255;
      }
    }
    prev = row;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (colorType === 3) {
        const idx = row[x] * 3;
        rgba[o] = pal[idx]; rgba[o + 1] = pal[idx + 1]; rgba[o + 2] = pal[idx + 2]; rgba[o + 3] = 255;
      } else if (colorType === 2) {
        rgba[o] = row[x * 3]; rgba[o + 1] = row[x * 3 + 1]; rgba[o + 2] = row[x * 3 + 2]; rgba[o + 3] = 255;
      } else {
        rgba[o] = row[x * 4]; rgba[o + 1] = row[x * 4 + 1]; rgba[o + 2] = row[x * 4 + 2]; rgba[o + 3] = row[x * 4 + 3];
      }
    }
  }
  return { width: w, height: h, rgba };
}
