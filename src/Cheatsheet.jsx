import React, { useEffect, useState } from "react";
import { marked } from "marked";

// The gt-lua cheatsheet, shown in a tab next to the code editor. Fetches the
// staged CHEATSHEET.md (public/docs) and renders it - one page covers the whole
// language, so it's handy to keep open while writing a game.
let cached = null;

export function Cheatsheet() {
  const [html, setHtml] = useState(cached);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (cached) return;
    fetch("/docs/CHEATSHEET.md")
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error("not found"))))
      .then((md) => { cached = marked.parse(md, { breaks: false }); setHtml(cached); })
      .catch((e) => setErr(String(e.message || e)));
  }, []);

  if (err) return <div className="cheat-empty">couldn't load the cheatsheet: {err}</div>;
  if (!html) return <div className="cheat-empty">loading cheatsheet…</div>;
  return <div className="cheatsheet markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}
