// p8-import.js - import a PICO-8 .p8 text cart as a new gt-lua project.
//
// What ports automatically:
//   __lua__   -> main.lua, verbatim, under a banner explaining what to expect
//   __gfx__   -> the sheet's NW quadrant (P8 color indices -> GameTank bytes
//                via the compiler's own P8_PALETTE table)
//   __sfx__   -> a gt sfx bank blob (hexdata + sfx_bank), the same conversion
//                the SDK's bin/p8sfx.mjs does: pitch/timing exact, waveforms
//                mapped to the closest FM instrument, effects dropped
//   __music__ -> pattern list blob (hexdata + music_bank)
// What doesn't: __map__ (gt-lua has no map()/mget), pal()/sspr()/metatables
// and other dialect gaps - the Problems panel points at each one.
import { P8_PALETTE } from "gtlua/compiler/builtins.js";
import { compile } from "gtlua/compiler/index.js";
import { decodePngExact } from "./png-exact.js";

// ---- implicit-global hoisting ----------------------------------------------
// PICO-8 makes any un-`local` assignment a GLOBAL, visible from every function;
// a game sets dozens of them inside _init() and reads them everywhere. gtlua has
// no implicit globals - each must be declared `local` at top level - so an
// unported cart shows the SAME "X is not declared" hundreds of times (peeeko:
// 974 of 1002 errors from 93 such names). Auto-declare them: compile, collect
// the exact names the compiler reports undeclared, prepend `local name = 0` for
// each, and repeat to a fixed point. Using the compiler's own diagnostics means
// we only ever hoist a real undeclared read/write - never a field, builtin, or
// already-local - so it can't over-declare.
export function hoistImplicitGlobals(lua) {
  let out = lua;
  const declared = new Set();
  for (let pass = 0; pass < 5; pass++) {
    let errs;
    try {
      errs = compile(out, "main.lua").diagnostics;
    } catch {
      break;   // a parse-level failure the hoist can't help; leave as-is
    }
    const fresh = [];
    for (const d of errs) {
      if (d.severity !== "error" || !/is not declared/.test(d.message)) continue;
      const m = d.message.match(/'([^']+)'/);
      if (!m) continue;
      const name = m[1];
      // plain identifiers only (never a member like a.b, never already done)
      if (!/^[A-Za-z_]\w*$/.test(name) || declared.has(name)) continue;
      declared.add(name);
      fresh.push(name);
    }
    if (!fresh.length) break;
    const block = "-- auto-declared PICO-8 implicit globals (set without 'local')\n" +
      fresh.map((n) => `local ${n} = 0`).join("\n") + "\n\n";
    // insert after the leading comment/blank banner, before the first real line
    const lines = out.split("\n");
    let i = 0;
    while (i < lines.length && (lines[i] === "" || lines[i].startsWith("--"))) i++;
    out = lines.slice(0, i).join("\n") + (i ? "\n" : "") + block + lines.slice(i).join("\n");
  }
  return { lua: out, count: declared.size };
}

// ---- section splitting ------------------------------------------------------
const SECTIONS = ["lua", "gfx", "gff", "label", "map", "sfx", "music"];
export function parseP8(text) {
  if (!text.includes("__lua__")) throw new Error("not a .p8 text cart (no __lua__ section)");
  const out = {};
  for (const name of SECTIONS) {
    const start = text.indexOf(`__${name}__`);
    if (start < 0) continue;
    let end = text.length;
    for (const other of SECTIONS) {
      const i = text.indexOf(`__${other}__`, start + name.length + 4);
      if (i > start && i < end) end = i;
    }
    out[name] = text.slice(start + name.length + 4, end).replace(/^\r?\n/, "");
  }
  return out;
}

