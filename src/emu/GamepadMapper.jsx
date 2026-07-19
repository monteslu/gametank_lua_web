import React from "react";
import { useGamepadMapping } from "luacretro-web/input";
import { GT_INPUTS, saveMapping } from "./gamepad.js";

// This IDE's mapper is a bind GRID with a live raw readout and skip/back, not
// the single-prompt dialog the other IDEs use, so the markup stays local. The
// walk itself — capture, settle, advance — comes from the shared hook.

const srcLabel = (b) => (
  b ? (b.kind === "button" ? `btn ${b.index}` : `axis ${b.index}${b.dir > 0 ? "+" : "-"}`) : null
);

/**
 * @param {Gamepad} gamepad  the pad being mapped (from navigator.getGamepads)
 * @param {(binds)=>void} onDone  called with the finished binds (also saved)
 * @param {()=>void} onClose
 */
export function GamepadMapper({ gamepad, onDone, onClose }) {
  const walk = useGamepadMapping({
    gamepad, inputs: GT_INPUTS, onClose, trackRaw: true,
  });
  const { step, settling, done, current: cur, binds, raw } = walk;

  const finish = () => {
    const mapping = walk.finish(saveMapping);
    onDone(mapping.binds);
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
                <div key={inp.key} className={"gpm-bind" + (i === step ? " cur" : "") + (binds[inp.key] ? " set" : "")}>
                  <span>{inp.label}</span>
                  <span className="gpm-src">{srcLabel(binds[inp.key]) ?? (i === step ? "…" : "")}</span>
                </div>
              ))}
            </div>
            <div className="gpm-actions">
              <button className="confirm-cancel" onClick={walk.skip}>Skip</button>
              {step > 0 && <button className="confirm-cancel" onClick={walk.back}>Back</button>}
            </div>
          </div>
        ) : (
          <div className="gpm-body">
            <div className="gpm-prompt">All 8 inputs mapped.</div>
            <div className="gpm-map">
              {GT_INPUTS.map((inp) => (
                <div key={inp.key} className={"gpm-bind set"}>
                  <span>{inp.label}</span>
                  <span className="gpm-src">{srcLabel(binds[inp.key]) ?? "(skipped)"}</span>
                </div>
              ))}
            </div>
            <div className="gpm-actions">
              <button className="confirm-danger" style={{ background: "#3a8a4e" }} onClick={finish}>Save &amp; use</button>
              <button className="confirm-cancel" onClick={walk.restart}>Redo all</button>
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
