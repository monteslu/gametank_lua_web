// midi-import.js - parse a Standard MIDI File in the browser and convert it to a
// .gtm2 song (the tracker's grid model). GameTank plays 4 FM channels, so we
// fold the MIDI's notes onto 4 channels and quantize onto the tracker grid. This
// is a re-interpretation (4-voice FM), not a faithful GM render - same honest
// caveat as the docs. No deps: raw SMF byte parsing.
//
// SMF layout: "MThd" <len:4> <format:2> <ntracks:2> <division:2>, then ntracks x
// ("MTrk" <len:4> <events>). Events use variable-length delta times; we read
// note-on (0x90, vel>0) and note-off (0x80, or 0x90 vel 0).

function readVarLen(buf, p) {
  let value = 0, byte;
  do { byte = buf[p++]; value = (value << 7) | (byte & 0x7f); } while (byte & 0x80);
  return [value, p];
}

/** Parse SMF bytes -> { division, notes: [{tick, note, ch, vel, dur}] } */
export function parseMidi(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0) !== 0x4d546864) throw new Error("not a MIDI file (no MThd)");
  const ntracks = dv.getUint16(10);
  const division = dv.getUint16(12);   // ticks per quarter note (assume metrical)
  let p = 8 + dv.getUint32(4);

  const notes = [];
  for (let t = 0; t < ntracks; t++) {
    if (dv.getUint32(p) !== 0x4d54726b) break;   // MTrk
    const len = dv.getUint32(p + 4);
    let q = p + 8;
    const end = q + len;
    let tick = 0, running = 0;
    const open = {};   // key `ch:note` -> {tick, vel}
    while (q < end) {
      let dt; [dt, q] = readVarLen(buf, q);
      tick += dt;
      let status = buf[q];
      if (status & 0x80) { running = status; q++; } else { status = running; }
      const type = status & 0xf0;
      const ch = status & 0x0f;
      if (type === 0x90 || type === 0x80) {
        const note = buf[q++], vel = buf[q++];
        const key = ch + ":" + note;
        if (type === 0x90 && vel > 0) {
          open[key] = { tick, vel };
        } else if (open[key]) {   // note off (or note-on vel 0)
          const on = open[key];
          notes.push({ tick: on.tick, note, ch, vel: on.vel, dur: tick - on.tick });
          delete open[key];
        }
      } else if (type === 0xa0 || type === 0xb0 || type === 0xe0) {
        q += 2;   // 2-byte channel messages we ignore
      } else if (type === 0xc0 || type === 0xd0) {
        q += 1;   // program change / channel pressure
      } else if (status === 0xff) {   // meta
        const metaLen = buf[q + 1];
        q += 2 + metaLen;
      } else if (status === 0xf0 || status === 0xf7) {   // sysex
        let sl; [sl, q] = readVarLen(buf, q + 1);
        q += sl;
      } else { q++; }
    }
    p = end;
  }
  notes.sort((a, b) => a.tick - b.tick);
  return { division, notes };
}

/**
 * Convert MIDI bytes to the tracker grid model. `stepsPerBeat` sets the grid
 * resolution (4 = 16ths). Notes are quantized to steps and assigned to 4
 * channels round-robin (keeping a note's own channel together where possible).
 * @returns the tracker model { steps, delay, instruments, grid }
 */
export function midiToSong(buf, { stepsPerBeat = 4, maxSteps = 64, instruments = [0, 8, 2, 3] } = {}) {
  const { division, notes } = parseMidi(buf);
  if (!notes.length) throw new Error("no notes found in the MIDI");
  const ticksPerStep = Math.max(1, Math.round(division / stepsPerBeat));

  // quantize each note to a step; find the song length in steps
  const placed = notes.map((n) => ({ step: Math.round(n.tick / ticksPerStep), note: n.note + 1, srcCh: n.ch, vel: n.vel }));
  let steps = Math.min(maxSteps, Math.max(...placed.map((p) => p.step)) + 1);
  steps = Math.max(4, steps);

  const grid = Array.from({ length: steps }, () => [0, 0, 0, 0]);
  // assign channels: keep up to 4 distinct source channels -> tracker channels;
  // extra source channels fold onto the least-used tracker channel.
  const srcChannels = [...new Set(placed.map((p) => p.srcCh))].slice(0, 8);
  const chMap = {};
  srcChannels.forEach((sc, i) => { chMap[sc] = i % 4; });

  for (const p of placed) {
    if (p.step >= steps) continue;
    let ch = chMap[p.srcCh] ?? 0;
    // if that cell is taken this step, find a free channel
    if (grid[p.step][ch]) {
      const free = [0, 1, 2, 3].find((c) => !grid[p.step][c]);
      if (free !== undefined) ch = free; else continue;   // step full, drop
    }
    grid[p.step][ch] = p.note & 0xff;
  }

  return { steps, delay: ticksPerStep >= 1 ? 8 : 8, instruments, grid };
}
