import React, { useEffect, useState } from "react";
import { loadExampleManifest } from "./examples.js";

// The scaffold a Blank Project starts from: the three functions every game
// has, ready to type into.
export const BLANK_SOURCE = `-- your game!
function _init()
  -- runs once, when the game starts
end

function _update()
  -- runs 30 times a second: move things, check buttons
end

function _draw()
  cls(0)   -- clear the screen to black, then draw your frame
end
`;

/**
 * New Project dialog: a scrollable gallery of cloneable starting points.
 * "Blank Project" leads, then every bundled example with its 128x128
 * thumbnail (an emulator screenshot of the example running). Cloning copies
 * the example's files into a new project of your own - the original example
 * is never modified.
 */
export function NewProjectModal({ onClone, onBlank, onClose }) {
  const [examples, setExamples] = useState([]);
  useEffect(() => { loadExampleManifest().then(setExamples).catch(() => setExamples([])); }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="flash-modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="newproj-box">
        <div className="newproj-head">
          <span className="newproj-title">New Project</span>
          <span className="newproj-sub">start blank, or clone an example to make it yours</span>
          <button className="newproj-close" onClick={onClose} aria-label="close">×</button>
        </div>
        <div className="newproj-grid">
          <div className="newproj-card">
            <div className="newproj-thumb blank" aria-hidden="true"><span>+</span></div>
            <div className="newproj-name">Blank Project</div>
            <div className="newproj-blurb">Empty _init / _update / _draw, ready to type into.</div>
            <button className="newproj-clone" onClick={onBlank}>Create</button>
          </div>
          {examples.map((ex) => (
            <div className="newproj-card" key={ex.name}>
              {ex.thumb
                ? <img className="newproj-thumb" src={`/examples/${ex.name}/thumb.png`} alt={`${ex.name} screenshot`} width="128" height="128" />
                : <div className="newproj-thumb blank" aria-hidden="true" />}
              <div className="newproj-name">{ex.name}</div>
              <div className="newproj-blurb">{ex.blurb}</div>
              <button className="newproj-clone" onClick={() => onClone(ex)}>Clone</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
