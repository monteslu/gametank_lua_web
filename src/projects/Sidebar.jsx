import React from "react";

/**
 * Explorer sidebar: your projects (from IndexedDB). New projects - blank or
 * cloned from an example - start from the New Project dialog (the + button).
 * Purely presentational - all mutations go through the callbacks.
 */
export function Sidebar({ projects, currentId, onOpen, onNew, onDelete, onImport }) {
  return (
    <aside className="sidebar">
      <div className="side-section">
        <div className="side-head">
          <span>projects</span>
          <div className="side-actions">
            <button title="import .gtlua" onClick={onImport}>⇪</button>
          </div>
        </div>
        <button className="side-new" onClick={onNew}>+ New Project</button>
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
    </aside>
  );
}
