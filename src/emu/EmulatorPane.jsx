import React, { useEffect, useRef, useState } from "react";
import { GameTankHost, PAD } from "./gametank-host.js";
import { GT_INPUTS, pollGamepads, firstUnmapped } from "./gamepad.js";
import { GamepadMapper } from "./GamepadMapper.jsx";

// Keyboard -> RetroPad. Z/X/C are the GameTank A/B/C face buttons, but the core
// maps GameTank A/B/C from RetroPad B/Y/A (see GT_BTN), so Z/X/C send those.
const KEYMAP = {
  ArrowUp: PAD.UP, ArrowDown: PAD.DOWN, ArrowLeft: PAD.LEFT, ArrowRight: PAD.RIGHT,
  KeyZ: PAD.B, KeyX: PAD.Y, KeyC: PAD.A, Enter: PAD.START, ShiftRight: PAD.SELECT,
};

/**
 * Runs a built .gtr in the GameTank core, blitted to a canvas with integer
 * scaling. Reloads whenever `rom` changes (the play loop). rom is a Uint8Array
 * or null.
 */
export function EmulatorPane({ rom, onHost, building, buildMsg }) {
  const canvasRef = useRef(null);
  const hostRef = useRef(null);
  const [status, setStatus] = useState("idle");   // idle | loading | running | error
  const [error, setError] = useState("");
  const [paused, setPaused] = useState(false);     // loop stopped but cart still loaded

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
      setPaused(false);   // a fresh build always runs
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

  const [padConnected, setPadConnected] = useState(false);
  const [needsMap, setNeedsMap] = useState(null);   // an unmapped Gamepad, or null
  const [mapping, setMapping] = useState(null);     // the Gamepad being remapped
  const padPrev = useRef(new Set());
  useEffect(() => {
    if (status !== "running") return;
    let raf = 0;
    const key2pad = Object.fromEntries(GT_INPUTS.map((i) => [i.key, i.pad]));
    const tick = () => {
      const { pressed, active } = pollGamepads();
      setPadConnected(active.length > 0);
      // only touch pad ids the gamepad owns, so keyboard input still works
      for (const inp of GT_INPUTS) {
        const now = pressed.has(inp.key), was = padPrev.current.has(inp.key);
        if (now !== was) hostRef.current?.setPad(key2pad[inp.key], now);
      }
      padPrev.current = pressed;
      // a connected pad with no usable binds: prompt once (don't nag mid-map)
      if (!mapping) setNeedsMap(firstUnmapped());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); padPrev.current = new Set(); };
  }, [status, mapping]);

  // open the mapper on the connected pad (the unmapped one, or the first pad)
  const openMapper = () => {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = needsMap || [...pads].find(Boolean);
    if (gp) setMapping(gp);
  };

  const goFullscreen = () => {
    const el = screenRef.current;
    if (!el) return;
    // fullscreen also SELECTS the emulator (grabs input) + unmutes audio
    el.focus();
    hostRef.current?.unlockAudio();
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (document.fullscreenElement) { (document.exitFullscreen || document.webkitExitFullscreen)?.call(document); }
    else if (req) req.call(el);
  };

  // stop = freeze the loop (pause); resume = un-freeze. Toggled by one button.
  const togglePause = () => {
    const host = hostRef.current;
    if (!host) return;
    if (host.isPaused()) { host.resume(); setPaused(false); }
    else { host.pause(); setPaused(true); }
  };

  // restart = re-run the cart from its reset vector. If paused, un-freeze first
  // so the restart is actually visible/running.
  const restart = () => {
    const host = hostRef.current;
    if (!host) return;
    if (host.isPaused()) { host.resume(); setPaused(false); }
    host.reset();
  };

  return (
    <div className="emu">
      <div className="pane-title emu-titlebar">
        <span>emulator</span>
        <button className="emu-fs tip" onClick={goFullscreen} data-tip="Fullscreen (grabs the controls)" aria-label="fullscreen">⛶</button>
      </div>
      <div
        className={"emu-screen" + (focused ? " focused" : "")}
        ref={screenRef}
        tabIndex={0}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onMouseDown={() => { screenRef.current?.focus(); hostRef.current?.unlockAudio(); }}
      >
        {/* canvas is native 128x128; CSS scales it up with pixelated rendering */}
        <canvas ref={canvasRef} className="emu-canvas" width={128} height={128} />
        {/* building overlay sits on TOP of a still-running previous game, so a
            slow (10-15s) banked build doesn't look like the old game is stuck. */}
        {building && (
          <div className="emu-overlay building">
            <span className="emu-spinner" aria-hidden="true" />
            <span>building…</span>
            {buildMsg && buildMsg !== "building..." && <span className="emu-buildmsg">{buildMsg}</span>}
          </div>
        )}
        {!building && status !== "running" && (
          <div className={"emu-overlay " + status}>
            {status === "idle" && "press Play to build & run"}
            {status === "loading" && "loading core..."}
            {status === "error" && <span className="err">emulator error: {error}</span>}
          </div>
        )}
        {!building && status === "running" && !focused && (
          <div className="emu-clickhint">click to play</div>
        )}
      </div>
      <div className="emu-controls">
        <button
          className="emu-btn tip"
          onClick={togglePause}
          disabled={status !== "running"}
          data-tip={paused ? "Resume" : "Stop (freeze)"}
          aria-label={paused ? "resume" : "stop"}
        ><i className={"ti " + (paused ? "ti-player-play" : "ti-player-stop")} /></button>
        <button
          className="emu-btn tip"
          onClick={restart}
          disabled={status !== "running"}
          data-tip="Restart (reset the cart)"
          aria-label="restart"
        ><i className="ti ti-refresh" /></button>
        <button
          className={"emu-btn tip" + (needsMap ? " attn" : "")}
          onClick={openMapper}
          disabled={status !== "running" || !padConnected}
          data-tip={needsMap ? "This controller needs mapping - click to set it up" : "Remap this controller"}
          aria-label="map controller"
        ><i className="ti ti-device-gamepad-2" /></button>
        <span className="emu-hint">
          {status === "running" && paused ? "stopped · press ▶ to resume"
            : needsMap ? "controller connected · click the gamepad icon to map it"
            : padConnected ? "controller ready · arrows/Z/X/C also work"
            : focused ? "arrows move · Z/X/C = A/B/C · Enter = start"
            : "click the screen to use the controls"}
        </span>
      </div>
      {mapping && (
        <GamepadMapper
          gamepad={mapping}
          onDone={() => { setMapping(null); setNeedsMap(null); }}
          onClose={() => setMapping(null)}
        />
      )}
    </div>
  );
}
