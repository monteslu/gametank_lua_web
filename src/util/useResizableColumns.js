// useResizableColumns - persisted, draggable widths for the IDE's three-column
// shell (sidebar | editor | emulator). The editor is the flexible middle that
// absorbs slack; the user drags the two boundaries and the widths persist.
//
// Stored as PERCENTAGES of the window width (so the layout scales with the
// window), but the EMULATOR column is CLAMPED to a px range so it never balloons
// past what its 256 canvas needs on a wide monitor, nor crushes below it. The
// sidebar is clamped to a comfortable px range too.
import { useState, useCallback, useRef, useEffect } from "react";

const KEY = "gtlua-ide-cols";
// px clamps (min, max) - applied AFTER converting the stored % back to px.
export const SIDEBAR_PX = { min: 140, max: 340 };
export const EMU_PX = { min: 280, max: 480 };   // 256 canvas + chrome .. comfortable
// defaults as % of a ~1440 reference; the px clamp keeps them sane elsewhere.
const DEFAULT = { sidebarPct: 180 / 1440, emuPct: 320 / 1440 };

function load() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null");
    if (v && typeof v.sidebarPct === "number" && typeof v.emuPct === "number") return v;
  } catch { /* ignore */ }
  return DEFAULT;
}
function save(v) {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode */ }
}
const clamp = (px, { min, max }) => Math.max(min, Math.min(max, px));

/**
 * @returns {{
 *   sidebarPx: number, emuPx: number,
 *   startSidebarDrag: (e:PointerEvent)=>void,
 *   startEmuDrag: (e:PointerEvent)=>void,
 * }}
 */
export function useResizableColumns() {
  const [pct, setPct] = useState(load);
  // convert stored % -> clamped px against the live window width
  const winW = useWindowWidth();
  const sidebarPx = clamp(pct.sidebarPct * winW, SIDEBAR_PX);
  const emuPx = clamp(pct.emuPct * winW, EMU_PX);

  const drag = useRef(null);   // { which, startX, startPx }

  const onMove = useCallback((e) => {
    const d = drag.current;
    if (!d) return;
    const w = window.innerWidth || 1440;
    if (d.which === "sidebar") {
      const px = clamp(d.startPx + (e.clientX - d.startX), SIDEBAR_PX);
      setPct((p) => ({ ...p, sidebarPct: px / w }));
    } else {
      // emulator handle is on the LEFT edge of the emu column, so dragging RIGHT
      // shrinks it: px = startPx - deltaX.
      const px = clamp(d.startPx - (e.clientX - d.startX), EMU_PX);
      setPct((p) => ({ ...p, emuPct: px / w }));
    }
  }, []);

  const onUp = useCallback(() => {
    if (!drag.current) return;
    drag.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    setPct((p) => { save(p); return p; });   // persist final
  }, [onMove]);

  // current clamped px kept in a ref so the drag reads the LIVE value at
  // pointerdown (no stale closure across renders).
  const px = useRef({ sidebar: sidebarPx, emu: emuPx });
  px.current = { sidebar: sidebarPx, emu: emuPx };

  const start = useCallback((which) => (e) => {
    e.preventDefault();
    drag.current = { which, startX: e.clientX, startPx: px.current[which] };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [onMove, onUp]);

  useEffect(() => () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  }, [onMove, onUp]);

  return {
    sidebarPx, emuPx,
    startSidebarDrag: start("sidebar"),
    startEmuDrag: start("emu"),
  };
}

// tiny window-width tracker (debounced via rAF is overkill here)
function useWindowWidth() {
  const [w, setW] = useState(() => (typeof window !== "undefined" ? window.innerWidth : 1440));
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return w;
}
