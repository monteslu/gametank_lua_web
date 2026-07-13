import React, { useEffect, useState } from "react";
import { marked } from "marked";
import { diagramFor } from "./cheat-diagrams.jsx";

// The gt-lua cheatsheet, shown in a tab next to the code editor. Fetches the
// staged CHEATSHEET.md (public/docs) and renders it. The SDK's markdown draws a
// few diagrams as ASCII art (so it still reads on GitHub/npm); here we detect
// those blocks and swap them for crisp inline SVG (see cheat-diagrams.jsx). The
// doc is split into segments at each diagram block: markdown segments render to
// HTML, diagram segments render as React SVG components.
let cachedSegments = null;

// Split raw markdown into an ordered list of { type:'md', html } | { type:'svg', node }.
// A fenced code block that diagramFor() recognizes becomes an svg segment; the
// markdown before/after it renders normally.
function buildSegments(md) {
  const fence = /```[^\n]*\n([\s\S]*?)\n```/g;
  const segments = [];
  let last = 0, m;
  while ((m = fence.exec(md)) !== null) {
    const node = diagramFor(m[1]);
    if (!node) continue;   // not a diagram - leave it in the markdown stream
    if (m.index > last) segments.push({ type: "md", html: marked.parse(md.slice(last, m.index), { breaks: false }) });
    segments.push({ type: "svg", node });
    last = fence.lastIndex;
  }
  if (last < md.length) segments.push({ type: "md", html: marked.parse(md.slice(last), { breaks: false }) });
  return segments;
}

export function Cheatsheet() {
  const [segments, setSegments] = useState(cachedSegments);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (cachedSegments) return;
    fetch("/docs/CHEATSHEET.md", { cache: "no-cache" })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error("not found"))))
      .then((md) => { cachedSegments = buildSegments(md); setSegments(cachedSegments); })
      .catch((e) => setErr(String(e.message || e)));
  }, []);

  if (err) return <div className="cheat-empty">couldn't load the cheatsheet: {err}</div>;
  if (!segments) return <div className="cheat-empty">loading cheatsheet…</div>;
  return (
    <div className="cheatsheet markdown">
      {segments.map((s, i) =>
        s.type === "svg"
          ? <div className="cheat-figure" key={i}>{s.node}</div>
          : <div key={i} dangerouslySetInnerHTML={{ __html: s.html }} />
      )}
    </div>
  );
}
