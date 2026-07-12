import React, { useEffect, useRef, useState, useCallback } from "react";
import { SHEET_DIM, getPixel, setPixel } from "./gtg.js";
import { byteToRgb, TRANSPARENT } from "./palette.js";
import { PalettePicker } from "./PalettePicker.jsx";
import { pngToSheet } from "./png-import.js";
import { pickFile } from "../util/download.js";

const TOOLS = ["pencil", "eraser", "fill", "line", "rect"];

// Paint the sheet into an ImageData (transparent byte 0 -> checkerboard so it
// reads as "no pixel", matching how the blitter skips it).
function drawSheet(ctx, sheet) {
  const img = ctx.createImageData(SHEET_DIM, SHEET_DIM);
  const d = img.data;
  for (let y = 0; y < SHEET_DIM; y++) {
    for (let x = 0; x < SHEET_DIM; x++) {
      const byte = sheet[y * SHEET_DIM + x];
      const o = (y * SHEET_DIM + x) * 4;
      if (byte === TRANSPARENT) {
        const c = ((x >> 2) + (y >> 2)) & 1 ? 44 : 32;   // checker
        d[o] = c; d[o + 1] = c; d[o + 2] = c + 4; d[o + 3] = 255;
      } else {
        const [r, g, b] = byteToRgb(byte);
        d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * A 128x128 sprite-sheet editor. `sheet` is a Uint8Array(16384) of raw color
 * bytes; onChange fires with a NEW array after each edit (immutable so React
 * and autosave see the change). Tools: pencil, eraser, fill, line, rect.
 */
export function SpriteEditor({ sheet, onChange }) {
  const canvasRef = useRef(null);
  const [zoom, setZoom] = useState(4);
  const [tool, setTool] = useState("pencil");
  const [color, setColor] = useState(8);         // a visible default (P8 red byte)
  const drawing = useRef(null);                  // { startX, startY, base } during a drag

  // repaint whenever the sheet changes
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) drawSheet(ctx, sheet);
  }, [sheet]);

  const pixelAt = useCallback((e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / zoom);
    const y = Math.floor((e.clientY - rect.top) / zoom);
    if (x < 0 || y < 0 || x >= SHEET_DIM || y >= SHEET_DIM) return null;
    return { x, y };
  }, [zoom]);

  // flood fill from (x,y) over the contiguous region of the same byte
  const floodFill = (buf, x, y, target, replace) => {
    if (target === replace) return;
    const stack = [[x, y]];
    while (stack.length) {
      const [cx, cy] = stack.pop();
      if (cx < 0 || cy < 0 || cx >= SHEET_DIM || cy >= SHEET_DIM) continue;
      if (getPixel(buf, cx, cy) !== target) continue;
      setPixel(buf, cx, cy, replace);
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
  };

  const drawLine = (buf, x0, y0, x1, y1, byte) => {
    // Bresenham
    let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    for (;;) {
      setPixel(buf, x0, y0, byte);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
  };

  const drawRect = (buf, x0, y0, x1, y1, byte) => {
    const lx = Math.min(x0, x1), hx = Math.max(x0, x1);
    const ly = Math.min(y0, y1), hy = Math.max(y0, y1);
    for (let x = lx; x <= hx; x++) { setPixel(buf, x, ly, byte); setPixel(buf, x, hy, byte); }
    for (let y = ly; y <= hy; y++) { setPixel(buf, lx, y, byte); setPixel(buf, hx, y, byte); }
  };

  const commit = (buf) => onChange(buf);

  const onDown = (e) => {
    const p = pixelAt(e);
    if (!p) return;
    e.preventDefault();
    const buf = new Uint8Array(sheet);
    const paint = tool === "eraser" ? TRANSPARENT : color;
    if (tool === "pencil" || tool === "eraser") {
      setPixel(buf, p.x, p.y, paint);
      drawing.current = { tool, paint, last: p, buf };
      commit(buf);
    } else if (tool === "fill") {
      floodFill(buf, p.x, p.y, getPixel(buf, p.x, p.y), paint);
      commit(buf);
    } else if (tool === "line" || tool === "rect") {
      // preview drag: keep the pristine base, redraw shape each move
      drawing.current = { tool, paint, start: p, base: new Uint8Array(sheet) };
    }
  };

  const onMove = (e) => {
    const d = drawing.current;
    if (!d) return;
    const p = pixelAt(e);
    if (!p) return;
    if (d.tool === "pencil" || d.tool === "eraser") {
      const buf = new Uint8Array(sheet);
      drawLine(buf, d.last.x, d.last.y, p.x, p.y, d.paint);
      d.last = p; d.buf = buf;
      commit(buf);
    } else if (d.tool === "line") {
      const buf = new Uint8Array(d.base);
      drawLine(buf, d.start.x, d.start.y, p.x, p.y, d.paint);
      commit(buf);
    } else if (d.tool === "rect") {
      const buf = new Uint8Array(d.base);
      drawRect(buf, d.start.x, d.start.y, p.x, p.y, d.paint);
      commit(buf);
    }
  };

  const onUp = () => { drawing.current = null; };

  useEffect(() => {
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, []);

  const [importMsg, setImportMsg] = useState("");
  const importPng = useCallback(async () => {
    const picked = await pickFile(".png,image/png");
    if (!picked) return;
    try {
      const { sheet: next, width, height, cropped } = await pngToSheet(picked.bytes);
      onChange(next);
      setImportMsg(`imported ${width}×${height}${cropped ? " (cropped to 128×128)" : ""}`);
      setTimeout(() => setImportMsg(""), 4000);
    } catch (e) {
      setImportMsg(`import failed: ${e.message}`);
      setTimeout(() => setImportMsg(""), 4000);
    }
  }, [onChange]);

  return (
    <div className="sprite-editor">
      <div className="sprite-toolbar">
        {TOOLS.map((t) => (
          <button key={t} className={"tool " + (tool === t ? "sel" : "")} onClick={() => setTool(t)}>{t}</button>
        ))}
        <span className="tb-sep" />
        {importMsg && <span className="import-msg">{importMsg}</span>}
        <button className="tool import" onClick={importPng} title="import a PNG (nearest-color to the GameTank palette)">import PNG</button>
        <label className="zoom">zoom
          <input type="range" min="2" max="10" value={zoom} onChange={(e) => setZoom(+e.target.value)} />
          {zoom}x
        </label>
      </div>

      <div className="sprite-body">
        <div className="sprite-canvas-wrap">
          <canvas
            ref={canvasRef}
            className="sprite-canvas"
            width={SHEET_DIM}
            height={SHEET_DIM}
            style={{ width: SHEET_DIM * zoom, height: SHEET_DIM * zoom }}
            onMouseDown={onDown}
            onMouseMove={onMove}
          />
        </div>
        <PalettePicker value={color} onChange={setColor} />
      </div>
    </div>
  );
}
