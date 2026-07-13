import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { INSTRUMENT_LIST, encodeGtm2, noteNum } from "./gtm2.js";
import { FmPreview } from "./fm-preview.js";

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
        <label className="m-field">note
          <select value={pitch} onChange={(e) => setPitch(+e.target.value)}>
            {NOTE_NAMES.map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}
          </select>
        </label>
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
