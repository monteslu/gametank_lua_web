import React, { useEffect, useRef, useState, useCallback } from "react";
import { SHEET_DIM } from "./gtg.js";
import { byteToRgb, TRANSPARENT } from "./palette.js";
import { frameFromRect, clampFrame, parseGsi, encodeGsi } from "./gsi.js";
import { pickFile, downloadBytes } from "../util/download.js";

// Paint the sheet (same transparency checker as the sprite editor) into a canvas.
function paintSheet(ctx, sheet) {
  const img = ctx.createImageData(SHEET_DIM, SHEET_DIM);
  const d = img.data;
  for (let y = 0; y < SHEET_DIM; y++) {
    for (let x = 0; x < SHEET_DIM; x++) {
      const byte = sheet ? sheet[y * SHEET_DIM + x] : 0;
      const o = (y * SHEET_DIM + x) * 4;
      if (byte === TRANSPARENT) {
        const c = ((x >> 2) + (y >> 2)) & 1 ? 44 : 32;
        d[o] = c; d[o + 1] = c; d[o + 2] = c + 4; d[o + 3] = 255;
      } else {
        const [r, g, b] = byteToRgb(byte); d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Frame-table editor. Carve frames (rects) over the sheet, edit fields, drag the
 * anchor, reorder, and play-preview. `sheet` is the .gtg bytes (may be null);
 * `frames` is an array of {vxo,vyo,w,h,gx,gy}; onChange fires with a new array.
 */
export function FrameEditor({ sheet, frames, onChange }) {
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const [zoom, setZoom] = useState(3);
  const [sel, setSel] = useState(frames.length ? 0 : -1);
  const carving = useRef(null);   // { x0, y0 } during a drag-carve
  const [carveBox, setCarveBox] = useState(null);

  // playback preview
  const [playing, setPlaying] = useState(false);
  const [fps, setFps] = useState(8);
  const [previewFrame, setPreviewFrame] = useState(0);
  const rafRef = useRef(0);
  const acc = useRef(0);
  const lastT = useRef(0);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) paintSheet(ctx, sheet);
  }, [sheet]);

  useEffect(() => { if (sel >= frames.length) setSel(frames.length - 1); }, [frames.length, sel]);

  const pixelAt = useCallback((e) => {
    const rect = overlayRef.current.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(SHEET_DIM - 1, Math.floor((e.clientX - rect.left) / zoom))),
      y: Math.max(0, Math.min(SHEET_DIM - 1, Math.floor((e.clientY - rect.top) / zoom))),
    };
  }, [zoom]);

  // --- carve a new frame by dragging; a click (no drag) selects -----------
  // Carving always starts from the overlay background so you can carve a frame
  // that overlaps an existing one; the frame rects don't intercept the drag.
  // On mouseup: a real drag carves a new frame; a bare click selects the topmost
  // frame under the pointer (last-drawn wins).
  const frameAt = useCallback((x, y) => {
    for (let i = frames.length - 1; i >= 0; i--) {
      const f = frames[i];
      if (x >= f.gx && x < f.gx + f.w && y >= f.gy && y < f.gy + f.h) return i;
    }
    return -1;
  }, [frames]);

  const onDown = (e) => {
    if (e.button !== 0) return;
    const p = pixelAt(e);
    carving.current = { x0: p.x, y0: p.y, moved: false };
    setCarveBox({ x: p.x, y: p.y, w: 1, h: 1 });
  };
  const onMove = (e) => {
    if (!carving.current) return;
    const p = pixelAt(e);
    const { x0, y0 } = carving.current;
    if (p.x !== x0 || p.y !== y0) carving.current.moved = true;
    setCarveBox({ x: Math.min(x0, p.x), y: Math.min(y0, p.y), w: Math.abs(p.x - x0) + 1, h: Math.abs(p.y - y0) + 1 });
  };
  const onUp = () => {
    const c = carving.current;
    const b = carveBox;
    carving.current = null; setCarveBox(null);
    if (!c || !b) return;
    // a click (no meaningful drag) selects the frame under the pointer
    if (!c.moved || (b.w < 2 && b.h < 2)) {
      const hit = frameAt(c.x0, c.y0);
      if (hit >= 0) setSel(hit);
      return;
    }
    const f = frameFromRect(b.x, b.y, b.w, b.h);
    const next = [...frames, f];
    onChange(next);
    setSel(next.length - 1);
  };

  const updateFrame = (i, patch) => {
    const next = frames.map((f, j) => (j === i ? clampFrame({ ...f, ...patch }) : f));
    onChange(next);
  };
  const removeFrame = (i) => {
    const next = frames.filter((_, j) => j !== i);
    onChange(next);
    setSel(Math.min(i, next.length - 1));
  };
  const moveFrame = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= frames.length) return;
    const next = [...frames];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
    setSel(j);
  };

  // raw .gsi import/export - the exact frame-table file a C-SDK build consumes.
  const [msg, setMsg] = useState("");
  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(""), 4000); };
  const importGsi = useCallback(async () => {
    const picked = await pickFile(".gsi");
    if (!picked) return;
    try { const f = parseGsi(picked.bytes); onChange(f); setSel(f.length ? 0 : -1); flash(`imported ${f.length} frames`); }
    catch (e) { flash(`import failed: ${e.message}`); }
  }, [onChange]);
  const exportGsi = useCallback(() => downloadBytes("frames.gsi", encodeGsi(frames), "application/octet-stream"), [frames]);

  // --- playback ------------------------------------------------------------
  useEffect(() => {
    if (!playing || frames.length === 0) return;
    const tick = (t) => {
      if (!lastT.current) lastT.current = t;
      acc.current += (t - lastT.current) / 1000;
      lastT.current = t;
      const step = 1 / fps;
      while (acc.current >= step) { acc.current -= step; setPreviewFrame((p) => (p + 1) % frames.length); }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(rafRef.current); lastT.current = 0; acc.current = 0; };
  }, [playing, fps, frames.length]);

  const dim = SHEET_DIM * zoom;
  const cur = sel >= 0 && sel < frames.length ? frames[sel] : null;
  const preview = frames.length ? frames[Math.min(previewFrame, frames.length - 1)] : null;

  return (
    <div className="frame-editor">
      <div className="frame-toolbar">
        <span className="fe-hint">drag on the sheet to carve a frame</span>
        <span className="tb-sep" />
        {msg && <span className="import-msg">{msg}</span>}
        <button className="tool" onClick={importGsi} title="import a raw .gsi frame table (e.g. from a C project)">.gsi ▾</button>
        <button className="tool" onClick={exportGsi} title="export the frame table as a raw .gsi (for a C project)">.gsi ▴</button>
        <label className="zoom">zoom
          <input type="range" min="2" max="8" value={zoom} onChange={(e) => setZoom(+e.target.value)} />{zoom}x
        </label>
      </div>

      <div className="frame-body">
        {/* the sheet scrolls INSIDE this box when zoomed past the pane, so the
            frame list beside it stays put (only the canvas area moves). */}
        <div className="frame-canvas-scroll">
          {/* sheet + frame-rect overlay */}
          <div className="frame-canvas-wrap" style={{ width: dim, height: dim }}>
            <canvas ref={canvasRef} className="frame-canvas" width={SHEET_DIM} height={SHEET_DIM}
              style={{ width: dim, height: dim }} />
            <svg ref={overlayRef} className="frame-overlay" width={dim} height={dim}
              viewBox={`0 0 ${SHEET_DIM} ${SHEET_DIM}`}
              onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}>
              {frames.map((f, i) => (
                <g key={i} style={{ pointerEvents: "none" }}>
                  <rect x={f.gx} y={f.gy} width={f.w} height={f.h}
                    className={"frame-rect " + (i === sel ? "sel" : "")} />
                  <text x={f.gx + 1} y={f.gy + 6} className="frame-num">{i}</text>
                  {/* anchor marker: the sprite's origin = (gx - vxo, gy - vyo)... the
                      anchor within the frame is at (-vxo, -vyo) from the top-left */}
                  {i === sel && (
                    <circle cx={f.gx - f.vxo} cy={f.gy - f.vyo} r={1.6} className="frame-anchor" />
                  )}
                </g>
              ))}
              {carveBox && (
                <rect x={carveBox.x} y={carveBox.y} width={carveBox.w} height={carveBox.h} className="frame-rect carving" />
              )}
            </svg>
          </div>
        </div>

        {/* right column: frame list, fields, preview */}
        <div className="frame-side">
          <div className="frame-list-head">
            <span>frames ({frames.length})</span>
            <button className="fe-play" onClick={() => setPlaying((p) => !p)} disabled={!frames.length}>
              {playing ? "❚❚" : "▶"} preview
            </button>
          </div>

          {/* play preview canvas: the current frame scaled up */}
          <div className="frame-preview">
            {preview
              ? <FramePreview sheet={sheet} frame={preview} />
              : <div className="fe-empty">carve a frame to preview</div>}
            {frames.length > 0 && (
              <label className="fps">fps
                <input type="range" min="1" max="24" value={fps} onChange={(e) => setFps(+e.target.value)} />{fps}
              </label>
            )}
          </div>

          <ul className="frame-list">
            {frames.map((f, i) => (
              <li key={i} className={i === sel ? "sel" : ""} onClick={() => setSel(i)}>
                <span className="fl-num">{i}</span>
                <span className="fl-dims">{f.w}×{f.h} @ {f.gx},{f.gy}</span>
                <span className="fl-actions">
                  <button title="up" onClick={(e) => { e.stopPropagation(); moveFrame(i, -1); }}>↑</button>
                  <button title="down" onClick={(e) => { e.stopPropagation(); moveFrame(i, 1); }}>↓</button>
                  <button title="delete" onClick={(e) => { e.stopPropagation(); removeFrame(i); }}>×</button>
                </span>
              </li>
            ))}
            {frames.length === 0 && <li className="fe-empty">no frames yet</li>}
          </ul>

          {cur && (
            <div className="frame-fields">
              <div className="ff-title">frame {sel}</div>
              {["gx", "gy", "w", "h", "vxo", "vyo"].map((k) => (
                <label key={k} className="ff-row">
                  <span>{k}</span>
                  <input type="number" value={cur[k]}
                    onChange={(e) => updateFrame(sel, { [k]: +e.target.value })} />
                </label>
              ))}
              <button className="ff-center" onClick={() => updateFrame(sel, { vxo: -(cur.w >> 1), vyo: -(cur.h >> 1) })}>
                center anchor
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Renders a single frame (its sheet rect) scaled up, for the play preview.
function FramePreview({ sheet, frame }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current; if (!cv || !sheet) return;
    cv.width = frame.w; cv.height = frame.h;
    const ctx = cv.getContext("2d");
    const img = ctx.createImageData(frame.w, frame.h);
    const d = img.data;
    for (let y = 0; y < frame.h; y++) {
      for (let x = 0; x < frame.w; x++) {
        const sx = frame.gx + x, sy = frame.gy + y;
        const byte = (sx < SHEET_DIM && sy < SHEET_DIM) ? sheet[sy * SHEET_DIM + sx] : 0;
        const o = (y * frame.w + x) * 4;
        if (byte === TRANSPARENT) { d[o] = 0; d[o + 1] = 0; d[o + 2] = 0; d[o + 3] = 0; }
        else { const [r, g, b] = byteToRgb(byte); d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255; }
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [sheet, frame]);
  const scale = Math.max(1, Math.floor(64 / Math.max(frame.w, frame.h)));
  return (
    <canvas ref={ref} className="frame-preview-canvas"
      style={{ width: frame.w * scale, height: frame.h * scale, imageRendering: "pixelated" }} />
  );
}
