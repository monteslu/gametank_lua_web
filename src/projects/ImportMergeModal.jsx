import React, { useEffect, useState } from "react";

// A friendlier name for the known project files (everything else shows its path).
const NICE = {
  "main.lua": "code",
  "gfx.gtg": "sprite sheet",
  "gfx_1.gtg": "sprite sheet (NE)",
  "gfx_2.gtg": "sprite sheet (SW)",
  "gfx_3.gtg": "sprite sheet (SE)",
  "gfx.gsi": "frame table",
  "music.json": "music",
  "project.json": "project settings",
  "LICENSE": "license",
};

/**
 * Choose how to bring an imported .zip into the workspace: merge selected files
 * into the OPEN project (overwriting), or import as a brand-new project.
 *
 * @param {string} projectName   the currently-open project's name
 * @param {string[]} incoming    file paths in the imported zip
 * @param {string[]} existing    file paths already in the open project
 * @param {(paths:string[])=>void} onMerge  merge just these paths into the open project
 * @param {()=>void} onNewProject  import the whole zip as a new project instead
 * @param {()=>void} onClose
 */
export function ImportMergeModal({ projectName, incoming, existing, onMerge, onNewProject, onClose }) {
  // default: bring in everything EXCEPT project.json (merging settings is rarely
  // what you want - you're usually dropping in an asset or code)
  const [picked, setPicked] = useState(() => new Set(incoming.filter((p) => p !== "project.json")));
  const existingSet = new Set(existing);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggle = (p) => setPicked((s) => {
    const n = new Set(s);
    n.has(p) ? n.delete(p) : n.add(p);
    return n;
  });
  const overwrites = incoming.filter((p) => picked.has(p) && existingSet.has(p));

  return (
    <div className="flash-modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="merge-box">
        <div className="newproj-head">
          <span className="newproj-title">Import into "{projectName}"?</span>
          <button className="newproj-close" onClick={onClose} aria-label="close">×</button>
        </div>

        <div className="merge-body">
          <p className="merge-sub">
            Pick which files to bring into the open project. Checked files that
            already exist will be <b>overwritten</b>.
          </p>

          <ul className="merge-list">
            {incoming.map((p) => {
              const replaces = existingSet.has(p);
              return (
                <li key={p} className={picked.has(p) ? "on" : ""}>
                  <label>
                    <input type="checkbox" checked={picked.has(p)} onChange={() => toggle(p)} />
                    <span className="merge-file">{p}</span>
                    {NICE[p] && <span className="merge-nice">{NICE[p]}</span>}
                    <span className={"merge-tag " + (replaces ? "replace" : "new")}>
                      {replaces ? "replaces existing" : "new"}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

          {overwrites.length > 0 && (
            <div className="merge-warn">
              This overwrites {overwrites.length} file{overwrites.length > 1 ? "s" : ""} in
              "{projectName}" ({overwrites.join(", ")}). This can't be undone.
            </div>
          )}

          <div className="merge-actions">
            <button className="confirm-cancel" onClick={onNewProject}>Import as new project</button>
            <button
              className="confirm-danger"
              disabled={picked.size === 0}
              onClick={() => onMerge([...picked])}
            >
              {overwrites.length ? "Overwrite & merge" : "Merge in"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
