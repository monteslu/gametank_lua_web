// palette.js - the GameTank color model for the editors.
//
// Colors are raw bytes 0-255; each byte's on-screen RGB is the emulator's
// CAPTURE table (hardware-accurate). We use the SDK's GT_CAPTURE_PALETTE
// verbatim - it was regenerated from the core and verified against the actual
// render (byte 169 = cls(1)'s dark blue = [31,51,74], byte 31 = the smiley's
// yellow-green = [185,197,65], both confirmed on-screen). Do NOT substitute the
// docs/PALETTE.md approximation table - the plan is explicit that swatches must
// match the emulator, and this table does.
//
// P8_PALETTE is the 16 PICO-8 index -> GameTank byte bake (what cls(1),
// print(...,14), rectfill(...,8) compile to). It's a convenience row for
// porters; the full palette is the 256 raw bytes. Dynamic colors are raw bytes,
// NOT re-mapped from 0-15.
import { GT_CAPTURE_PALETTE, nearestColorByte } from "gtlua/compiler/gt_palette.js";
import { P8_PALETTE } from "gtlua/compiler/builtins.js";

export { GT_CAPTURE_PALETTE, nearestColorByte, P8_PALETTE };

// byte 0 is the transparent color for sprites (GameTank convention: index 0 in a
// sheet = don't draw). It still has a CAPTURE rgb, but in the sheet editor we
// render it as a checkerboard, not that color.
export const TRANSPARENT = 0;

/** "#rrggbb" for a color byte (for CSS swatches / inputs). */
export function byteToCss(byte) {
  const [r, g, b] = GT_CAPTURE_PALETTE[byte & 0xff];
  return "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");
}

/** rgba fill for a canvas ImageData pixel from a color byte. */
export function byteToRgb(byte) {
  return GT_CAPTURE_PALETTE[byte & 0xff];
}
