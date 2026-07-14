import React, { useEffect, useState } from "react";
import { marked } from "marked";
import { diagramFor } from "./cheat-diagrams.jsx";

// The gt-lua cheatsheet, shown in a tab next to the code editor. Fetches the
// staged CHEATSHEET.md (public/docs) and renders it. The SDK's markdown draws a
// few diagrams as ASCII art (so it still reads on GitHub/npm); here we detect
// those blocks and swap them for crisp inline SVG (see cheat-diagrams.jsx). The
// doc is split into segments at each diagram block: markdown segments render to
// HTML, diagram segments render as React SVG components.
const segmentCache = {};   // keyed by doc filename

// The primary docs shown as switcher tabs. Every top-level .md is staged to
// public/docs, so links to OTHER docs (GRAPHICS/SPRITES/PALETTE/...) also render
// in-pane via the click interceptor - only these three get a tab.
const DOCS = [
  { file: "CHEATSHEET.md", label: "Cheat sheet" },
  { file: "CHEATSHEET_FOR_PICO8_USERS.md", label: "For PICO-8 users" },
  { file: "PORTING.md", label: "Porting a game" },
];
// A link is an in-app doc if it targets a bare *.md with no path/host - render
// it in this pane rather than letting the browser navigate to raw markdown.
const isDocLink = (href) => /^[A-Za-z0-9_.-]+\.md$/.test(href);

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
  const [doc, setDoc] = useState("CHEATSHEET.md");
  const [segments, setSegments] = useState(segmentCache["CHEATSHEET.md"] || null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (segmentCache[doc]) { setSegments(segmentCache[doc]); setErr(""); return; }
    setSegments(null); setErr("");
    let live = true;
    fetch(`/docs/${doc}`, { cache: "no-cache" })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error("not found"))))
      .then((md) => { if (!live) return; segmentCache[doc] = buildSegments(md); setSegments(segmentCache[doc]); })
      .catch((e) => { if (live) setErr(String(e.message || e)); });
    return () => { live = false; };
  }, [doc]);

  // Intercept clicks on inter-doc .md links so they load in this pane instead of
  // navigating the browser to a raw .md file (which 404s against the app route).
  const onClick = (e) => {
    const a = e.target.closest("a");
    if (!a) return;
    const href = a.getAttribute("href") || "";
    if (isDocLink(href)) { e.preventDefault(); setDoc(href); }
  };

  return (
    <div className="cheatsheet-wrap">
      <div className="cheat-tabs">
        {DOCS.map((d) => (
          <button
            key={d.file}
            className={"cheat-doctab" + (d.file === doc ? " active" : "")}
            onClick={() => setDoc(d.file)}
          >{d.label}</button>
        ))}
      </div>
      {err
        ? <div className="cheat-empty">couldn't load {doc}: {err}</div>
        : !segments
          ? <div className="cheat-empty">loading…</div>
          : (
            <div className="cheatsheet markdown" onClick={onClick}>
              {segments.map((s, i) =>
                s.type === "svg"
                  ? <div className="cheat-figure" key={i}>{s.node}</div>
                  : <div key={i} dangerouslySetInnerHTML={{ __html: s.html }} />
              )}
            </div>
          )}
    </div>
  );
}
