import React, { useEffect, useRef, useState } from "react";
import { GameTankHost, PAD } from "./gametank-host.js";

// Keyboard -> RetroPad, matching gtlua-run.mjs (arrows move; Z/X/C = the three
// face buttons A/B/C; Enter = start; RShift = select).
const KEYMAP = {
  ArrowUp: PAD.UP, ArrowDown: PAD.DOWN, ArrowLeft: PAD.LEFT, ArrowRight: PAD.RIGHT,
  KeyZ: PAD.A, KeyX: PAD.B, KeyC: PAD.Y, Enter: PAD.START, ShiftRight: PAD.SELECT,
};

/**
 * Runs a built .gtr in the GameTank core, blitted to a canvas with integer
 * scaling. Reloads whenever `rom` changes (the play loop). rom is a Uint8Array
 * or null.
 */
export function EmulatorPane({ rom, onHost }) {
  const canvasRef = useRef(null);
  const hostRef = useRef(null);
  const [status, setStatus] = useState("idle");   // idle | loading | running | error
  const [error, setError] = useState("");

  useEffect(() => {
    if (!rom) return;
    let cancelled = false;
    setStatus("loading"); setError("");

    // tear down any previous instance before loading the next cart
    if (hostRef.current) { hostRef.current.dispose(); hostRef.current = null; }

    const host = new GameTankHost();
    host.load(rom).then(() => {
      if (cancelled) { host.dispose(); return; }
      hostRef.current = host;
      host.start(canvasRef.current);
      setStatus("running");
      onHost?.(host);
    }).catch((e) => {
      if (cancelled) return;
      setError(String(e?.message ?? e));
      setStatus("error");
    });

    return () => {
      cancelled = true;
      if (hostRef.current) { hostRef.current.dispose(); hostRef.current = null; }
      onHost?.(null);
    };
  }, [rom]);

  // Gamepad keyboard input, but ONLY when the emulator area actually holds focus
  // - otherwise a global listener would preventDefault() arrows/Enter/Z/X/C and
  // break the code editor (Enter = no newline, etc.). The screen is focusable
  // (tabIndex) and you click it to "grab" the controls; a small hint says so.
  const [focused, setFocused] = useState(false);
  const screenRef = useRef(null);
  useEffect(() => {
    const active = () => screenRef.current && screenRef.current.contains(document.activeElement);
    const down = (e) => {
      if (!active()) return;
      const id = KEYMAP[e.code];
      if (id === undefined) return;
      e.preventDefault();
      hostRef.current?.setPad(id, true);
    };
    const up = (e) => {
      if (!active()) return;
      const id = KEYMAP[e.code];
      if (id === undefined) return;
      hostRef.current?.setPad(id, false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  const goFullscreen = () => {
    const el = screenRef.current;
    if (!el) return;
    // fullscreen also SELECTS the emulator (grabs input) if it wasn't already
    el.focus();
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (document.fullscreenElement) { (document.exitFullscreen || document.webkitExitFullscreen)?.call(document); }
    else if (req) req.call(el);
  };

  return (
    <div className="emu">
      <div className="pane-title emu-titlebar">
        <span>emulator</span>
        <button className="emu-fs" onClick={goFullscreen} title="fullscreen (also grabs the controls)" aria-label="fullscreen">⛶</button>
      </div>
      <div
        className={"emu-screen" + (focused ? " focused" : "")}
        ref={screenRef}
        tabIndex={0}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onMouseDown={() => screenRef.current?.focus()}
      >
        {/* canvas is native 128x128; CSS scales it up with pixelated rendering */}
        <canvas ref={canvasRef} className="emu-canvas" width={128} height={128} />
        {status !== "running" && (
          <div className={"emu-overlay " + status}>
            {status === "idle" && "press Play to build & run"}
            {status === "loading" && "loading core..."}
            {status === "error" && <span className="err">emulator error: {error}</span>}
          </div>
        )}
        {status === "running" && !focused && (
          <div className="emu-clickhint">click to play</div>
        )}
      </div>
      <div className="emu-controls">
        <button onClick={() => hostRef.current?.reset()} disabled={status !== "running"}>reset</button>
        <span className="emu-hint">
          {focused ? "arrows move · Z/X/C = A/B/C · Enter = start" : "click the screen to use the controls"}
        </span>
      </div>
    </div>
  );
}
