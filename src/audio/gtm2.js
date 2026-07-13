// gtm2.js - GameTank .gtm2 song format for the tracker, browser-side.
//
// Parse/instruments/noteNum come straight from the SDK (pure). The SDK's
// encodeGtm2 uses Buffer, so we reimplement it here returning a Uint8Array,
// mirroring the SDK's byte layout EXACTLY (config, 4 instruments, leading delay,
// then [noteMask, notes(+vel), delay] events, >255 gaps split into padding
// events, trailing 0 terminator). See docs/MUSIC.md and compiler/gtm2.mjs.
import { parseGtm2, noteNum, INSTRUMENTS, NUM_INSTR, CFG_VELOCITY } from "gtlua/compiler/gtm2.mjs";

export { parseGtm2, noteNum, INSTRUMENTS, NUM_INSTR, CFG_VELOCITY };

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
