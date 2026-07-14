import React, { useEffect, useRef, useState } from "react";
import { GT_INPUTS, saveMapping } from "./gamepad.js";

// Walk the 8 GameTank inputs one at a time: prompt, wait for the stick/pad to
// settle, then capture the first button or axis that moves. Same flow as
// wasmcart's mapper, sized to the GameTank pad. Detection thresholds match
// gamepad.js so what you bind is what fires in-game.
const BUTTON_ON = 0.5;
const AXIS_ON = 0.5;
const SETTLE = 0.35;

function snapshot(gp) {
  return { buttons: Array.from(gp.buttons, (b) => b.value), axes: Array.from(gp.axes) };
}

/**
 * @param {Gamepad} gamepad  the pad being mapped (from navigator.getGamepads)
 * @param {(binds)=>void} onDone  called with the finished binds (also saved)
 * @param {()=>void} onClose
 */
export function GamepadMapper({ gamepad, onDone, onClose }) {
  const [step, setStep] = useState(0);           // index into GT_INPUTS, === length when done
  const [settling, setSettling] = useState(false); // waiting for release before the next capture
  const [raw, setRaw] = useState({ buttons: [], axes: [] });
  const bindsRef = useRef({});
  const restRef = useRef(null);
  const rafRef = useRef(0);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const gpNow = () => (navigator.getGamepads ? navigator.getGamepads()[gamepad.index] : null);
    restRef.current = snapshot(gpNow() || gamepad);

    const isSettled = (gp) => {
      const rest = restRef.current;
      for (let i = 0; i < gp.buttons.length; i++) if (gp.buttons[i].value > BUTTON_ON) return false;
      for (let i = 0; i < gp.axes.length; i++) {
        const r = rest.axes[i] ?? 0;
        if (Math.abs(gp.axes[i] - r) > SETTLE) return false;
      }
      return true;
    };
    const detect = (gp) => {
      const rest = restRef.current;
      for (let i = 0; i < gp.buttons.length; i++) {
        if ((rest.buttons[i] ?? 0) < BUTTON_ON && gp.buttons[i].value >= BUTTON_ON)
          return { kind: "button", index: i };
      }
      for (let i = 0; i < gp.axes.length; i++) {
        const r = rest.axes[i] ?? 0;
        const d = gp.axes[i] - r;
        if (Math.abs(d) > AXIS_ON) return { kind: "axis", index: i, dir: d > 0 ? 1 : -1 };
      }
      return null;
    };

    let stepLocal = 0, settleLocal = false;
    const loop = () => {
      const gp = gpNow();
      if (gp) {
        setRaw(snapshot(gp));
        if (stepLocal < GT_INPUTS.length) {
          if (settleLocal) {
            if (isSettled(gp)) { settleLocal = false; setSettling(false); restRef.current = snapshot(gp); }
          } else {
            const src = detect(gp);
            if (src) {
              bindsRef.current[GT_INPUTS[stepLocal].key] = src;
              stepLocal += 1; settleLocal = true;
              setStep(stepLocal); setSettling(true);
              restRef.current = snapshot(gp);
            }
          }
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [gamepad]);

  const done = step >= GT_INPUTS.length;
  const cur = GT_INPUTS[step];

  const finish = () => {
    const mapping = { id: gamepad.id, binds: { ...bindsRef.current } };
    saveMapping(mapping);
    onDone(mapping.binds);
  };
  const skip = () => { setStep((s) => Math.min(GT_INPUTS.length, s + 1)); setSettling(true); };
  const redo = () => {
    const prev = Math.max(0, step - 1);
    delete bindsRef.current[GT_INPUTS[prev].key];
    setStep(prev); setSettling(false);
  };

  return (
    <div className="flash-modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="gpm-box">
        <div className="newproj-head">
          <span className="newproj-title">Map controller</span>
          <span className="newproj-sub">{gamepad.id.slice(0, 48)}</span>
          <button className="newproj-close" onClick={onClose} aria-label="close">×</button>
        </div>

        {!done ? (
          <div className="gpm-body">
            <div className="gpm-prompt">
              Press <b>{cur.label}</b>
              <span className="gpm-progress">{step + 1} / {GT_INPUTS.length}</span>
            </div>
            {settling && <div className="gpm-hint">release everything…</div>}
            <div className="gpm-map">
              {GT_INPUTS.map((inp, i) => (
                <div key={inp.key} className={"gpm-bind" + (i === step ? " cur" : "") + (bindsRef.current[inp.key] ? " set" : "")}>
                  <span>{inp.label}</span>
                  <span className="gpm-src">{bindsRef.current[inp.key]
                    ? (bindsRef.current[inp.key].kind === "button"
                        ? `btn ${bindsRef.current[inp.key].index}`
                        : `axis ${bindsRef.current[inp.key].index}${bindsRef.current[inp.key].dir > 0 ? "+" : "-"}`)
                    : (i === step ? "…" : "")}</span>
                </div>
              ))}
            </div>
            <div className="gpm-actions">
              <button className="confirm-cancel" onClick={skip}>Skip</button>
              {step > 0 && <button className="confirm-cancel" onClick={redo}>Back</button>}
            </div>
          </div>
        ) : (
          <div className="gpm-body">
            <div className="gpm-prompt">All 8 inputs mapped.</div>
            <div className="gpm-map">
              {GT_INPUTS.map((inp) => (
                <div key={inp.key} className={"gpm-bind set"}>
                  <span>{inp.label}</span>
                  <span className="gpm-src">{bindsRef.current[inp.key]
                    ? (bindsRef.current[inp.key].kind === "button"
                        ? `btn ${bindsRef.current[inp.key].index}`
                        : `axis ${bindsRef.current[inp.key].index}${bindsRef.current[inp.key].dir > 0 ? "+" : "-"}`)
                    : "(skipped)"}</span>
                </div>
              ))}
            </div>
            <div className="gpm-actions">
              <button className="confirm-danger" style={{ background: "#3a8a4e" }} onClick={finish}>Save &amp; use</button>
              <button className="confirm-cancel" onClick={() => setStep(0)}>Redo all</button>
            </div>
          </div>
        )}

        {/* live raw readout so you can see the pad respond */}
        <div className="gpm-raw">
          <div className="gpm-raw-row">
            {raw.buttons.map((v, i) => (
              <span key={i} className={"gpm-raw-btn" + (v > 0.1 ? " on" : "")}>{i}</span>
            ))}
          </div>
          <div className="gpm-raw-axes">
            {raw.axes.map((v, i) => (
              <span key={i} className="gpm-raw-axis">a{i}:{v.toFixed(2)}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