// ---- gfx: 128 lines of 128 hex nibbles -> a 128x128 GT-byte quadrant --------
export function gfxToQuadrant(gfxSection) {
  const quad = new Uint8Array(128 * 128);
  if (!gfxSection) return null;
  const lines = gfxSection.split("\n").map((l) => l.trim()).filter((l) => /^[0-9a-f]+$/.test(l));
  if (!lines.length) return null;
  let any = false;
  for (let y = 0; y < Math.min(128, lines.length); y++) {
    const line = lines[y];
    for (let x = 0; x < Math.min(128, line.length); x++) {
      const idx = parseInt(line[x], 16);
      if (idx > 0) any = true;
      // P8 color 0 maps to byte 0 = transparent, matching how spr() keys
      quad[y * 128 + x] = P8_PALETTE[idx];
    }
  }
  return any ? quad : null;
}

// ---- sfx + music -> gt bank blobs (port of the SDK's bin/p8sfx.mjs) ---------
const WAVE_TO_INSTR = { 0: 8, 1: 9, 2: 9, 3: 9, 4: 9, 5: 8, 6: 3, 7: 9 };

function parseSfx(section) {
  const lines = (section ?? "").split("\n").map((l) => l.trim()).filter((l) => /^[0-9a-f]{168}$/.test(l));
  const sfx = [];
  for (const line of lines) {
    const hx = (i, n) => parseInt(line.slice(i, i + n), 16);
    const notes = [];
    for (let k = 0; k < 32; k++) {
      const p = 8 + k * 5;
      notes.push({ pitch: hx(p, 2), wave: hx(p + 2, 1) & 7, vol: hx(p + 3, 1) });
    }
    sfx.push({ speed: hx(2, 2), notes });
  }
  while (sfx.length < 64) sfx.push({ speed: 1, notes: [] });
  return sfx;
}

function parseMusic(section) {
  const pats = [];
  for (const line of (section ?? "").split("\n")) {
    const t = line.trim();
    if (!/^[0-9a-f]{2} [0-9a-f]{8}$/.test(t)) continue;
    const flags = parseInt(t.slice(0, 2), 16);
    const ch = [];
    for (let i = 0; i < 4; i++) {
      const x = parseInt(t.slice(3 + i * 2, 5 + i * 2), 16);
      ch.push(x & 0x40 ? 0xff : x & 0x3f);
    }
    pats.push({ flags, ch });
  }
  return pats;
}

function convertOne(e) {
  let last = -1;
  for (let k = 0; k < e.notes.length; k++) if (e.notes[k].vol > 0) last = k;
  if (last < 0) return null;
  const framesPer = (e.speed * 60) / 128;
  const waveCount = {};
  for (let k = 0; k <= last; k++) {
    const n = e.notes[k];
    if (n.vol > 0) waveCount[n.wave] = (waveCount[n.wave] ?? 0) + 1;
  }
  const wave = +Object.entries(waveCount).sort((a, b) => b[1] - a[1])[0][0];
  let volPeak = 0;
  for (let k = 0; k <= last; k++) if (e.notes[k].vol > volPeak) volPeak = e.notes[k].vol;
  const vol = Math.min(120, Math.round((volPeak / 7) * 127));
  const steps = [];
  let acc = 0;
  for (let k = 0; k <= last; k++) {
    const n = e.notes[k];
    acc += framesPer;
    let dur = Math.floor(acc);
    acc -= dur;
    if (dur < 1) continue;
    if (dur > 255) dur = 255;
    const note = n.vol > 0 ? (n.wave === 6 ? 33 + (n.pitch >> 1) : n.pitch + 36) : 0;
    const prev = steps[steps.length - 1];
    if (prev && prev.note === note) prev.dur = Math.min(255, prev.dur + dur);
    else steps.push({ note, dur });
  }
  if (!steps.length) return null;
  return { instr: WAVE_TO_INSTR[wave] ?? 7, vol, steps };
}

const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

export function sfxBankHex(sfxSection, musicSection) {
  return bankFromParsed(parseSfx(sfxSection), parseMusic(musicSection));
}

