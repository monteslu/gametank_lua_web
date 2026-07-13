import React from "react";
import { noteNum } from "./gtm2.js";

// A horizontal piano keyboard note-picker. White keys are the row; black keys
// (sharps) sit on top between them. Value + onChange are the 1-based MIDI note
// (matching .gtm2). Hovering a key shows its name as a tooltip; clicking selects
// it (and optionally previews via onPreview).
const WHITE = ["c", "d", "e", "f", "g", "a", "b"];
const BLACK = { c: "c#", d: "d#", f: "f#", g: "g#", a: "a#" };   // no e#/b#
// x-offset (in white-key widths) where each black key sits, relative to its
// white key's left edge (~70% over toward the next key).
const BLACK_OFFSET = 0.68;

/**
 * @param {{ value:number, onChange:(midi:number)=>void, onPreview?:(midi:number)=>void,
 *           fromOct?:number, toOct?:number }} props
 */
export function Piano({ value, onChange, onPreview, fromOct = 2, toOct = 6 }) {
  const whites = [];
  const blacks = [];
  let wi = 0;
  for (let oct = fromOct; oct <= toOct; oct++) {
    for (const w of WHITE) {
      const midi = noteNum(w + oct);
      whites.push({ midi, name: w.toUpperCase() + oct, index: wi });
      const sharp = BLACK[w];
      if (sharp && !(w === "b") && !(oct === toOct && w === "b")) {
        blacks.push({ midi: noteNum(sharp + oct), name: sharp.toUpperCase() + oct, whiteIndex: wi });
      }
      wi++;
    }
  }
  const nWhite = whites.length;

  const pick = (midi) => { onChange(midi); onPreview?.(midi); };

  return (
    <div className="piano" role="listbox" aria-label="note">
      <div className="piano-keys" style={{ "--n-white": nWhite }}>
        {whites.map((k) => (
          <button
            key={k.midi}
            className={"pk-white" + (k.midi === value ? " sel" : "")}
            title={k.name}
            aria-label={k.name}
            onClick={() => pick(k.midi)}
          >
            <span className="pk-label">{k.name}</span>
          </button>
        ))}
        {blacks.map((k) => (
          <button
            key={k.midi}
            className={"pk-black" + (k.midi === value ? " sel" : "")}
            title={k.name}
            aria-label={k.name}
            style={{ left: `calc((${k.whiteIndex} + ${BLACK_OFFSET}) * (100% / var(--n-white)))` }}
            onClick={() => pick(k.midi)}
          />
        ))}
      </div>
    </div>
  );
}
