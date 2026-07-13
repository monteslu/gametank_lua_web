// gtg.js - the GameTank sprite sheet format, browser-side.
//
// The GameTank's sprite GRAM is a full 256x256 page: FOUR 128x128 quadrants laid
// out NW / NE / SW / SE. Each quadrant is one raw .gtg file (128x128 8bpp, one
// palette byte per pixel, row-major, 0 = transparent). On disk / in the ROM the
// four are sibling files - foo.gtg (NW), foo_1.gtg (NE), foo_2.gtg (SW),
// foo_3.gtg (SE) - and the compiler's discoverQuadrants stitches them. spr(n)
// indexes an 8x8 grid across the whole page (cells 0-255); .gsi frame tables
// address any pixel 0-255 in it.
//
// The editor holds the sheet as ONE 256x256 buffer (65536 bytes) for painting
// (SHEET_DIM / SHEET_BYTES), and splits it into the four 128x128 .gtg quadrants
// at save/build time. No zlib here - the raw sheet is uncompressed; deflate
// happens inside the ROM at build time, which is the SDK's job, not the editor's.

export const QUAD_DIM = 128;                       // one quadrant edge
export const QUAD_BYTES = QUAD_DIM * QUAD_DIM;     // 16384, one .gtg file
export const SHEET_DIM = 256;                      // full page edge (editor buffer)
export const SHEET_BYTES = SHEET_DIM * SHEET_DIM;  // 65536, the editor buffer

/** A fresh, all-transparent (byte 0) full 256x256 sheet. */
export function newSheet() {
  return new Uint8Array(SHEET_BYTES);
}

/** A fresh, all-transparent single 128x128 quadrant (one .gtg file). */
export function newQuadrant() {
  return new Uint8Array(QUAD_BYTES);
}

export const idx = (x, y) => y * SHEET_DIM + x;
export const getPixel = (sheet, x, y) => sheet[idx(x, y)];
export const setPixel = (sheet, x, y, byte) => { sheet[idx(x, y)] = byte & 0xff; };

// Quadrant order matches the compiler: 0=NW (foo.gtg), 1=NE (_1), 2=SW (_2),
// 3=SE (_3). (col, row) of each quadrant's top-left pixel in the 256x256 page.
export const QUAD_ORIGIN = [
  { qx: 0, qy: 0 },       // 0 NW  gfx.gtg
  { qx: 128, qy: 0 },     // 1 NE  gfx_1.gtg
  { qx: 0, qy: 128 },     // 2 SW  gfx_2.gtg
  { qx: 128, qy: 128 },   // 3 SE  gfx_3.gtg
];
export const QUAD_FILES = ["gfx.gtg", "gfx_1.gtg", "gfx_2.gtg", "gfx_3.gtg"];

/** Extract quadrant `q` (0-3) from a 256x256 sheet as a 128x128 .gtg buffer. */
export function quadrantOf(sheet, q) {
  const { qx, qy } = QUAD_ORIGIN[q];
  const out = new Uint8Array(QUAD_BYTES);
  for (let y = 0; y < QUAD_DIM; y++) {
    const srow = (qy + y) * SHEET_DIM + qx;
    out.set(sheet.subarray(srow, srow + QUAD_DIM), y * QUAD_DIM);
  }
  return out;
}

/** Paint a 128x128 .gtg quadrant buffer into quadrant `q` of a 256x256 sheet. */
export function setQuadrant(sheet, q, quad) {
  const { qx, qy } = QUAD_ORIGIN[q];
  for (let y = 0; y < QUAD_DIM; y++) {
    const drow = (qy + y) * SHEET_DIM + qx;
    sheet.set(quad.subarray(y * QUAD_DIM, y * QUAD_DIM + QUAD_DIM), drow);
  }
}

// True if a 128x128 quadrant is entirely transparent (byte 0). Such a quadrant
// (other than NW) isn't written as a sibling file, so a game that never draws
// there pays no ROM cost.
export function quadrantIsEmpty(quad) {
  for (let i = 0; i < quad.length; i++) if (quad[i] !== 0) return false;
  return true;
}

/**
 * Split a 256x256 sheet into the compiler's quadrant files. Always emits
 * "gfx.gtg" (NW) so a sheet has a base file; emits "gfx_1/2/3.gtg" only for
 * NE/SW/SE quadrants that carry pixels, keeping the ROM lean.
 * @param {Uint8Array} sheet 256x256 buffer
 * @returns {Record<string, Uint8Array>}
 */
export function splitSheet(sheet) {
  const out = {};
  for (let q = 0; q < 4; q++) {
    const quad = quadrantOf(sheet, q);
    if (q === 0 || !quadrantIsEmpty(quad)) out[QUAD_FILES[q]] = quad;
  }
  return out;
}

/**
 * Assemble a 256x256 sheet from quadrant files. Accepts the record produced by
 * splitSheet (or a project's files map); missing quadrants stay transparent.
 * @param {Record<string, (Uint8Array|ArrayBuffer)>} files filename -> bytes
 */
export function joinSheet(files) {
  const sheet = newSheet();
  for (let q = 0; q < 4; q++) {
    const b = files[QUAD_FILES[q]];
    if (b) setQuadrant(sheet, q, b instanceof Uint8Array ? b : new Uint8Array(b));
  }
  return sheet;
}

/** Validate raw single-quadrant .gtg bytes -> a 128x128 buffer. */
export function fromGtg(bytes) {
  if (bytes.length !== QUAD_BYTES) {
    throw new Error(`.gtg must be ${QUAD_BYTES} bytes (128x128 8bpp), got ${bytes.length}`);
  }
  return new Uint8Array(bytes);
}

/** Serialize a sheet's NW quadrant as a raw single-quadrant .gtg for export. */
export function toGtg(sheet) {
  if (sheet.length === SHEET_BYTES) return quadrantOf(sheet, 0);
  if (sheet.length === QUAD_BYTES) return new Uint8Array(sheet);
  throw new Error(`toGtg: expected ${QUAD_BYTES} or ${SHEET_BYTES} bytes, got ${sheet.length}`);
}
