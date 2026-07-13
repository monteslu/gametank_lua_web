import React, { useEffect, useRef, useState, useCallback } from "react";
import { SHEET_DIM, QUAD_DIM, SHEET_BYTES, getPixel, setPixel, fromGtg, quadrantOf, setQuadrant, newSheet } from "./gtg.js";
import { byteToRgb, TRANSPARENT } from "./palette.js";
import { PalettePicker } from "./PalettePicker.jsx";
import { pngToSheet, rgbaToSheet } from "./png-import.js";
import { aseToRgba, aseToSheetAndFrames, parseAseprite } from "./aseprite-import.js";
import { pickFile, downloadBytes } from "../util/download.js";

// drawing tools: id -> Tabler icon class + tooltip. "dropper" (eyedropper) picks
// the color under the cursor instead of painting.
const TOOLS = [
  { id: "pencil", icon: "ti-pencil", tip: "Pencil" },
  { id: "eraser", icon: "ti-eraser", tip: "Eraser (paint transparent)" },
  { id: "fill", icon: "ti-bucket", tip: "Fill (flood the same-color region)" },
  { id: "line", icon: "ti-line", tip: "Line" },
  { id: "rect", icon: "ti-rectangle", tip: "Rectangle (outline)" },
  { id: "dropper", icon: "ti-color-picker", tip: "Eyedropper (pick a color from the sheet)" },
  { id: "select", icon: "ti-marquee-2", tip: "Select (drag a box; Ctrl+C copy, Ctrl+X cut, Ctrl+V paste, Del clears)" },
];

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

// Draw the guide overlay onto a transparent canvas the same pixel size as the
// zoomed sheet: the 8x8 cell grid across the whole 256x256 page (everything -
// spr cells, .gsi frames, composed tiles - is 8px-aligned), plus brighter
// borders on the four 128x128 quadrants. Only NW is spr(n)-addressable; the
// hover readout makes that distinction.
function drawGuides(ctx, zoom, showCells) {
  const px = SHEET_DIM * zoom;
  ctx.clearRect(0, 0, px, px);
  if (showCells) {
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 8; i < SHEET_DIM; i += 8) {
      const p = i * zoom + 0.5;
      ctx.moveTo(p, 0); ctx.lineTo(p, px);
      ctx.moveTo(0, p); ctx.lineTo(px, p);
    }
    ctx.stroke();
  }
  // quadrant borders (the 128px midlines) - brighter
  const mid = QUAD_DIM * zoom + 0.5;
  ctx.strokeStyle = "rgba(120,200,255,0.55)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(mid, 0); ctx.lineTo(mid, px);
  ctx.moveTo(0, mid); ctx.lineTo(px, mid);
  ctx.stroke();
}

// spr() cell index (0-255) for a pixel in the NW quadrant, or null elsewhere.
function cellAt(x, y) {
  if (x >= QUAD_DIM || y >= QUAD_DIM) return null;
  return (y >> 3) * 16 + (x >> 3);
}
const QUAD_NAME = ["NW (spr grid)", "NE", "SW", "SE"];
const QUAD_FILE = ["gfx.gtg", "gfx_1.gtg", "gfx_2.gtg", "gfx_3.gtg"];

/**
 * Quadrant picker for .gtg import/export: the four 128x128 quadrants of the
 * sheet, drawn live, each a button. Import = "which quadrant does the file
 * land in"; export = "which quadrant becomes the file".
 */
