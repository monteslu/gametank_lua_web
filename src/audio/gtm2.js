// gtm2.js - GameTank .gtm2 song format for the tracker, browser-side.
//
// Parse/instruments/noteNum come straight from the SDK (pure). The SDK's
// encodeGtm2 uses Buffer, so we reimplement it here returning a Uint8Array,
// mirroring the SDK's byte layout EXACTLY (config, 4 instruments, leading delay,
// then [noteMask, notes(+vel), delay] events, >255 gaps split into padding
// events, trailing 0 terminator). See docs/MUSIC.md and compiler/gtm2.mjs.
import { parseGtm2, noteNum, INSTRUMENTS, NUM_INSTR, CFG_VELOCITY } from "gtlua/compiler/gtm2.mjs";

export { parseGtm2, noteNum, INSTRUMENTS, NUM_INSTR, CFG_VELOCITY };

// Max steps in the tracker GRID. The GameTank .gtm2 format itself has no length
// cap (the player streams a ROM pointer to a terminator), but the DOM grid needs
// a sane bound; 256 = 16 bars at 16 steps/bar, plenty for real imported songs.
export const MAX_STEPS = 256;

// instrument index list for a picker (name -> index), de-duped to canonical names
export const INSTRUMENT_LIST = [
  "PIANO", "GUITAR", "BASS", "SNARE", "SITAR", "HORN", "BELL", "BLIP", "CHIP", "CHIP2",
].map((name) => ({ name, index: INSTRUMENTS[name] }));

function instrIndex(x) {
  if (typeof x === "number") return x & 0xff;
  const i = INSTRUMENTS[String(x).toUpperCase()];
  if (i === undefined) throw new Error(`unknown instrument "${x}"`);
  return i;
}

/**
 * Encode a structured song to a .gtm2 Uint8Array (browser-safe; byte-identical
 * to the SDK's encodeGtm2).
 * song = { velocity?, instruments:[i0..i3], events:[{delay, notes:{ch:note|{note,vel}}}] }
 */
export function encodeGtm2(song) {
  const velocity = !!song.velocity;
  const instr = song.instruments.map(instrIndex);
  if (instr.length !== 4) throw new Error("a .gtm2 needs exactly 4 channel instruments");
  const out = [velocity ? CFG_VELOCITY : 0, instr[0], instr[1], instr[2], instr[3]];

  const events = song.events || [];
  const pushDelay = (d) => {
    let rem = d | 0;
    while (rem > 255) {
      const t = Math.min(128, rem - 255 > 0 ? 128 : rem);
      out.push(t, 0);           // padding event: time, empty mask
      rem -= t;
    }
    out.push(rem & 0xff);
  };

  pushDelay(events.length ? (events[0].delay | 0) : 0);
  events.forEach((ev, i) => {
    let mask = 0;
    const chans = [];
    for (let ch = 0; ch < 4; ch++) {
      const n = ev.notes ? ev.notes[ch] : undefined;
      if (n === undefined || n === null) continue;
      mask |= 1 << ch;
      chans.push(typeof n === "object" ? n : { note: n });
    }
    out.push(mask);
    for (const n of chans) {
      out.push(n.note & 0xff);
      if (velocity) out.push((n.vel ?? 63) & 0xff);
    }
    const next = events[i + 1];
    pushDelay(next ? (next.delay | 0) : 0);
  });
  if (!events.length) out.push(0);
  return new Uint8Array(out);
}

// hex string of a byte array (for the hexdata() snippet)
export function toHex(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s;
}

/**
 * Reconstruct the tracker grid model from a .gtm2 blob (best-effort: the .gtm2
 * has variable per-event delays; we quantize onto a fixed step where 1 step =
 * the smallest non-zero delay, so an evenly-timed song round-trips well and an
 * irregular one is approximated). Lets a C-project .gtm2 load into the editor.
 */
export function gtm2ToModel(bytes) {
  const song = parseGtm2(bytes);
  const evs = song.events;
  // step size = gcd-ish: use the smallest positive delay as the grid unit
  const delays = evs.map((e) => e.delay | 0).filter((d) => d > 0);
  const unit = delays.length ? Math.max(2, Math.min(...delays)) : 8;
  // place events on steps by accumulated frame time. Zero-base so the first
  // event lands on step 0 (the leading delay is the lead-in, not a real gap);
  // this makes an evenly-timed song round-trip byte-stable through the grid.
  let frame = -(evs.length ? (evs[0].delay | 0) : 0);
  const placed = [];
  for (const e of evs) {
    frame += e.delay | 0;
    const step = Math.round(frame / unit);
    const notes = [0, 0, 0, 0];
    for (const ch of [0, 1, 2, 3]) {
      const n = e.notes && e.notes[ch];
      if (n === undefined || n === null) continue;
      // preserve per-note velocity (as {note,vel}) when the song carries it
      if (typeof n === "object") notes[ch] = song.velocity && n.vel != null ? { note: n.note, vel: n.vel } : n.note;
      else notes[ch] = n;
    }
    placed.push({ step, notes });
  }
  const steps = Math.max(4, Math.min(MAX_STEPS, (placed.length ? placed[placed.length - 1].step : 0) + 1));
  const grid = Array.from({ length: steps }, () => [0, 0, 0, 0]);
  for (const p of placed) if (p.step < steps) grid[p.step] = p.notes;
  return { steps, delay: unit, velocity: !!song.velocity, instruments: song.instruments.slice(0, 4), grid };
}
