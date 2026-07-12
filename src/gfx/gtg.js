// gtg.js - the GameTank sprite sheet format, browser-side.
//
// A .gtg is dead simple: one 128x128 quadrant of 8bpp pixels = 16384 raw color
// bytes, row-major, one byte per pixel (the raw palette byte; 0 = transparent).
// That's the whole format for a single quadrant, which is what the v1 sprite
// editor edits. (Multi-quadrant 256x256 sheets are sibling files foo.gtg /
// foo_1.gtg / foo_2 / foo_3 - deferred; the compiler's discoverQuadrants stitches
// them.) No zlib here - the raw sheet is uncompressed; deflate only happens
// inside the ROM at build time, which is the SDK's job, not the editor's.

export const SHEET_DIM = 128;
export const SHEET_BYTES = SHEET_DIM * SHEET_DIM;   // 16384

/** A fresh, all-transparent (byte 0) sheet. */
export function newSheet() {
  return new Uint8Array(SHEET_BYTES);
}

/** Validate + copy raw .gtg bytes into a sheet buffer. */
export function fromGtg(bytes) {
  if (bytes.length !== SHEET_BYTES) {
    throw new Error(`.gtg must be ${SHEET_BYTES} bytes (128x128 8bpp), got ${bytes.length}`);
  }
  return new Uint8Array(bytes);
}

/** A sheet IS the .gtg bytes; return a copy so callers can't mutate the source. */
export function toGtg(sheet) {
  return new Uint8Array(sheet);
}

export const idx = (x, y) => y * SHEET_DIM + x;
export const getPixel = (sheet, x, y) => sheet[idx(x, y)];
export const setPixel = (sheet, x, y, byte) => { sheet[idx(x, y)] = byte & 0xff; };
