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
export function EmulatorPane({ rom }) {
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
    }).catch((e) => {
      if (cancelled) return;
      setError(String(e?.message ?? e));
      setStatus("error");
    });

    return () => {
      cancelled = true;
      if (hostRef.current) { hostRef.current.dispose(); hostRef.current = null; }
    };
  }, [rom]);

  // keyboard input while the pane is focused/hovered
  useEffect(() => {
    const down = (e) => {
      const id = KEYMAP[e.code];
      if (id === undefined) return;
      e.preventDefault();
      hostRef.current?.setPad(id, true);
    };
    const up = (e) => {
      const id = KEYMAP[e.code];
      if (id === undefined) return;
      hostRef.current?.setPad(id, false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  return (
    <div className="emu">
      <div className="emu-screen">
        {/* canvas is native 128x128; CSS scales it up with pixelated rendering */}
        <canvas ref={canvasRef} className="emu-canvas" width={128} height={128} />
        {status !== "running" && (
          <div className={"emu-overlay " + status}>
            {status === "idle" && "press Play to build & run"}
            {status === "loading" && "loading core..."}
            {status === "error" && <span className="err">emulator error: {error}</span>}
          </div>
        )}
      </div>
      <div className="emu-controls">
        <button onClick={() => hostRef.current?.reset()} disabled={status !== "running"}>reset</button>
        <span className="emu-hint">arrows move · Z/X/C = A/B/C · Enter = start</span>
      </div>
    </div>
  );
}
