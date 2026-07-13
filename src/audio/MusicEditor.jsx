import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { INSTRUMENT_LIST, encodeGtm2, noteNum, gtm2ToModel } from "./gtm2.js";
import { FmPreview } from "./fm-preview.js";
import { midiToSong } from "./midi-import.js";
import { pickFile, downloadBytes } from "../util/download.js";
import { Piano } from "./Piano.jsx";

const CHANNELS = 4;
// note names for the picker, C2..C6 (a comfortable tracker range). Value is
// 1-based MIDI (0 = rest), matching .gtm2.
const NOTE_NAMES = [];
for (let oct = 2; oct <= 6; oct++) {
  for (const n of ["c", "c#", "d", "d#", "e", "f", "f#", "g", "g#", "a", "a#", "b"]) {
    NOTE_NAMES.push({ label: n.toUpperCase() + oct, value: noteNum(n.replace("#", "#") + oct) });
  }
}
const CH_COLORS = ["#ff7ac6", "#57e2e5", "#ffd45e", "#b48cff"];

// Computer-keyboard -> note, the tracker/DAW layout (Renoise/FL/LMMS style):
// the Z row is the base octave, the Q row is one octave up. Value = semitone
// offset from the base octave's C. code -> semitone.
const KEY_SEMITONE = {
  // Z row (base octave)
  KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7,
  KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11, Comma: 12, KeyL: 13, Period: 14, Semicolon: 15, Slash: 16,
  // Q row (one octave up)
  KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18, KeyT: 19,
  Digit6: 20, KeyY: 21, Digit7: 22, KeyU: 23, KeyI: 24, Digit9: 25, KeyO: 26, Digit0: 27, KeyP: 28,
};

/**
 * Step tracker for a .gtm2 song. The song is a { steps, delay, instruments,
 * grid } model where grid[step][ch] = note (1-based MIDI, 0/undefined = empty).
 * Editing is grid-based; on change it's converted to the .gtm2 event stream and
 * handed up as bytes. Web Audio gives a fast FM preview.
 */
