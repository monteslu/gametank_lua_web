import React from "react";

// The project.json editor. GameTank's official C SDK uses a project.json
// ({title, romname, progbanks, modules}); gtlua projects follow that shape and
// add build knobs (num8). This tab is the friendly front-end for that file - a
// beginner sets a title and flips "smaller/faster numbers" without hand-editing
// JSON. `project` is the parsed manifest; onChange gets the updated object.
export function ProjectSettings({ project, onChange, projectName }) {
  const p = project || {};
  const set = (k, v) => {
    const next = { ...p };
    if (v === "" || v === false || v === undefined) delete next[k];
    else next[k] = v;
    onChange(next);
  };

  return (
    <div className="settings">
      <div className="settings-inner">
        <h2>Project settings</h2>
        <p className="settings-sub">
          Saved as <code>project.json</code> - the same project file the GameTank
          C SDK uses. Exports and forks carry it along.
        </p>

        <label className="settings-field">
          <span className="settings-label">Title</span>
          <input
            type="text"
            value={p.title ?? ""}
            placeholder={projectName || "My GameTank Game"}
            onChange={(e) => set("title", e.target.value)}
          />
          <span className="settings-hint">shown on the cart / gallery</span>
        </label>

        <label className="settings-field">
          <span className="settings-label">ROM file name</span>
          <input
            type="text"
            value={p.romname ?? ""}
            placeholder={`${projectName || "game"}.gtr`}
            onChange={(e) => set("romname", e.target.value)}
          />
          <span className="settings-hint">the name used when you export the <code>.gtr</code></span>
        </label>

        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={!!p.num8}
            onChange={(e) => set("num8", e.target.checked)}
          />
          <span>
            <b>Smaller, faster numbers (8.8)</b>
            <span className="settings-hint">
              Uses the 8.8 number model instead of 16.16: about half the math
              work (a real speed win on busy games), but numbers only reach
              ±127.99. Turn on only if a game was written for it - some ports
              require it.
            </span>
          </span>
        </label>
      </div>
    </div>
  );
}
