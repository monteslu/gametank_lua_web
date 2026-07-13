// aseprite-import.js - parse an Aseprite (.ase/.aseprite) file in the browser
// and flatten it to RGBA, so it can go through the same nearest-color -> .gtg
// path as PNG import. Also extracts animation TAGS as .gsi-style frame ranges.
//
// Aseprite format (documented): a header, then per-frame chunks. We handle the
// common cases: color modes RGBA(32) / grayscale(16) / indexed(8), layer +
// cel chunks (compressed cels via the browser's native DecompressionStream, so
// no zlib dep), the palette chunks, and frame tags. Layers are composited in
// order (normal blend, opacity) into a flat RGBA image for frame 0 (or a chosen
// frame). See https://github.com/aseprite/aseprite/blob/main/docs/ase-file-specs.md
//
// This is a focused importer: single flattened frame -> sheet, plus tag ranges
// surfaced for the frame editor. Complex blend modes fall back to normal.

const CHUNK = { OLD_PALETTE: 0x0004, LAYER: 0x2004, CEL: 0x2005, PALETTE: 0x2019, TAGS: 0x2018 };

async function inflate(bytes) {
  // Aseprite cels are zlib (deflate with a 2-byte header). DecompressionStream
  // "deflate" expects zlib-wrapped data - which is exactly what Aseprite writes.
  const ds = new DecompressionStream("deflate");
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/** Parse .ase bytes. Returns { width, height, colorMode, frames, palette, tags }. */
export async function parseAseprite(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = dv.getUint16(4, true);
  if (magic !== 0xa5e0) throw new Error("not an Aseprite file");
  const nFrames = dv.getUint16(6, true);
  const width = dv.getUint16(8, true);
  const height = dv.getUint16(10, true);
  const depth = dv.getUint16(12, true);       // 32 RGBA, 16 gray, 8 indexed
  const transparentIndex = bytes[28];
  let palette = null;                          // [ [r,g,b,a], ... ] for indexed
  const tags = [];
  const layers = [];
  const frames = [];

  let p = 128;   // header is 128 bytes
  for (let f = 0; f < nFrames; f++) {
    // frame header: bytes(4) magic(2) oldChunks(2) duration(2) reserved(2)
    // newChunks(4). Use newChunks (p+12) when non-zero, else the old count (p+6).
    const frameLen = dv.getUint32(p, true);
    const frameEnd = p + frameLen;
    const oldN = dv.getUint16(p + 6, true);
    const newN = dv.getUint32(p + 12, true);
    const nChunks = newN !== 0 ? newN : oldN;
    let q = p + 16;
    const cels = [];
    for (let c = 0; c < nChunks; c++) {
      const size = dv.getUint32(q, true);
      const type = dv.getUint16(q + 4, true);
      const data = q + 6;
      if (type === CHUNK.LAYER) {
        const flags = dv.getUint16(data, true);
        const opacity = bytes[data + 16];
        layers.push({ visible: (flags & 1) !== 0, opacity });
      } else if (type === CHUNK.CEL) {
        const layerIndex = dv.getUint16(data, true);
        const x = dv.getInt16(data + 2, true);
        const y = dv.getInt16(data + 4, true);
        const celOpacity = bytes[data + 6];
        const celType = dv.getUint16(data + 7, true);
        if (celType === 0 || celType === 2) {   // raw or compressed image
          const w = dv.getUint16(data + 16, true);
          const h = dv.getUint16(data + 18, true);
          // chunk data ends at q+size (data = q+6, size includes the 6-byte
          // chunk header); the cel image bytes run from data+20 to there.
          const pix = bytes.subarray(data + 20, q + size);
          cels.push({ layerIndex, x, y, w, h, celOpacity, celType, pix });
        }
        // linked cels (type 1) not handled - rare in exports
      } else if (type === CHUNK.PALETTE) {
        const newSize = dv.getUint32(data, true);
        const from = dv.getUint32(data + 4, true);
        palette = palette || [];
        let pp = data + 20;
        for (let i = from; i < from + (dv.getUint32(data + 8, true) - from + 1); i++) {
          const hasName = dv.getUint16(pp, true) & 1;
          const r = bytes[pp + 2], g = bytes[pp + 3], b = bytes[pp + 4], a = bytes[pp + 5];
          palette[i] = [r, g, b, a]; pp += 6;
          if (hasName) { const nl = dv.getUint16(pp, true); pp += 2 + nl; }
        }
      } else if (type === CHUNK.OLD_PALETTE && !palette) {
        palette = [];
        const nPackets = dv.getUint16(data, true);
        let pp = data + 2, idx = 0;
        for (let k = 0; k < nPackets; k++) {
          idx += bytes[pp++]; let cnt = bytes[pp++]; if (cnt === 0) cnt = 256;
          for (let i = 0; i < cnt; i++) { palette[idx] = [bytes[pp], bytes[pp + 1], bytes[pp + 2], 255]; pp += 3; idx++; }
        }
      } else if (type === CHUNK.TAGS) {
        const n = dv.getUint16(data, true);
        let tp = data + 10;
        for (let k = 0; k < n; k++) {
          const from = dv.getUint16(tp, true), to = dv.getUint16(tp + 2, true);
          const nameLen = dv.getUint16(tp + 17, true);
          const name = new TextDecoder().decode(bytes.subarray(tp + 19, tp + 19 + nameLen));
          tags.push({ name, from, to });
          tp += 19 + nameLen;
        }
      }
      q += size;
    }
    frames.push({ cels });
    p = frameEnd;
  }

  return { width, height, depth, transparentIndex, palette, tags, frames, layers };
}

// composite a parsed frame's cels into a flat RGBA image
async function flattenFrame(ase, frameIndex) {
  const { width, height, depth, palette, transparentIndex } = ase;
  const out = new Uint8Array(width * height * 4);   // RGBA, 0 alpha = empty
  const frame = ase.frames[frameIndex] || ase.frames[0];
  for (const cel of frame.cels) {
    const layer = ase.layers[cel.layerIndex];
    if (layer && !layer.visible) continue;
    let src = cel.pix;
    if (cel.celType === 2) src = await inflate(src);
    const bpp = depth / 8;
    for (let cy = 0; cy < cel.h; cy++) {
      for (let cx = 0; cx < cel.w; cx++) {
        const px = cel.x + cx, py = cel.y + cy;
        if (px < 0 || py < 0 || px >= width || py >= height) continue;
        const si = (cy * cel.w + cx) * bpp;
        let r, g, b, a;
        if (depth === 32) { r = src[si]; g = src[si + 1]; b = src[si + 2]; a = src[si + 3]; }
        else if (depth === 16) { const v = src[si]; r = g = b = v; a = src[si + 1]; }
        else { const idx = src[si]; if (idx === transparentIndex) { a = 0; } const pe = palette && palette[idx]; if (pe) { r = pe[0]; g = pe[1]; b = pe[2]; a = idx === transparentIndex ? 0 : (pe[3] ?? 255); } else { r = g = b = 0; a = 0; } }
        if (!a) continue;
        const oi = (py * width + px) * 4;
        out[oi] = r; out[oi + 1] = g; out[oi + 2] = b; out[oi + 3] = 255;   // simple over-normal
      }
    }
  }
  return { width, height, rgba: out };
}

/** Parse + flatten frame 0 to { width, height, rgba }. */
export async function aseToRgba(bytes, frameIndex = 0) {
  const ase = await parseAseprite(bytes);
  const img = await flattenFrame(ase, frameIndex);
  img.tags = ase.tags;
  return img;
}

/**
 * Import a multi-frame Aseprite as a packed sheet + frame table. Every frame is
 * flattened and laid out left-to-right / top-to-bottom on the 128x128 sheet (a
 * grid of frameW x frameH cells); each gets a .gsi frame record {vxo,vyo,w,h,
 * gx,gy} with a centered anchor. So an Aseprite walk-cycle becomes a ready-to-
 * animate .gtg + .gsi pair (sprf).
 * @returns { rgba: {width,height,rgba}, frames: [{vxo,vyo,w,h,gx,gy}], tags, nFrames }
 */
export async function aseToSheetAndFrames(bytes) {
  const ase = await parseAseprite(bytes);
  const { width: fw, height: fh } = ase;
  const SHEET = 128;
  const cols = Math.max(1, Math.floor(SHEET / fw));
  const rows = Math.max(1, Math.floor(SHEET / fh));
  const capacity = cols * rows;
  const nFrames = Math.min(ase.frames.length, capacity);

  // composite each frame into its grid cell of one big RGBA sheet
  const sheet = new Uint8Array(SHEET * SHEET * 4);
  const frames = [];
  for (let f = 0; f < nFrames; f++) {
    const cx = (f % cols) * fw;
    const cy = Math.floor(f / cols) * fh;
    const img = await flattenFrame(ase, f);
    for (let y = 0; y < fh && cy + y < SHEET; y++) {
      for (let x = 0; x < fw && cx + x < SHEET; x++) {
        const si = (y * fw + x) * 4;
        if (!img.rgba[si + 3]) continue;
        const oi = ((cy + y) * SHEET + (cx + x)) * 4;
        sheet[oi] = img.rgba[si]; sheet[oi + 1] = img.rgba[si + 1]; sheet[oi + 2] = img.rgba[si + 2]; sheet[oi + 3] = 255;
      }
    }
    frames.push({ vxo: -(fw >> 1), vyo: -(fh >> 1), w: fw, h: fh, gx: cx, gy: cy });
  }
  return { rgba: { width: SHEET, height: SHEET, rgba: sheet }, frames, tags: ase.tags, nFrames, dropped: ase.frames.length - nFrames };
}