function QuadPickModal({ mode, sheet, onPick, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const drawQuad = (canvas, q) => {
    if (!canvas || !sheet) return;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(QUAD_DIM, QUAD_DIM);
    const ox = (q & 1) * QUAD_DIM, oy = (q >> 1) * QUAD_DIM;
    for (let y = 0; y < QUAD_DIM; y++) {
      for (let x = 0; x < QUAD_DIM; x++) {
        const byte = sheet[(oy + y) * SHEET_DIM + ox + x];
        const o = (y * QUAD_DIM + x) * 4;
        if (byte === TRANSPARENT) {
          const c = ((x >> 2) + (y >> 2)) & 1 ? 44 : 32;
          img.data[o] = c; img.data[o + 1] = c; img.data[o + 2] = c + 4; img.data[o + 3] = 255;
        } else {
          const [r, g, b] = byteToRgb(byte);
          img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  };
  return (
    <div className="flash-modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="quadpick-box">
        <div className="newproj-head">
          <span className="newproj-title">{mode === "import" ? "Import .gtg" : "Export .gtg"}</span>
          <span className="newproj-sub">
            {mode === "import" ? "pick the quadrant the file lands in" : "pick the quadrant to save as a file"}
          </span>
          <button className="newproj-close" onClick={onClose} aria-label="close">×</button>
        </div>
        <div className="quadpick-grid">
          {QUAD_NAME.map((n, q) => (
            <button className="quadpick-card" key={q} onClick={() => onPick(q)}>
              <canvas width={QUAD_DIM} height={QUAD_DIM} ref={(c) => drawQuad(c, q)} />
              <span className="quadpick-name">{QUAD_FILE[q]}</span>
              <span className="quadpick-pos">{n}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
function quadAt(x, y) {
  return (x >= QUAD_DIM ? 1 : 0) + (y >= QUAD_DIM ? 2 : 0);
}

/**
 * A 256x256 sprite-sheet editor (the full GameTank GRAM page = four 128x128
 * quadrants). `sheet` is a Uint8Array(65536) of raw color bytes; onChange fires
 * with a NEW array after each edit (immutable so React and autosave see the
 * change). spr(n) cells 0-255 index the NW quadrant; the other quadrants are for
 * .gsi frame tables (sprf) and gt.bg_* canvas work. Tools: pencil, eraser, fill,
 * line, rect.
 */
export function SpriteEditor({ sheet, onChange, onImportAnimation }) {
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const [zoom, setZoom] = useState(3);
  const [tool, setTool] = useState("pencil");
  const [color, setColor] = useState(8);         // a visible default (P8 red byte)
  const [showGrid, setShowGrid] = useState(true);
  const [hover, setHover] = useState(null);      // { x, y, cell, quad } cursor readout
  const drawing = useRef(null);                  // { startX, startY, base } during a drag

  // selection + clipboard: sel is the marquee (normalized inclusive bounds),
  // clip is the copied pixels, pasting is the floating-ghost anchor while a
  // paste rides the cursor (click stamps it, Escape cancels)
  const [sel, setSel] = useState(null);          // { x0, y0, x1, y1 }
  const [clip, setClip] = useState(null);        // { w, h, data: Uint8Array }
  const [pasting, setPasting] = useState(null);  // { x, y } ghost top-left
  const clipCanvas = useRef(null);               // pre-rendered clip for the ghost

  // undo/redo: snapshot the sheet BEFORE each stroke/action so undo steps by
  // whole edits (not per-pixel). Bounded stacks of Uint8Array snapshots.
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const [histLen, setHistLen] = useState({ u: 0, r: 0 });
  const UNDO_MAX = 40;
  const snapshot = useCallback(() => {
    undoStack.current.push(new Uint8Array(sheet));
    if (undoStack.current.length > UNDO_MAX) undoStack.current.shift();
    redoStack.current.length = 0;   // a new edit invalidates the redo trail
    setHistLen({ u: undoStack.current.length, r: 0 });
  }, [sheet]);
  const undo = useCallback(() => {
    if (!undoStack.current.length) return;
    redoStack.current.push(new Uint8Array(sheet));
    const prev = undoStack.current.pop();
    onChange(prev);
    setHistLen({ u: undoStack.current.length, r: redoStack.current.length });
  }, [sheet, onChange]);
  const redo = useCallback(() => {
    if (!redoStack.current.length) return;
    undoStack.current.push(new Uint8Array(sheet));
    const next = redoStack.current.pop();
    onChange(next);
    setHistLen({ u: undoStack.current.length, r: redoStack.current.length });
  }, [sheet, onChange]);

  // repaint the sheet whenever it changes
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) drawSheet(ctx, sheet);
  }, [sheet]);

  // repaint the guide overlay when zoom / grid toggle / selection / ghost change
  useEffect(() => {
    const ctx = overlayRef.current?.getContext("2d");
    if (!ctx) return;
    drawGuides(ctx, zoom, showGrid);
    if (pasting && clipCanvas.current) {
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = 0.7;
      ctx.drawImage(clipCanvas.current, pasting.x * zoom, pasting.y * zoom,
        clipCanvas.current.width * zoom, clipCanvas.current.height * zoom);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "rgba(120,255,160,0.9)";
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(pasting.x * zoom + 0.5, pasting.y * zoom + 0.5,
        clipCanvas.current.width * zoom, clipCanvas.current.height * zoom);
      ctx.restore();
    } else if (sel) {
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(sel.x0 * zoom + 0.5, sel.y0 * zoom + 0.5,
        (sel.x1 - sel.x0 + 1) * zoom, (sel.y1 - sel.y0 + 1) * zoom);
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.lineDashOffset = 4;
      ctx.strokeRect(sel.x0 * zoom + 0.5, sel.y0 * zoom + 0.5,
        (sel.x1 - sel.x0 + 1) * zoom, (sel.y1 - sel.y0 + 1) * zoom);
      ctx.restore();
    }
  }, [zoom, showGrid, sel, pasting]);

  const pixelAt = useCallback((e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / zoom);
    const y = Math.floor((e.clientY - rect.top) / zoom);
    if (x < 0 || y < 0 || x >= SHEET_DIM || y >= SHEET_DIM) return null;
    return { x, y };
  }, [zoom]);

  // flood fill from (x,y) over the contiguous region of the same byte.
  // With a selection active, the marquee is the fill's fence: nothing outside
  // it is read or painted.
  const floodFill = (buf, x, y, target, replace, bounds) => {
    if (target === replace) return;
    const b = bounds ?? { x0: 0, y0: 0, x1: SHEET_DIM - 1, y1: SHEET_DIM - 1 };
    const stack = [[x, y]];
    while (stack.length) {
      const [cx, cy] = stack.pop();
      if (cx < b.x0 || cy < b.y0 || cx > b.x1 || cy > b.y1) continue;
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

  const normSel = (a, b) => ({
    x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y),
    x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y),
  });
  const copySel = useCallback(() => {
    if (!sel) return;
    const w = sel.x1 - sel.x0 + 1, h = sel.y1 - sel.y0 + 1;
    const data = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        data[y * w + x] = getPixel(sheet, sel.x0 + x, sel.y0 + y);
    setClip({ w, h, data });
    // pre-render the ghost once (transparent bytes -> alpha 0) so the paste
    // preview is one scaled drawImage per move, not a fillRect per pixel
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const o = i * 4;
      if (data[i] === TRANSPARENT) { img.data[o + 3] = 0; continue; }
      const [r, g, b] = byteToRgb(data[i]);
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    clipCanvas.current = c;
  }, [sel, sheet]);
  const clearSel = useCallback(() => {
    if (!sel) return;
    snapshot();
    const buf = new Uint8Array(sheet);
    for (let y = sel.y0; y <= sel.y1; y++)
      for (let x = sel.x0; x <= sel.x1; x++)
        setPixel(buf, x, y, TRANSPARENT);
    commit(buf);
  }, [sel, sheet, snapshot]);
  const cutSel = useCallback(() => { copySel(); clearSel(); }, [copySel, clearSel]);
  const pasteBegin = useCallback(() => {
    if (!clip) return;
    setTool("select");
    setSel(null);
    // anchor the ghost centered on the last hover (or the sheet center)
    const cx = (hover?.x ?? SHEET_DIM / 2) - (clip.w >> 1);
    const cy = (hover?.y ?? SHEET_DIM / 2) - (clip.h >> 1);
    setPasting({ x: cx, y: cy });
  }, [clip, hover]);
  const stampPaste = useCallback((at) => {
    if (!clip || !at) return;
    snapshot();
    const buf = new Uint8Array(sheet);
    for (let y = 0; y < clip.h; y++) {
      const sy = at.y + y;
      if (sy < 0 || sy >= SHEET_DIM) continue;
      for (let x = 0; x < clip.w; x++) {
        const sx = at.x + x;
        if (sx < 0 || sx >= SHEET_DIM) continue;
        const byte = clip.data[y * clip.w + x];
        if (byte !== TRANSPARENT) setPixel(buf, sx, sy, byte);   // paste keeps holes
      }
    }
    commit(buf);
    setPasting(null);
  }, [clip, sheet, snapshot]);

  const onDown = (e) => {
    const p = pixelAt(e);
    if (!p) return;
    e.preventDefault();
    // eyedropper: pick the color under the cursor, don't paint (no undo entry)
    if (tool === "dropper") {
      setColor(getPixel(sheet, p.x, p.y));
      return;
    }
    // floating paste: click stamps the clip where the ghost sits
    if (pasting) {
      stampPaste(pasting);
      return;
    }
    if (tool === "select") {
      drawing.current = { tool: "select", start: p };
      setSel({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      return;
    }
    snapshot();   // remember the pre-edit sheet for undo (one entry per stroke)
    const buf = new Uint8Array(sheet);
    const paint = tool === "eraser" ? TRANSPARENT : color;
    if (tool === "pencil" || tool === "eraser") {
      setPixel(buf, p.x, p.y, paint);
      drawing.current = { tool, paint, last: p, buf };
      commit(buf);
    } else if (tool === "fill") {
      floodFill(buf, p.x, p.y, getPixel(buf, p.x, p.y), paint, sel ?? undefined);
      commit(buf);
    } else if (tool === "line" || tool === "rect") {
      // preview drag: keep the pristine base, redraw shape each move
      drawing.current = { tool, paint, start: p, base: new Uint8Array(sheet) };
    }
  };

  const onMove = (e) => {
    const p = pixelAt(e);
    if (p) setHover({ x: p.x, y: p.y, cell: cellAt(p.x, p.y), quad: quadAt(p.x, p.y) });
    if (pasting && p && clip) {
      setPasting({ x: p.x - (clip.w >> 1), y: p.y - (clip.h >> 1) });
      return;
    }
    const d = drawing.current;
    if (!d) return;
    if (!p) return;
    if (d.tool === "select") {
      setSel(normSel(d.start, p));
      return;
    }
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

  // Ctrl/Cmd+Z = undo, Ctrl+Shift+Z / Ctrl+Y = redo - but only when the sprite
  // editor is the active area (not while typing in the code editor, etc.).
  const rootRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if (!rootRef.current || !rootRef.current.contains(document.activeElement) && !rootRef.current.matches(":hover")) return;
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) {
        if (e.key === "Escape") { setPasting(null); setSel(null); return; }
        if ((e.key === "Delete" || e.key === "Backspace") && sel) { e.preventDefault(); clearSel(); return; }
        return;
      }
      if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); redo(); }
      else if (k === "c" && sel) { e.preventDefault(); copySel(); }
      else if (k === "x" && sel) { e.preventDefault(); cutSel(); }
      else if (k === "v" && clip) { e.preventDefault(); pasteBegin(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, sel, clip, copySel, cutSel, pasteBegin, clearSel]);

  const [importMsg, setImportMsg] = useState("");
  const flash = (m) => { setImportMsg(m); setTimeout(() => setImportMsg(""), 4000); };
  const importImage = useCallback(async () => {
    const picked = await pickFile(".png,.ase,.aseprite,image/png");
    if (!picked) return;
    try {
      const isAse = /\.(ase|aseprite)$/i.test(picked.name) || (picked.bytes[4] === 0xe0 && picked.bytes[5] === 0xa5);
      if (isAse) {
        const ase = await parseAseprite(picked.bytes);
        // multi-frame .ase + animation support -> pack all frames into the sheet
        // and generate a .gsi frame table so it's ready to animate with sprf.
        if (ase.frames.length > 1 && onImportAnimation) {
          const anim = await aseToSheetAndFrames(picked.bytes);
          const { sheet: packed } = rgbaToSheet(anim.rgba);
          onImportAnimation(packed, anim.frames);
          flash(`imported ${anim.nFrames} frames as an animation${anim.dropped ? ` (${anim.dropped} didn't fit)` : ""}`);
          return;
        }
        const result = rgbaToSheet(await aseToRgba(picked.bytes));
        snapshot();
        onChange(result.sheet);
        flash(`imported ${result.width}×${result.height}${result.cropped ? " (cropped to 256×256)" : ""}`);
        return;
      }
      const result = await pngToSheet(picked.bytes);
      snapshot();
      onChange(result.sheet);
      flash(`imported ${result.width}×${result.height}${result.cropped ? " (cropped to 256×256)" : ""}`);
    } catch (e) { flash(`import failed: ${e.message}`); }
  }, [onChange, onImportAnimation, snapshot]);

  // raw .gtg import/export - the exact 128x128 quadrant file a C-SDK build
  // consumes (gfx.gtg / gfx_1 / _2 / _3), so assets round-trip between our editor
  // and a C GameTank project. A .gtg is ONE quadrant; clicking import/export
  // opens a picker modal showing all four quadrants live - choose one there.
  const [quadModal, setQuadModal] = useState(null);   // "import" | "export" | null
  const importGtg = useCallback(async (quad) => {
    setQuadModal(null);
    const picked = await pickFile(".gtg");
    if (!picked) return;
    try {
      // a 65536-byte file is a full 256x256 sheet (all four quadrants in one
      // blob) - import the whole thing; the quadrant choice only applies to a
      // real single-quadrant .gtg
      if (picked.bytes.length === SHEET_BYTES) {
        snapshot();
        onChange(new Uint8Array(picked.bytes));
        flash("that file is a full 256×256 sheet - imported all four quadrants");
        return;
      }
      const q = fromGtg(picked.bytes);           // validates 16384 bytes
      const buf = sheet ? new Uint8Array(sheet) : newSheet();
      setQuadrant(buf, quad, q);
      snapshot();
      onChange(buf);
      flash(`imported .gtg into ${QUAD_NAME[quad].split(" ")[0]}`);
    } catch (e) { flash(`import failed: ${e.message}`); }
  }, [onChange, sheet, snapshot]);
  const exportGtg = useCallback((quad) => {
    setQuadModal(null);
    downloadBytes(QUAD_FILE[quad], quadrantOf(sheet, quad), "application/octet-stream");
  }, [sheet]);

  return (
    <div className="sprite-editor" ref={rootRef}>
      <div className="sprite-toolbar">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={"tool icon tip " + (tool === t.id ? "sel" : "")}
            onClick={() => setTool(t.id)}
            data-tip={t.tip}
            aria-label={t.tip}
          ><i className={"ti " + t.icon} /></button>
        ))}
        <span className="tb-gap" />
        <button
          className="tool icon tip"
          onClick={undo}
          disabled={histLen.u === 0}
          data-tip="Undo (Ctrl+Z)"
          aria-label="undo"
        ><i className="ti ti-arrow-back-up" /></button>
        <span className="tb-gap" />
        <button className="tool icon tip" onClick={copySel} disabled={!sel}
          data-tip="Copy selection (Ctrl+C)" aria-label="copy"><i className="ti ti-copy" /></button>
        <button className="tool icon tip" onClick={cutSel} disabled={!sel}
          data-tip="Cut selection (Ctrl+X)" aria-label="cut"><i className="ti ti-scissors" /></button>
        <button className="tool icon tip" onClick={pasteBegin} disabled={!clip}
          data-tip="Paste (Ctrl+V) - the copy rides the cursor; click to stamp, Esc cancels" aria-label="paste"><i className="ti ti-clipboard" /></button>
        <span className="tb-sep" />
        {importMsg && <span className="import-msg">{importMsg}</span>}
        <button className="tool icon import tip" onClick={importImage} data-tip="Import a PNG or Aseprite file" aria-label="import image"><i className="ti ti-photo" /></button>
        <button className="tool icon tip" onClick={() => setQuadModal("import")} data-tip="Import a .gtg quadrant file (picks the target quadrant next)" aria-label="import .gtg"><i className="ti ti-file-import" /></button>
        <button className="tool icon tip" onClick={() => setQuadModal("export")} data-tip="Export a quadrant as a .gtg file (picks the quadrant next)" aria-label="export .gtg"><i className="ti ti-file-export" /></button>
        <label className="grid-toggle" title="show the 8x8 cell grid + quadrant borders">
          <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} /> grid
        </label>
        <label className="zoom">zoom
          <input type="range" min="1" max="12" value={zoom} onChange={(e) => setZoom(+e.target.value)} />
          {zoom}x
        </label>
      </div>

      {quadModal && (
        <QuadPickModal
          mode={quadModal}
          sheet={sheet}
          onPick={(q) => (quadModal === "import" ? importGtg(q) : exportGtg(q))}
          onClose={() => setQuadModal(null)}
        />
      )}

      <div className="sprite-body">
        <div className="sprite-canvas-wrap">
          <div className="sprite-canvas-stack" style={{ width: SHEET_DIM * zoom, height: SHEET_DIM * zoom }}>
            <canvas
              ref={canvasRef}
              className="sprite-canvas"
              width={SHEET_DIM}
              height={SHEET_DIM}
              style={{ width: SHEET_DIM * zoom, height: SHEET_DIM * zoom }}
              onMouseDown={onDown}
              onMouseMove={onMove}
              onMouseLeave={() => setHover(null)}
            />
            <canvas
              ref={overlayRef}
              className="sprite-overlay"
              width={SHEET_DIM * zoom}
              height={SHEET_DIM * zoom}
              style={{ width: SHEET_DIM * zoom, height: SHEET_DIM * zoom }}
            />
          </div>
          <div className="sprite-readout">
            {hover
              ? <span>x {hover.x} y {hover.y} · {QUAD_NAME[hover.quad]}{hover.cell != null ? ` · spr(${hover.cell})` : ""}</span>
              : <span className="dim">256×256 page · NW = spr() cells 0-255 · other quadrants via .gsi frames</span>}
          </div>
        </div>
        <PalettePicker value={color} onChange={setColor} />
      </div>
    </div>
  );
}
