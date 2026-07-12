import React, { useEffect, useState } from "react";
import { loadExampleManifest } from "./examples.js";

/**
 * Explorer sidebar: your projects (from IndexedDB) + the forkable examples.
 * Purely presentational - all mutations go through the callbacks.
 */
export function Sidebar({ projects, currentId, onOpen, onNew, onFork, onDelete, onImport }) {
  const [examples, setExamples] = useState([]);
  useEffect(() => { loadExampleManifest().then(setExamples).catch(() => setExamples([])); }, []);

  return (
    <aside className="sidebar">
      <div className="side-section">
        <div className="side-head">
          <span>projects</span>
          <div className="side-actions">
            <button title="new project" onClick={onNew}>+</button>
            <button title="import .gtlua" onClick={onImport}>⇪</button>
          </div>
        </div>
        <ul className="side-list">
          {projects.length === 0 && <li className="empty">no projects yet</li>}
          {projects.map((p) => (
            <li key={p.id} className={p.id === currentId ? "active" : ""}>
              <button className="side-item" onClick={() => onOpen(p.id)} title={p.name}>{p.name}</button>
              <button className="side-del" title="delete" onClick={() => onDelete(p.id)}>×</button>
            </li>
          ))}
        </ul>
      </div>

      <div className="side-section">
        <div className="side-head"><span>examples</span></div>
        <ul className="side-list">
          {examples.map((ex) => (
            <li key={ex.name}>
              <button className="side-item example" onClick={() => onFork(ex)} title={ex.blurb}>
                {ex.name}
                <span className="side-blurb">{ex.blurb}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
