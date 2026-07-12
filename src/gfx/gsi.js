// gsi.js - frame-table helpers for the editor, over the SDK's browser-safe
// frames.js codec. A frame is { vxo, vyo, w, h, gx, gy }:
//   gx/gy = source rect top-left in the sheet (0-255, any quadrant)
//   w/h   = sprite size in pixels
//   vxo/vyo = draw offset from the sprite's anchor (classic centering: -w/2,-h/2)
// This is Clyde Shaffer's exact .gsi format; sprf(frame, x, y) reads it at draw
// time. See docs/SPRITES.md.
import { parseGsi, encodeGsi, FRAME_BYTES } from "gtlua/compiler/frames.js";

export { parseGsi, encodeGsi, FRAME_BYTES };

/** A new frame carved from a sheet rect, centered anchor by default. */
export function frameFromRect(gx, gy, w, h) {
  return { vxo: -(w >> 1), vyo: -(h >> 1), w, h, gx, gy };
}

/** Clamp a frame's fields to the byte ranges the format allows. */
export function clampFrame(f) {
  const u8 = (v) => Math.max(0, Math.min(255, v | 0));
  const i8 = (v) => Math.max(-128, Math.min(127, v | 0));
  return { vxo: i8(f.vxo), vyo: i8(f.vyo), w: u8(f.w), h: u8(f.h), gx: u8(f.gx), gy: u8(f.gy) };
}