function bankFromParsed(sfx, music) {
  let lastPat = -1;
  music.forEach((p, i) => { if (p.ch.some((c) => c !== 0xff)) lastPat = i; });
  music = music.slice(0, lastPat + 1);

  const converted = sfx.map((e) => convertOne(e));
  const lastUsed = converted.reduce((m, c, i) => (c ? i : m), -1);
  const n = lastUsed + 1;
  if (n === 0) return { sfxHex: null, musicHex: null };

  const bodies = [];
  let off = 1 + n * 2;
  const offsets = [];
  for (let i = 0; i < n; i++) {
    const c = converted[i];
    offsets.push(off);
    if (!c) { bodies.push(new Uint8Array([0, 0, 0])); off += 3; continue; }
    const b = new Uint8Array(3 + c.steps.length * 2);
    b[0] = c.instr; b[1] = c.steps.length; b[2] = c.vol;
    c.steps.forEach((s, k) => { b[3 + k * 2] = s.note; b[4 + k * 2] = s.dur; });
    bodies.push(b);
    off += b.length;
  }
  const head = new Uint8Array(1 + n * 2);
  head[0] = n;
  offsets.forEach((o, i) => { head[1 + i * 2] = o & 0xff; head[2 + i * 2] = o >> 8; });
  const blob = new Uint8Array([...head, ...bodies.flatMap((b) => [...b])]);

  let musicHex = null;
  if (music.length) {
    const mb = new Uint8Array(1 + music.length * 5);
    mb[0] = music.length;
    music.forEach((p, i) => {
      mb[1 + i * 5] = p.flags;
      for (let c = 0; c < 4; c++) mb[2 + i * 5 + c] = p.ch[c];
    });
    musicHex = toHex(mb);
  }
  return { sfxHex: toHex(blob), musicHex };
}

// ---- P8SCII button glyphs (inside strings) ----------------------------------
// PICO-8 writes button indices as single-character glyphs: btn(left), "press X".
// In a .p8/.p8.png cart these are single P8SCII control bytes (0x83..0x97) that
// our pixel->ROM->string decode surfaces as U+0083..U+0097 (left=8b right=91
// up=94 down=83 O=8e X=97). The gtlua LEXER already reads a glyph in CODE
// position as its btn() index (0..5), so btn(<glyph>) compiles on its own. But
// the lexer must not touch string contents, so a glyph inside a display string
// ("press <X> to start") survives as a raw byte the GameTank font cannot render.
// Only the importer can fix that: rewrite glyphs that sit INSIDE string literals
// to a readable ASCII token; leave code-position glyphs for the lexer; strip any
// other stray control byte.
const P8_BTN_ASCII = { 0x8b: "[<]", 0x91: "[>]", 0x94: "[^]", 0x83: "[v]", 0x8e: "[O]", 0x97: "[X]" };
const P8_BTN_INDEX = { 0x8b: "0", 0x91: "1", 0x94: "2", 0x83: "3", 0x8e: "4", 0x97: "5" };

// Is this a byte that the gtlua lexer can never make sense of? PICO-8 source is
// full of non-ASCII P8SCII bytes: the button glyphs (handled specially), fill-
// pattern glyphs for fillp(), and assorted UI symbols, plus raw control bytes
// that carts stash inside data strings. Anything in 0x00-0x1f (except tab/new
// line) or 0x7f-0x9f is a P8SCII control/glyph that would raise "unexpected
// character". (Real Unicode >= 0xa0 is left for the parser to reject visibly.)
function isStrayByte(c) {
  if (c === 9 || c === 10 || c === 13) return false;   // tab, LF, CR are fine
  return c < 0x20 || (c >= 0x7f && c < 0xa0);
}

/**
 * Neutralize PICO-8's P8SCII bytes so imported source lexes cleanly. Button
 * glyphs become their numeric btn() index in CODE and a readable ASCII token
 * ([X], [O], arrows) inside a STRING. Every other stray control/glyph byte in
 * CODE becomes a valid identifier fragment (`_pNN`): PICO-8 allows high bytes in
 * identifiers, so a whole cart may name a variable with a glyph (`<80> = "an"`);
 * mapping to a name keeps that variable intact (a standalone glyph like a
 * fillp() pattern just becomes an honest undeclared-name error, not a cascade).
 * Inside a STRING the byte is dropped. A garbage byte never adds a bogus
 * "unexpected character".
 * @param {string} lua
 * @returns {{ lua: string, translated: number, strays: number[] }}
 */
