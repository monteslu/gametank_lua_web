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
const MAX_VEL = 63;          // GameTank velocity is 6-bit (0-63)
const DEFAULT_VEL = 63;

// A grid cell is either a plain note number (velocity = default) or a
// { note, vel } object (per-note velocity). These read/normalize either shape.
const noteOf = (cell) => (cell && typeof cell === "object" ? cell.note : cell) || 0;
const velOf = (cell) => (cell && typeof cell === "object" && cell.vel != null ? cell.vel : DEFAULT_VEL);
const makeCell = (note, vel, withVel) => (note && withVel && vel !== DEFAULT_VEL ? { note, vel } : note);

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
  const modelRef = useRef(model);   // live model for the playback clock to read
  modelRef.current = model;
  const preview = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [playRow, setPlayRow] = useState(-1);
  const [pitch, setPitch] = useState(noteNum("c4"));
  const [baseOctave, setBaseOctave] = useState(4);   // Z row = this octave's C
  const [cursor, setCursor] = useState({ step: 0, ch: 0 });   // edit cursor
  const [vel, setVel] = useState(DEFAULT_VEL);       // velocity for placed notes
  const rootRef = useRef(null);
  const heldKeys = useRef(new Set());

  useEffect(() => {
    preview.current = new FmPreview();
    preview.current.onFrame = () => {};
    return () => preview.current?.dispose();
  }, []);

  // keep the cursor inside the grid when steps shrink
  useEffect(() => {
    setCursor((c) => (c.step < model.steps ? c : { ...c, step: model.steps - 1 }));
  }, [model.steps]);

  // when the cursor lands on a note, reflect its velocity in the slider
  useEffect(() => {
    if (!model.velocity) return;
    const cell = model.grid[cursor.step]?.[cursor.ch];
    if (noteOf(cell)) setVel(velOf(cell));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor.step, cursor.ch, model.velocity]);

  // place a note (with an optional velocity) at a cell; 0 clears it. When the
  // song is in velocity mode a non-default velocity is stored as {note,vel}.
  const setGrid = (step, ch, note, noteVel = vel) => {
    const grid = model.grid.map((row) => row.slice());
    grid[step][ch] = makeCell(note, noteVel, model.velocity);
    onChange({ ...model, grid });
  };

  // set the velocity of the cell under the cursor (in velocity mode)
  const setCellVel = (v) => {
    const cur = model.grid[cursor.step]?.[cursor.ch];
    const n = noteOf(cur);
    if (!n) return;
    const grid = model.grid.map((row) => row.slice());
    grid[cursor.step][cursor.ch] = makeCell(n, v, true);
    onChange({ ...model, velocity: true, grid });
  };

  // hear a note when you pick it on the piano (uses channel 0's instrument)
  const previewNote = useCallback((midi, v = vel) => {
    if (!playing) preview.current?.playNote(model.instruments[0] ?? 0, midi, 0.35, v);
  }, [playing, model.instruments, vel]);

  // Computer-keyboard editing, tracker-style: note keys (Z/Q rows) PLACE the note
  // at the edit cursor and advance a row (like Renoise/FL); arrows move the
  // cursor; Delete/Backspace clears; [ ] shift the octave. Only active while the
  // music editor is mounted and you're not typing in a field.
  useEffect(() => {
    const editing = () => {
      const el = document.activeElement;
      return el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    };
    const onDown = (e) => {
      if (editing() || e.ctrlKey || e.metaKey || e.altKey) return;
      const steps = model.steps;

      // octave shift
      if (e.code === "BracketLeft") { setBaseOctave((o) => Math.max(1, o - 1)); e.preventDefault(); return; }
      if (e.code === "BracketRight") { setBaseOctave((o) => Math.min(7, o + 1)); e.preventDefault(); return; }

      // cursor movement
      if (e.code === "ArrowUp") { setCursor((c) => ({ ...c, step: (c.step - 1 + steps) % steps })); e.preventDefault(); return; }
      if (e.code === "ArrowDown") { setCursor((c) => ({ ...c, step: (c.step + 1) % steps })); e.preventDefault(); return; }
      if (e.code === "ArrowLeft") { setCursor((c) => ({ ...c, ch: (c.ch - 1 + CHANNELS) % CHANNELS })); e.preventDefault(); return; }
      if (e.code === "ArrowRight") { setCursor((c) => ({ ...c, ch: (c.ch + 1) % CHANNELS })); e.preventDefault(); return; }

      // clear the cell under the cursor + advance
      if (e.code === "Delete" || e.code === "Backspace") {
        setGrid(cursor.step, cursor.ch, 0);
        setCursor((c) => ({ ...c, step: (c.step + 1) % steps }));
        e.preventDefault(); return;
      }

      // a note key: place it at the cursor, preview it, advance a row
      const semi = KEY_SEMITONE[e.code];
      if (semi === undefined) return;
      if (heldKeys.current.has(e.code)) { e.preventDefault(); return; }   // ignore auto-repeat
      heldKeys.current.add(e.code);
      const midi = noteNum("c" + baseOctave) + semi;
      if (midi >= 1 && midi <= 128) {
        setPitch(midi);
        setGrid(cursor.step, cursor.ch, midi);
        previewNote(midi);
        setCursor((c) => ({ ...c, step: (c.step + 1) % steps }));
      }
      e.preventDefault();
    };
    const onUp = (e) => { heldKeys.current.delete(e.code); };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => { window.removeEventListener("keydown", onDown); window.removeEventListener("keyup", onUp); heldKeys.current.clear(); };
  }, [baseOctave, previewNote, cursor, model.steps, model.grid, model.instruments]);
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

  // raw .gtm2 import/export - the exact song file the gt-lua / modern C SDK
  // embeds. NOTE: the OLDER C SDK's `.gtm` (produced by the legacy midiconvert)
  // is a DIFFERENT format - it parses without erroring but yields nonsense (out
  // of range instruments), so we detect that and reject it clearly instead of
  // importing garbage. Convert an old .gtm from its source MIDI instead.
  const flashMsg = (m) => { setImportMsg(m); setTimeout(() => setImportMsg(""), 6000); };
  const importGtm2 = useCallback(async () => {
    const picked = await pickFile(".gtm2");
    if (!picked) return;
    try {
      const m = gtm2ToModel(picked.bytes);
      // sanity: valid FM instrument indices are 0-9. A legacy .gtm mis-parses
      // into out-of-range indices - reject rather than import a broken song.
      if (!m.instruments || m.instruments.some((n) => n < 0 || n > 9)) {
        flashMsg("this looks like a legacy .gtm (not .gtm2). Import its MIDI instead.");
        return;
      }
      onChange(m);
      flashMsg("imported .gtm2 song");
    } catch (e) { flashMsg("import failed: " + e.message); }
  }, [onChange]);
  const exportGtm2 = useCallback(() => downloadBytes("song.gtm2", songToBytes(model), "application/octet-stream"), [model]);


  // Live step-clock playback: advance one step at a time, and at each step read
  // the CURRENT model (via modelRef) to (a) play that step's notes and (b) retime
  // the next step from the current tempo. So editing notes / steps / tempo while
  // playing takes effect from the next step, not a snapshot from when you pressed
  // play. Loops by wrapping the row on the live step count.
  const playRunning = useRef(false);
  const playTimer = useRef(0);
  const play = useCallback(() => {
    if (playRunning.current) return;
    preview.current?.ensure();      // unlock audio (this is inside a click)
    playRunning.current = true;
    setPlaying(true);
    let row = 0;
    const tick = () => {
      if (!playRunning.current) return;
      const m = modelRef.current;
      const steps = Math.max(1, m.steps);
      if (row >= steps) row = 0;                 // wrap on the LIVE step count
      setPlayRow(row);
      const stepSec = m.delay / 60;
      preview.current?.playStep(m.grid[row] || [], m.instruments, Math.max(0.06, stepSec * 0.95));
      row++;
      playTimer.current = setTimeout(tick, stepSec * 1000);
    };
    clearTimeout(playTimer.current);
    tick();
  }, []);

  const stop = useCallback(() => {
    playRunning.current = false;
    clearTimeout(playTimer.current);
    preview.current?.stop();
    setPlaying(false); setPlayRow(-1);
  }, []);

  useEffect(() => () => { playRunning.current = false; clearTimeout(playTimer.current); }, []);

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

      {/* piano note picker - two full-width rows: info/controls, then the piano */}
      <div className="music-piano-bar">
        <div className="mpb-info">
          <span className="mpb-label">note <b>{nameOf(pitch)}</b></span>
          <label className="mpb-vel" title="per-note velocity (loudness, 0-63). On: notes carry velocity; the slider sets new notes + the cursor note.">
            <input type="checkbox" checked={!!model.velocity}
              onChange={(e) => onChange({ ...model, velocity: e.target.checked })} />
            velocity
            <input type="range" min="1" max={MAX_VEL} value={vel} disabled={!model.velocity}
              onChange={(e) => { const v = +e.target.value; setVel(v); if (model.velocity) setCellVel(v); }} />
            <b>{model.velocity ? vel : "—"}</b>
          </label>
          <span className="mpb-kbd">keyboard: Z/S/X… = oct {baseOctave}, Q/2/W… = oct {baseOctave + 1} · [ ] octave</span>
        </div>
        <Piano value={pitch} onChange={setPitch} onPreview={(m) => previewNote(m, vel)} baseOctave={baseOctave} />
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
          <div key={s} className={"mg-row " + (s === playRow ? "playhead" : "") + (s % 4 === 0 ? " beat" : "")}>
            <div className="mg-step">{s}</div>
            {row.map((cell, ch) => {
              const note = noteOf(cell);
              const v = velOf(cell);
              // dim the cell toward the background as velocity drops (velocity mode)
              const intensity = model.velocity ? 0.35 + 0.65 * (v / MAX_VEL) : 1;
              return (
                <button
                  key={ch}
                  className={"mg-cell " + (note ? "on" : "") + (cursor.step === s && cursor.ch === ch ? " cursor" : "")}
                  style={note ? { background: CH_COLORS[ch], color: "#1a1726", opacity: intensity } : undefined}
                  onClick={() => { setCursor({ step: s, ch }); setGrid(s, ch, note ? 0 : pitch); }}
                  onContextMenu={(e) => { e.preventDefault(); setCursor({ step: s, ch }); setGrid(s, ch, 0); }}
                  title={note ? `${nameOf(note)}${model.velocity ? ` · vel ${v}` : ""} (click to clear)` : "click to place " + nameOf(pitch)}
                >
                  {note ? nameOf(note) : "·"}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="music-hint">click a cell to move the cursor + place · type notes on the keyboard (Z/Q rows) to fill from the cursor down · arrows move · Del clears · 4 channels, each its own FM instrument</div>
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
    for (let ch = 0; ch < CHANNELS; ch++) {
      const cell = model.grid[s][ch];
      const note = noteOf(cell);
      if (note) { notes[ch] = model.velocity ? { note, vel: velOf(cell) } : note; any = true; }
    }
    if (any) { events.push({ delay: pending, notes }); pending = model.delay; }
    else pending += model.delay;
  }
  return encodeGtm2({ velocity: !!model.velocity, instruments: model.instruments, events });
}
