// fm-preview.js - a lightweight Web Audio FM synth for PREVIEWING .gtm2 songs in
// the browser. This is an APPROXIMATION for scrubbing (the plan's "fast preview"
// option), NOT a cycle-exact model of the GameTank ACP's 4-op FM. The exact
// sound is what the emulator produces when you Play the game; this is for quickly
// hearing a melody while composing. Each built-in instrument maps to a simple
// 2-op FM voice (carrier + modulator) with a preset ratio/index/envelope.
import { noteNum } from "./gtm2.js";

// .gtm2 note byte -> Hz. note 0 = rest. The byte is the console's pitch-table
// index (the official format's raw value), tuned so index 57 = A4 = 440 Hz
// (i.e. MIDI - 12) - verified against the emulator core by spectral capture
// (441 Hz, +4 cents). Keeping this in lockstep with the console player is what
// makes the editor preview sound like the built game.
export function noteToFreq(note) {
  if (!note) return 0;
  return 440 * Math.pow(2, (note - 57) / 12);
}

// per-instrument 2-op FM presets: modulator ratio, modulation index, and an
// amplitude envelope (attack/decay/sustain/release seconds + sustain level).
// Rough character matches, not measured - a preview aid.
const PRESETS = {
  0:  { ratio: 1,   index: 2.5, a: 0.005, d: 0.5,  s: 0.0, r: 0.15, type: "sine" },   // PIANO
  1:  { ratio: 2,   index: 3.0, a: 0.005, d: 0.35, s: 0.2, r: 0.2,  type: "sine" },   // GUITAR
  2:  { ratio: 0.5, index: 1.5, a: 0.005, d: 0.4,  s: 0.4, r: 0.15, type: "sine" },   // BASS
  3:  { ratio: 5.4, index: 8,   a: 0.001, d: 0.12, s: 0.0, r: 0.05, type: "sine" },   // SNARE (noisy)
  4:  { ratio: 3,   index: 4,   a: 0.01,  d: 0.6,  s: 0.3, r: 0.3,  type: "sine" },   // SITAR
  5:  { ratio: 1,   index: 4,   a: 0.02,  d: 0.2,  s: 0.6, r: 0.1,  type: "sawtooth" }, // HORN
  6:  { ratio: 3.5, index: 6,   a: 0.001, d: 0.9,  s: 0.0, r: 0.4,  type: "sine" },   // BELL
  7:  { ratio: 1,   index: 0,   a: 0.001, d: 0.06, s: 0.0, r: 0.03, type: "square" }, // BLIP
  8:  { ratio: 1,   index: 0,   a: 0.001, d: 0.2,  s: 0.5, r: 0.05, type: "square" }, // CHIP
  9:  { ratio: 2,   index: 0,   a: 0.001, d: 0.2,  s: 0.4, r: 0.05, type: "triangle" }, // CHIP2
};

/**
 * Plays a structured song (the tracker's model) through Web Audio. Delays are in
 * frames (~60/sec NTSC). Returns a handle with stop().
 */
export class FmPreview {
  constructor() {
    this.ctx = null;
    this.timers = [];
    this.master = null;
    this.playing = false;
    this.onFrame = null;    // (eventIndex) => void, called as each event fires
  }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  }

  // one FM voice at time t
  voice(instr, freq, t, durSec, vel = 63) {
    if (!freq) return;
    const p = PRESETS[instr] ?? PRESETS[0];
    const ctx = this.ctx;
    const carrier = ctx.createOscillator();
    carrier.type = p.type;
    carrier.frequency.value = freq;
    const amp = ctx.createGain();

    // modulator (FM)
    if (p.index > 0) {
      const mod = ctx.createOscillator();
      mod.frequency.value = freq * p.ratio;
      const modGain = ctx.createGain();
      modGain.gain.value = freq * p.index;
      mod.connect(modGain); modGain.connect(carrier.frequency);
      mod.start(t); mod.stop(t + durSec + p.r + 0.05);
    }

    // amp envelope (ADSR)
    const peak = 0.25 * (vel / 63);
    const g = amp.gain;
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(peak, t + p.a);
    g.linearRampToValueAtTime(peak * p.s + 0.0001, t + p.a + p.d);
    const rel = t + Math.max(p.a + p.d, durSec);
    g.setValueAtTime(Math.max(peak * p.s, 0.0001), rel);
    g.exponentialRampToValueAtTime(0.0001, rel + p.r);

    carrier.connect(amp); amp.connect(this.master);
    carrier.start(t); carrier.stop(rel + p.r + 0.05);
  }

  // Play a single note now (for the piano key-press preview). midi is 1-based.
  playNote(instr, midi, durSec = 0.35, vel = 63) {
    const ctx = this.ensure();
    this.voice(instr | 0, noteToFreq(midi), ctx.currentTime + 0.01, durSec, vel);
  }

  // Play one tracker step's notes right now. `cells` is a 4-length array of
  // (note | {note,vel} | 0); `instruments` is the 4 channel instruments;
  // durSec is the step length. Used by the live step-clock in the editor so
  // edits take effect on the next step (instead of a scheduled snapshot).
  playStep(cells, instruments, durSec) {
    const ctx = this.ensure();
    const t = ctx.currentTime + 0.005;
    for (let ch = 0; ch < 4; ch++) {
      const cell = cells[ch];
      if (!cell) continue;
      const note = typeof cell === "object" ? cell.note : cell;
      const vel = typeof cell === "object" ? (cell.vel ?? 63) : 63;
      if (note) this.voice((instruments[ch] | 0), noteToFreq(note), t, durSec, vel);
    }
  }

  // (The old whole-song scheduler play() was removed - playback is now a live
  // step-clock in MusicEditor that calls playStep() per step. That scheduler had
  // an O(n^3) duration scan - events x channels x slice().reduce() - so dropping
  // it also removes a hotspot.)

  stop() {
    this.playing = false;
    for (const id of this.timers) clearTimeout(id);
    this.timers = [];
  }

  dispose() { this.stop(); if (this.ctx) { try { this.ctx.close(); } catch { /* */ } this.ctx = null; } }
}
