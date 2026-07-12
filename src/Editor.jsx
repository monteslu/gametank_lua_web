import React, { useRef } from "react";

/**
 * Minimal code editor: a monospace textarea with a line-number gutter that
 * marks lines carrying a diagnostic. This is the first-slice stand-in for
 * Monaco (which lands next) - enough to prove the live-compile loop end to end.
 *
 * @param {{ value: string, onChange: (v: string) => void, diagnostics: Array<{severity:string,line:number}> }} props
 */
export function Editor({ value, onChange, diagnostics }) {
  const taRef = useRef(null);
  const lines = value.split("\n");

  // line number -> worst severity on that line
  const marks = new Map();
  for (const d of diagnostics) {
    const cur = marks.get(d.line);
    if (d.severity === "error" || !cur) marks.set(d.line, d.severity);
  }

  // keep the gutter scrolled with the textarea
  const gutterRef = useRef(null);
  const onScroll = () => {
    if (gutterRef.current && taRef.current) gutterRef.current.scrollTop = taRef.current.scrollTop;
  };

  // Tab inserts two spaces instead of leaving the field.
  const onKeyDown = (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const el = e.target;
      const s = el.selectionStart, en = el.selectionEnd;
      const next = value.slice(0, s) + "  " + value.slice(en);
      onChange(next);
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 2; });
    }
  };

  return (
    <div className="editor">
      <div className="gutter" ref={gutterRef}>
        {lines.map((_, i) => {
          const ln = i + 1;
          const sev = marks.get(ln);
          return (
            <div key={ln} className={"gline" + (sev ? " " + sev : "")}>
              {sev ? (sev === "error" ? "●" : "▲") : ""}<span className="lnum">{ln}</span>
            </div>
          );
        })}
      </div>
      <textarea
        ref={taRef}
        className="code"
        value={value}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onScroll={onScroll}
      />
    </div>
  );
}
