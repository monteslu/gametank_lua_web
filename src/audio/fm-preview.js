// fm-preview.js - a lightweight Web Audio FM synth for PREVIEWING .gtm2 songs in
// the browser. This is an APPROXIMATION for scrubbing (the plan's "fast preview"
// option), NOT a cycle-exact model of the GameTank ACP's 4-op FM. The exact
// sound is what the emulator produces when you Play the game; this is for quickly
// hearing a melody while composing. Each built-in instrument maps to a simple
// 2-op FM voice (carrier + modulator) with a preset ratio/index/envelope.
import { noteNum } from "./gtm2.js";

// 1-based MIDI note -> Hz. note 0 = rest. The player uses note-1 (0-based MIDI),
// so freq = 440 * 2^((note-1 - 69)/12).
export function noteToFreq(note) {
  if (!note) return 0;
  return 440 * Math.pow(2, ((note - 1) - 69) / 12);
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
  playNote(instr, midi, durSec = 0.35) {
    const ctx = this.ensure();
    this.voice(instr | 0, noteToFreq(midi), ctx.currentTime + 0.01, durSec);
  }

  play(song, { fps = 60, loop = false } = {}) {
    this.stop();
    const ctx = this.ensure();
    this.playing = true;
    const instr = song.instruments.map((x) => (typeof x === "number" ? x : 0));
    const events = song.events || [];
    // walk events accumulating frame time -> seconds
    let frame = 0;
    const t0 = ctx.currentTime + 0.05;
    const held = {};   // ch -> { stopFrame } to compute note durations
    events.forEach((ev, i) => {
      frame += ev.delay | 0;
      const t = t0 + frame / fps;
      // schedule a UI callback at this event
      const id = setTimeout(() => { if (this.playing) this.onFrame?.(i); }, (frame / fps) * 1000);
      this.timers.push(id);
      if (!ev.notes) return;
      for (let ch = 0; ch < 4; ch++) {
        const n = ev.notes[ch];
        if (n === undefined || n === null) continue;
        const note = typeof n === "object" ? n.note : n;
        const vel = typeof n === "object" ? (n.vel ?? 63) : 63;
        // duration: until this channel's next event, min 6 frames
        let dur = 12;
        for (let j = i + 1; j < events.length; j++) {
          const nn = events[j].notes && events[j].notes[ch];
          const acc = events.slice(i + 1, j + 1).reduce((s, e) => s + (e.delay | 0), 0);
          if (nn !== undefined && nn !== null) { dur = Math.max(6, acc); break; }
        }
        if (note) this.voice(instr[ch], noteToFreq(note), t, dur / fps, vel);
      }
    });
    // total length
    const total = events.reduce((s, e) => s + (e.delay | 0), 0);
    const endMs = (total / fps) * 1000 + 400;
    const endId = setTimeout(() => {
      if (!this.playing) return;
      if (loop) this.play(song, { fps, loop });
      else { this.playing = false; this.onFrame?.(-1); }
    }, endMs);
    this.timers.push(endId);
  }

  stop() {
    this.playing = false;
    for (const id of this.timers) clearTimeout(id);
    this.timers = [];
  }

  dispose() { this.stop(); if (this.ctx) { try { this.ctx.close(); } catch { /* */ } this.ctx = null; } }
}