export function MusicEditor({ song, onChange }) {
  const model = song;
  const preview = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [playRow, setPlayRow] = useState(-1);
  const [pitch, setPitch] = useState(noteNum("c4"));
  const [baseOctave, setBaseOctave] = useState(4);   // Z row = this octave's C
  const rootRef = useRef(null);
  const heldKeys = useRef(new Set());

  useEffect(() => {
    preview.current = new FmPreview();
    preview.current.onFrame = () => {};
    return () => preview.current?.dispose();
  }, []);

  const setGrid = (step, ch, note) => {
    const grid = model.grid.map((row) => row.slice());
    grid[step][ch] = note;
    onChange({ ...model, grid });
  };

  // hear a note when you pick it on the piano (uses channel 0's instrument)
  const previewNote = useCallback((midi) => {
    if (!playing) preview.current?.playNote(model.instruments[0] ?? 0, midi);
  }, [playing, model.instruments]);

  // Computer-keyboard note playing: Z/Q rows play notes (set the current pitch +
  // preview), Z/X (octave down/up)... actually X is a note, so use the bracket
  // keys and the number-pad-free [ ] for octave. Only active when the music
  // editor is focused/hovered and you're not typing in a field.
  useEffect(() => {
    const editing = () => {
      const el = document.activeElement;
      return el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    };
    const onDown = (e) => {
      if (editing() || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === "BracketLeft") { setBaseOctave((o) => Math.max(1, o - 1)); e.preventDefault(); return; }
      if (e.code === "BracketRight") { setBaseOctave((o) => Math.min(7, o + 1)); e.preventDefault(); return; }
      const semi = KEY_SEMITONE[e.code];
      if (semi === undefined) return;
      if (heldKeys.current.has(e.code)) { e.preventDefault(); return; }   // ignore auto-repeat
      heldKeys.current.add(e.code);
      const midi = noteNum("c" + baseOctave) + semi;
      if (midi >= 1 && midi <= 128) { setPitch(midi); previewNote(midi); }
      e.preventDefault();
    };
    const onUp = (e) => { heldKeys.current.delete(e.code); };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => { window.removeEventListener("keydown", onDown); window.removeEventListener("keyup", onUp); heldKeys.current.clear(); };
  }, [baseOctave, previewNote]);
  const setInstrument = (ch, index) => {
    const instruments = model.instruments.slice();
    instruments[ch] = index;
    onChange({ ...model, instruments });
  };
  const setSteps = (steps) => {
    steps = Math.max(4, Math.min(64, steps | 0));
    const grid = [];
    for (let i = 0; i < steps; i++) grid.push(model.grid[i] ? model.grid[i].slice() : [0, 0, 0, 0]);
    onChange({ ...model, steps, grid });
  };
  const setDelay = (delay) => onChange({ ...model, delay: Math.max(2, Math.min(60, delay | 0)) });

  const [importMsg, setImportMsg] = useState("");
  const importMidi = useCallback(async () => {
    const picked = await pickFile(".mid,.midi,audio/midi");
    if (!picked) return;
    try {
      const next = midiToSong(picked.bytes, { instruments: model.instruments });
      onChange(next);
      const noteCount = next.grid.flat().filter(Boolean).length;
      setImportMsg(`imported ${next.steps} steps, ${noteCount} notes`);
      setTimeout(() => setImportMsg(""), 5000);
    } catch (e) {
      setImportMsg("import failed: " + e.message);
      setTimeout(() => setImportMsg(""), 5000);
    }
  }, [model.instruments, onChange]);

  // raw .gtm2 import/export - the exact song file a C-SDK build embeds.
  const flashMsg = (m) => { setImportMsg(m); setTimeout(() => setImportMsg(""), 5000); };
  const importGtm2 = useCallback(async () => {
    const picked = await pickFile(".gtm2");
    if (!picked) return;
    try { onChange(gtm2ToModel(picked.bytes)); flashMsg("imported .gtm2 song"); }
    catch (e) { flashMsg("import failed: " + e.message); }
  }, [onChange]);
  const exportGtm2 = useCallback(() => downloadBytes("song.gtm2", songToBytes(model), "application/octet-stream"), [model]);

  // grid -> .gtm2 structured song (an event per NON-EMPTY step; delay = the
  // per-step frame count so timing is even). Empty leading/trailing steps still
  // advance time so the loop length is the full grid.
  const toGtm2Song = useCallback(() => {
    const events = [];
    let pending = model.delay;   // frames since the last emitted event
    for (let s = 0; s < model.steps; s++) {
      const notes = {};
      let any = false;
      for (let ch = 0; ch < CHANNELS; ch++) {
        const n = model.grid[s][ch];
        if (n) { notes[ch] = n; any = true; }
      }
      if (any) { events.push({ delay: pending, notes }); pending = model.delay; }
      else pending += model.delay;
    }
    return { instruments: model.instruments, events };
  }, [model]);

  const play = useCallback(() => {
    const p = preview.current;
    const s = toGtm2Song();
    p.onFrame = (i) => {
      if (i < 0) { setPlaying(false); setPlayRow(-1); return; }
    };
    // map event index back to a row for the playhead: rebuild step->event
    p.play(s, { fps: 60, loop: true });
    setPlaying(true);
    // simple playhead: step the row highlight on our own timer at delay/60s
    const stepMs = (model.delay / 60) * 1000;
    let row = 0;
    const tick = () => {
      if (!preview.current?.playing) return;
      setPlayRow(row % model.steps);
      row++;
      playTimer.current = setTimeout(tick, stepMs);
    };
    clearTimeout(playTimer.current);
    tick();
  }, [toGtm2Song, model.delay, model.steps]);

  const playTimer = useRef(0);
  const stop = useCallback(() => {
    preview.current?.stop();
    clearTimeout(playTimer.current);
    setPlaying(false); setPlayRow(-1);
  }, []);

  useEffect(() => () => clearTimeout(playTimer.current), []);

  return (
    <div className="music-editor">
      <div className="music-toolbar">
        <button className={"m-play " + (playing ? "on" : "")} onClick={playing ? stop : play}>
          {playing ? "❚❚ stop" : "▶ preview"}
        </button>
        <label className="m-field">tempo (frames/step)
          <input type="number" min="2" max="60" value={model.delay} onChange={(e) => setDelay(+e.target.value)} />
        </label>
        <label className="m-field">steps
          <input type="number" min="4" max="64" value={model.steps} onChange={(e) => setSteps(+e.target.value)} />
        </label>
        <span className="tb-sep" />
        {importMsg && <span className="import-msg">{importMsg}</span>}
        <button className="tool import" onClick={importMidi} title="import a MIDI file (re-interpreted as 4-channel FM)">import MIDI</button>
        <button className="tool" onClick={importGtm2} title="import a raw .gtm2 song (e.g. from a C project)">.gtm2 ▾</button>
        <button className="tool" onClick={exportGtm2} title="export the song as a raw .gtm2 (for a C project)">.gtm2 ▴</button>
      </div>

      {/* piano note picker - the note placed when you click a grid cell */}
      <div className="music-piano-bar">
        <div className="mpb-info">
          <span className="mpb-label">note <b>{nameOf(pitch)}</b></span>
          <span className="mpb-kbd">play with the keyboard: Z/S/X… row = oct {baseOctave}, Q/2/W… = oct {baseOctave + 1} · [ ] change octave</span>
        </div>
        <Piano value={pitch} onChange={setPitch} onPreview={previewNote} baseOctave={baseOctave} />
      </div>

      {/* channel headers with instrument pickers */}
      <div className="music-heads">
        <div className="mh-step">#</div>
        {model.instruments.map((inst, ch) => (
          <div key={ch} className="mh-chan" style={{ borderColor: CH_COLORS[ch] }}>
            <span className="mh-dot" style={{ background: CH_COLORS[ch] }} />
            <select value={inst} onChange={(e) => setInstrument(ch, +e.target.value)}>
              {INSTRUMENT_LIST.map((it) => <option key={it.index} value={it.index}>{it.name.toLowerCase()}</option>)}
            </select>
          </div>
        ))}
      </div>

      {/* the step grid */}
      <div className="music-grid">
        {model.grid.slice(0, model.steps).map((row, s) => (
          <div key={s} className={"mg-row " + (s === playRow ? "play" : "") + (s % 4 === 0 ? " beat" : "")}>
            <div className="mg-step">{s}</div>
            {row.map((note, ch) => (
              <button
                key={ch}
                className={"mg-cell " + (note ? "on" : "")}
                style={note ? { background: CH_COLORS[ch], color: "#1a1726" } : undefined}
                onClick={() => setGrid(s, ch, note ? 0 : pitch)}
                onContextMenu={(e) => { e.preventDefault(); setGrid(s, ch, 0); }}
                title={note ? nameOf(note) + " (click to clear)" : "click to place " + nameOf(pitch)}
              >
                {note ? nameOf(note) : "·"}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="music-hint">click a cell to place the selected note · click again (or right-click) to clear · 4 channels, each with its own FM instrument</div>
    </div>
  );
}

function nameOf(note) {
  const found = NOTE_NAMES.find((n) => n.value === note);
  return found ? found.label : String(note);
}

// a fresh 16-step song
export function newSong() {
  const steps = 16;
  const grid = [];
  for (let i = 0; i < steps; i++) grid.push([0, 0, 0, 0]);
  return { steps, delay: 8, instruments: [0, 8, 2, 3], grid };   // piano/chip/bass/snare
}

// convert the grid model to .gtm2 bytes (the persisted/build form)
export function songToBytes(model) {
  const events = [];
  let pending = model.delay;
  for (let s = 0; s < model.steps; s++) {
    const notes = {}; let any = false;
    for (let ch = 0; ch < CHANNELS; ch++) { const n = model.grid[s][ch]; if (n) { notes[ch] = n; any = true; } }
    if (any) { events.push({ delay: pending, notes }); pending = model.delay; }
    else pending += model.delay;
  }
  return encodeGtm2({ instruments: model.instruments, events });
}
