import React from "react";
import { GT_CAPTURE_PALETTE, P8_PALETTE, byteToCss, TRANSPARENT } from "./palette.js";

// A swatch grid for the 256 raw GameTank bytes + the 16 PICO-8-index shortcut
// row. Clicking sets the current draw byte. Byte 0 is transparent (shown as a
// checker chip). Colors come from the core-accurate CAPTURE table.
export function PalettePicker({ value, onChange }) {
  const swatch = (byte, key, extraClass = "") => (
    <button
      key={key}
      className={"swatch " + (byte === value ? "sel " : "") + extraClass}
      style={byte === TRANSPARENT ? undefined : { background: byteToCss(byte) }}
      title={byte === TRANSPARENT ? "transparent (byte 0)" : `byte ${byte} · ${byteToCss(byte)}`}
      onClick={() => onChange(byte)}
    />
  );

  return (
    <div className="palette">
      <div className="pal-label">pico-8 colors (cls/print/rectfill indices)</div>
      <div className="pal-row p8">
        {P8_PALETTE.map((byte, i) => swatch(byte, "p8" + i, i === 0 ? "transparent" : ""))}
      </div>
      <div className="pal-label">full palette (raw bytes 0-255)</div>
      <div className="pal-grid">
        {GT_CAPTURE_PALETTE.map((_, byte) => swatch(byte, "b" + byte, byte === 0 ? "transparent" : ""))}
      </div>
      <div className="pal-current">
        selected: {value === TRANSPARENT ? "transparent (0)" : `byte ${value} · ${byteToCss(value)}`}
      </div>
    </div>
  );
}