export function translateP8Glyphs(lua) {
  let translated = 0;
  const strays = new Set();
  let out = "";
  let quote = null;   // current string delimiter, or null when in code
  for (let i = 0; i < lua.length; i++) {
    const ch = lua[i];
    const c = ch.codePointAt(0);
    if (quote) {
      // inside a string literal: a backslash escapes the next char
      if (ch === "\\") { out += ch + (lua[++i] ?? ""); continue; }
      if (ch === quote) { quote = null; out += ch; continue; }
      if (P8_BTN_ASCII[c] !== undefined) { translated++; out += P8_BTN_ASCII[c]; continue; }
      if (isStrayByte(c)) { strays.add(c); continue; }   // unprintable byte in a string: drop
      out += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; out += ch; continue; }
    if (P8_BTN_INDEX[c] !== undefined) { translated++; out += P8_BTN_INDEX[c]; continue; }
    if (isStrayByte(c)) { strays.add(c); out += `_p${c.toString(16)}`; continue; }  // glyph -> valid name
    out += ch;
  }
  return { lua: out, translated, strays: [...strays] };
}

// ---- what-to-expect: name the big dialect gaps this cart actually uses -------
// gt-lua rejects several PICO-8-isms outright. When a cart leans on one, the
// Problems panel fills with the SAME error over and over and reads like the
// import broke. It didn't - list the offenders up top so the errors make sense.
// (These are lexer/parser features, not missing builtins; a missing builtin like
//  split() just shows once as an undefined name.)
// Only flag what gt-lua genuinely does NOT support. (Paren-less string/table
// calls, [[long strings]], and button glyphs all compile now - the compiler
// handles them - so they're deliberately not listed.)
const DIALECT_GAPS = [
  { re: /function\s*\(/, say: "anonymous functions / closures - define named top-level functions instead" },
  { re: /(?<![.\w])[A-Za-z_]\w*\s*:\s*[A-Za-z_]\w*\s*\(/, say: "method calls a:b() - gt-lua has no methods; pass the object explicitly" },
  { re: /\{\s*(?:\[|["'\d-]|\{|[A-Za-z_]\w*\s*[,}])/,
    say: "array / computed-key tables ({1,2,3} or {[k]=v}) - gt-lua tables are structs with named fields ({x=1, y=2})" },
  { re: /(?<![.\w])(?:nil)(?![.\w])/, say: "nil / dynamic typing - initialize every variable with a real value" },
  { re: /(?<![.\w])(?:split|all|foreach|del|deli|count|mget|mset|map|pal|palt|sspr|menuitem|coresume|cocreate|yield)(?![.\w])/,
    say: "PICO-8 builtins gt-lua doesn't have (split/all/foreach/map/pal/coroutines...) - port these by hand" },
];

function dialectGaps(lua) {
  return DIALECT_GAPS.filter((g) => g.re.test(lua)).map((g) => g.say);
}

const BANNER = (name, notes, gaps) => `-- ${name} - imported from a PICO-8 cart.
--
-- gt-lua is a PICO-8-FLAVORED dialect, not PICO-8: most carts need some
-- hand-porting. The graphics and sound imported fine. The Problems panel below
-- is full of errors because this cart uses PICO-8 features gt-lua doesn't have -
-- that's expected, not a broken import. The cheatsheet tab has a "for PICO-8
-- users" guide.
--
${gaps.length ? "-- This cart uses:\n" + gaps.map((g) => `--   * ${g}`).join("\n") + "\n--\n" : ""}${notes.map((n) => `-- NOT imported: ${n}`).join("\n")}${notes.length ? "\n" : ""}
`;

/**
 * Convert a .p8 text cart into gt-lua project files.
 * @param {string} text  the cart source
 * @param {string} name  project name (from the file name)
 * @returns {{ files: Record<string, string|Uint8Array>, notes: string[] }}
 */
export function p8ToProject(text, name) {
  const cart = parseP8(text);
  const notes = [];
  if (cart.map && cart.map.trim()) notes.push("__map__ data (gt-lua has no map()/mget - draw or compose the level yourself)");

  const quad = gfxToQuadrant(cart.gfx);
  const { sfxHex, musicHex } = sfxBankHex(cart.sfx, cart.music);

  const glyphs = translateP8Glyphs((cart.lua ?? "").replace(/\r\n/g, "\n").trimEnd() + "\n");
  let lua = glyphs.lua;
  const gaps = dialectGaps(lua);
  // wire the converted audio in: bank locals up top, registration at the top
  // of _init (or a fresh _init when the cart has none)
  if (sfxHex) {
    const banks = [`local p8sfx = hexdata("${sfxHex}")`];
    const calls = ["  sfx_bank(p8sfx)"];
    if (musicHex) {
      banks.push(`local p8music = hexdata("${musicHex}")`);
      calls.push("  music_bank(p8music)");
    }
    const decl = `-- converted PICO-8 sfx/music (pitch + timing; FM instruments approximate)\n${banks.join("\n")}\n\n`;
    if (/^function _init\(\)$/m.test(lua)) {
      lua = decl + lua.replace(/^function _init\(\)$/m, `function _init()\n${calls.join("\n")}`);
    } else {
      lua = decl + `function _init()\n${calls.join("\n")}\nend\n\n` + lua;
    }
  }

  ({ lua } = hoistImplicitGlobals(lua));
  const files = { "main.lua": BANNER(name, notes, gaps) + lua };
  if (quad) files["gfx.gtg"] = quad;
  return { files, notes };
}

// ---- .p8.png carts ----------------------------------------------------------
// The 32KB cart ROM hides in the low 2 bits of each pixel's a/r/g/b. Code at
// 0x4300 comes raw, legacy-compressed (":c:") or pxa-compressed; both
// decompressors below follow the PICO-8 wiki / zepto8 reference (the same
// implementations fake08 uses).
const LEGACY_LUT = "\n 0123456789abcdefghijklmnopqrstuvwxyz!#%(){}[]<>+=/*:;.,~_";

function legacyDecompress(code) {
  const length = code[4] * 256 + code[5];
  let out = "";
  for (let i = 8; i < code.length && out.length < length; i++) {
    const byte = code[i];
    if (byte === 0x00) out += String.fromCharCode(code[++i]);
    else if (byte < 0x3c) out += LEGACY_LUT[byte - 1];
    else {
      const offset = (byte - 0x3c) * 16 + (code[i + 1] & 0xf);
      const len = (code[i + 1] >> 4) + 2;
      const start = out.length - offset;
      if (start >= 0) for (let j = 0; j < len; j++) out += out[start + j];
      i++;
    }
  }
  return out;
}

function pxaDecompress(input) {
  const length = input[4] * 256 + input[5];
  const compressed = input[6] * 256 + input[7];
  let pos = 8 * 8;
  const getBits = (count) => {
    let n = 0;
    for (let i = 0; i < count && pos < compressed * 8; i++, pos++) {
      n |= ((input[pos >> 3] >> (pos & 7)) & 1) << i;
    }
    return n;
  };
  // move-to-front table over the byte alphabet
  const mtf = Array.from({ length: 256 }, (_, i) => i);
  let out = "";
  while (out.length < length && pos < compressed * 8) {
    if (getBits(1)) {
      let nbits = 4;
      while (getBits(1)) nbits++;
      const n = getBits(nbits) + (1 << nbits) - 16;
      const ch = mtf[n];
      mtf.splice(n, 1); mtf.unshift(ch);
      if (!ch) break;
      out += String.fromCharCode(ch);
    } else {
      const nbits = getBits(1) ? (getBits(1) ? 5 : 10) : 15;
      const offset = getBits(nbits) + 1;
      if (nbits === 10 && offset === 1) {
        let ch = getBits(8);
        while (ch) { out += String.fromCharCode(ch); ch = getBits(8); }
      } else {
        let n, len = 3;
        do len += (n = getBits(3)); while (n === 7);
        for (let i = 0; i < len; i++) out += out[out.length - offset];
      }
    }
  }
  return out;
}

function romLua(rom) {
  const code = rom.subarray(0x4300, 0x8000);
  if (code[0] === 0 && code[1] === 0x70 && code[2] === 0x78 && code[3] === 0x61) return pxaDecompress(code);
  if (code[0] === 0x3a && code[1] === 0x63 && code[2] === 0x3a && code[3] === 0) return legacyDecompress(code);
  let end = code.indexOf(0);
  if (end < 0) end = code.length;
  let out = "";
  for (let i = 0; i < end; i++) out += String.fromCharCode(code[i]);
  return out;
}

function romSfx(rom) {
  const sfx = [];
  for (let n = 0; n < 64; n++) {
    const off = 0x3200 + n * 68;
    const notes = [];
    for (let k = 0; k < 32; k++) {
      const w = rom[off + k * 2] | (rom[off + k * 2 + 1] << 8);
      notes.push({ pitch: w & 63, wave: (w >> 6) & 7, vol: (w >> 9) & 7 });
    }
    sfx.push({ speed: rom[off + 65], notes });
  }
  return sfx;
}

function romMusic(rom) {
  const pats = [];
  for (let n = 0; n < 64; n++) {
    const b = rom.subarray(0x3100 + n * 4, 0x3100 + n * 4 + 4);
    pats.push({
      flags: (b[0] >> 7) | ((b[1] >> 7) << 1) | ((b[2] >> 7) << 2),
      ch: [...b].map((x) => (x & 0x40 ? 0xff : x & 0x3f)),
    });
  }
  return pats;
}

function romGfxQuadrant(rom) {
  const quad = new Uint8Array(128 * 128);
  let any = false;
  for (let i = 0; i < 0x2000; i++) {
    const lo = rom[i] & 0xf, hi = rom[i] >> 4;   // low nibble = left pixel
    if (lo || hi) any = true;
    quad[i * 2] = P8_PALETTE[lo];
    quad[i * 2 + 1] = P8_PALETTE[hi];
  }
  return any ? quad : null;
}

/**
 * Convert a .p8.png cart into gt-lua project files.
 * @param {Uint8Array} bytes  the PNG file
 * @param {string} name  project name (from the file name)
 */
export async function p8PngToProject(bytes, name) {
  const { rgba } = await decodePngExact(bytes);
  if (rgba.length < 0x8000 * 4) throw new Error("PNG too small to be a PICO-8 cart (needs 160x205)");
  const rom = new Uint8Array(0x8000);
  for (let i = 0; i < 0x8000; i++) {
    const o = i * 4;
    rom[i] = ((rgba[o + 3] & 3) << 6) | ((rgba[o] & 3) << 4) | ((rgba[o + 1] & 3) << 2) | (rgba[o + 2] & 3);
  }
  const lua = romLua(rom);
  if (!lua.trim()) throw new Error("no code found - not a PICO-8 cart PNG");

  const notes = [];
  let hasMap = false;
  for (let i = 0x2000; i < 0x3000; i++) if (rom[i]) { hasMap = true; break; }
  if (hasMap) notes.push("__map__ data (gt-lua has no map()/mget - draw or compose the level yourself)");

  const quad = romGfxQuadrant(rom);
  const { sfxHex, musicHex } = bankFromParsed(romSfx(rom), romMusic(rom));

  const glyphs = translateP8Glyphs(lua.replace(/\r\n/g, "\n").trimEnd() + "\n");
  let out = glyphs.lua;
  const gaps = dialectGaps(out);
  if (sfxHex) {
    const banks = [`local p8sfx = hexdata("${sfxHex}")`];
    const calls = ["  sfx_bank(p8sfx)"];
    if (musicHex) {
      banks.push(`local p8music = hexdata("${musicHex}")`);
      calls.push("  music_bank(p8music)");
    }
    const decl = `-- converted PICO-8 sfx/music (pitch + timing; FM instruments approximate)\n${banks.join("\n")}\n\n`;
    if (/^function _init\(\)$/m.test(out)) {
      out = decl + out.replace(/^function _init\(\)$/m, `function _init()\n${calls.join("\n")}`);
    } else {
      out = decl + `function _init()\n${calls.join("\n")}\nend\n\n` + out;
    }
  }
  ({ lua: out } = hoistImplicitGlobals(out));
  const files = { "main.lua": BANNER(name, notes, gaps) + out };
  if (quad) files["gfx.gtg"] = quad;
  return { files, notes };
}
