// png-import.js - decode a PNG in the browser and map it to a GameTank .gtg
// sheet. The browser decodes PNG natively (Image + canvas -> RGBA), so no
// node:zlib is needed; we only do the RGBA -> GameTank-byte nearest-color match,
// which is the SDK's nearestColorByte (verified: 185,197,65 -> byte 31).
//
// A .gtg is one 128x128 8bpp quadrant. A PNG larger than 128 in either axis is
// cropped to the top-left 128x128 for v1 (256x256 multi-quadrant is deferred,
// matching the sprite editor's single-quadrant scope). Fully/mostly transparent
// pixels (alpha < cutoff) become byte 0 (transparent).
import { nearestColorByte } from "./palette.js";
import { SHEET_DIM, newSheet } from "./gtg.js";

/** Decode PNG bytes to { width, height, rgba: Uint8ClampedArray }. */
export function decodePngToRgba(bytes) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([bytes], { type: "image/png" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement("canvas");
      cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      const ctx = cv.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const { data } = ctx.getImageData(0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      resolve({ width: cv.width, height: cv.height, rgba: data });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("not a valid image")); };
    img.src = url;
  });
}

/**
 * PNG bytes -> a 128x128 .gtg sheet (Uint8Array(16384)). Each opaque pixel is
 * matched to the nearest of GameTank's 256 colors; transparent pixels -> byte 0.
 * Larger images are cropped to the top-left 128x128.
 * @param {Uint8Array} pngBytes
 * @param {{alphaCutoff?: number}} [opts]
 */
/**
 * RGBA image -> a 128x128 .gtg sheet via nearest-color. Shared by PNG and
 * Aseprite import. Transparent pixels (alpha < cutoff) -> byte 0. Cropped to
 * the top-left 128x128.
 */
export function rgbaToSheet({ width, height, rgba }, { alphaCutoff = 128 } = {}) {
  const sheet = newSheet();
  const w = Math.min(width, SHEET_DIM);
  const h = Math.min(height, SHEET_DIM);
  // nearestColorByte scans all 256 palette entries per call; pixel art repeats a
  // handful of colors heavily, so cache color(packed RGB) -> byte and only scan
  // once per distinct color (turns ~4M scans into a few dozen).
  const cache = new Map();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * width + x) * 4;
      if (rgba[o + 3] < alphaCutoff) continue;   // stays byte 0 (transparent)
      const key = (rgba[o] << 16) | (rgba[o + 1] << 8) | rgba[o + 2];
      let byte = cache.get(key);
      if (byte === undefined) { byte = nearestColorByte(rgba[o], rgba[o + 1], rgba[o + 2]); cache.set(key, byte); }
      sheet[y * SHEET_DIM + x] = byte;
    }
  }
  return { sheet, width, height, cropped: width > SHEET_DIM || height > SHEET_DIM };
}

export async function pngToSheet(pngBytes, opts) {
  const img = await decodePngToRgba(pngBytes);
  return rgbaToSheet(img, opts);
}
