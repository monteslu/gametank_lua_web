// Editor — Monaco with gt-lua intelligence.
//
// The language service itself is luacretro-web's (completions from the SDK
// builtins table, gt.* member completions, signature help, hover). What stays
// here is the gt-lua MANIFEST: the hand-written signatures below, the tiering
// that keeps the everyday API above the specialist engines, and this app's
// Monaco theme.
//
// Diagnostics arrive as a prop: this IDE compiles in its build pipeline and
// passes the results down, rather than compiling again in the editor.
import React from "react";
import { loader } from "@monaco-editor/react";
// Editor CORE only (not the "monaco-editor" barrel, which registers EVERY
// language and bloats the bundle by ~3MB).
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
// Monaco's OWN built-in Lua language (real tokenizer, maintained upstream) - we
// use it as the base and only layer gt-lua completions + diagnostics on top. We
// do NOT hand-write a Lua grammar.
import "monaco-editor/esm/vs/basic-languages/lua/lua.contribution";
import { LuaEditor } from "luacretro-web/editor";
import { BUILTINS, CALLBACKS, GT_MEMBERS } from "gtlua/compiler/builtins.js";

// Use the LOCALLY-bundled monaco (not the default CDN) - the app is self-contained.
loader.config({ monaco });

// Everyday PICO-8 verbs the compiler table does not carry as callable defs but
// that gt-lua programs use constantly - offered so completion never feels thin.
const EXTRA = ["btn", "btnp", "print", "rnd", "flr", "abs", "min", "max", "sin", "cos",
  "sqrt", "band", "bor", "bxor", "shl", "shr", "mid", "sgn", "peek", "poke", "sfx", "music"];

// Hand-written signatures for the everyday API: real parameter names + a
// one-line doc, exactly what a beginner needs when the hint pops up. Anything
// not listed falls back to the compiler's own param-kind table, so EVERY
// builtin and gt.* member shows something.
const DOCS = {
  cls: ["([col])", "clear the screen (default color 0 = black)"],
  print: ["(text, [x], [y], [col])", "draw text; returns the x where it ended"],
  pset: ["(x, y, [col])", "set one pixel"],
  rect: ["(x0, y0, x1, y1, [col])", "rectangle outline, corners included"],
  rectfill: ["(x0, y0, x1, y1, [col])", "filled rectangle, corners included"],
  circ: ["(x, y, r, [col])", "circle outline"],
  circfill: ["(x, y, r, [col])", "filled circle"],
  line: ["(x0, y0, x1, y1, [col])", "line from (x0,y0) to (x1,y1)"],
  spr: ["(n, x, y, [w], [h], [flip_x], [flip_y])", "draw sprite cell n (w/h in 8px cells)"],
  sprf: ["(frame, x, y)", "draw a .gsi animation frame"],
  sset: ["(x, y, [col])", "write a sprite-sheet pixel"],
  camera: ["([x], [y])", "sticky draw offset added to everything (no args = reset)"],
  color: ["(col)", "set the default draw color"],
  btn: ["(i, [player])", "held? 0=left 1=right 2=up 3=down 4=A 5=B 6=C 7=start"],
  btnp: ["(i, [player])", "pressed this frame? same indices as btn"],
  sfx: ["(n, [ch])", "play sound effect n"],
  sfx_bank: ["(blob)", "register a hexdata sfx bank (sfx(n) plays from it)"],
  music: ["([n])", "play song n; -1 or no args stops"],
  music_bank: ["(blob)", "register a hexdata music bank"],
  song: ["(blob)", "play a raw hexdata song"],
  song_stop: ["()", "stop the current song"],
  flr: ["(n)", "round down"],
  ceil: ["(n)", "round up"],
  abs: ["(n)", "absolute value"],
  sgn: ["(n)", "-1 or 1"],
  min: ["(a, b)", "smaller of two"],
  max: ["(a, b)", "larger of two"],
  mid: ["(a, b, c)", "the middle value - clamp(b, a..c)"],
  sqrt: ["(n)", "square root"],
  sin: ["(turns)", "sine; a full circle is 1.0, positive = down"],
  cos: ["(turns)", "cosine; a full circle is 1.0"],
  atan2: ["(dx, dy)", "angle of a vector, in turns"],
  rnd: ["([n])", "random 0..n (no args: 0..1)"],
  srand: ["(seed)", "seed the random generator"],
  t: ["()", "seconds since boot"],
  time: ["()", "seconds since boot"],
  array: ["(n)", "fixed-size number array (1-based)"],
  array8: ["(n)", "fixed-size BYTE array (values 0-255, half the RAM)"],
  pool: ["(n, [fields])", "entity pool for add/del/all loops"],
  add: ["(pool, {fields})", "spawn into a pool (silently drops when full)"],
  del: ["(pool, item)", "remove from a pool (inside all() loops)"],
  hexdata: ["(hexstring)", "compile-time hex string -> ROM bytes"],
  // ---- the gt.* namespace (signatures from the cheatsheet + real call sites)
  "gt.rgb": ["(r, g, b)", "raw GameTank color: nearest match for r,g,b - or pass ONE palette byte 0-255"],
  "gt.ticks": ["()", "frames since boot"],
  "gt.border": ["(col)", "fill the overscan ring around the screen"],
  "gt.autocls": ["(col)", "auto-clear to col each frame (free - runs between frames)"],
  "gt.note": ["(ch, note, vol)", "start an FM note on an ACP channel"],
  "gt.noteoff": ["(ch)", "release the note on a channel"],
  "gt.bg_clear": ["()", "clear the offscreen 256x256 canvas to color 0"],
  "gt.bg_tile": ["(t, px, py)", "stamp sheet tile t into the canvas (8px-aligned; t must be a cell 0-127)"],
  "gt.bg_compose": ["(map, cols, cx, cy, cw, ch)", "CPU-paint a tilemap into the canvas, once per level"],
  "gt.bg_draw": ["([sx], [sy])", "blit the (scrolled) canvas to the screen - one blit per frame"],
  "gt.bg_coln": ["(cells, px, py, n)", "paint one tile COLUMN into the canvas (cells 0-127; cell 0 = clear)"],
  "gt.gspr": ["(gx, gy, w, h, x, y)", "blit a rect FROM the canvas - a pre-composed 'cut' sprite"],
  "gt.canvas_view": ["(dx, dy, opaque, [h])", "window blit from the composed canvas"],
  "gt.tiles_draw": ["(map, flags, w, i0, i1, j0, j1)", "asm tile-window scan -> blits"],
  "gt.pool_move": ["(pool, mode)", "integrate every pool entity's position in one asm walk"],
  "gt.pool_anim": ["(pool, frameField, spdField, maxField, [reset])", "advance animation frames (16ths); past max snaps to reset (default 16 = first frame)"],
  "gt.pool_sprs": ["(pool, cells, ox, oy)", "draw the whole pool as sprites"],
  "gt.pool_edraw": ["(pool, ani, type, flash, desc, nudge)", "rich pool draw (flash/shake variants)"],
  "gt.hit_scan": ["(poolA, wField, hField, poolB, wField, w, h, pairs)", "broad-phase collision -> contact pair ordinals"],
  "gt.pool_decay": ["(act, lm, table, n, step)", "per-slot sum += table[act-1], lm -= step (floor 0); returns the sum"],
  "gt.phys_bounds": ["(x0, y0, x1, y1, bounce_min)", "the walls bodies bounce in (default: whole screen); bounce_min = fall speed needed to bounce off the floor (0 = always, higher = they settle)"],
  "gt.phys_sprite": ["(size, ox, oy)", "body sprite size + center anchor for phys_draw (default 16, 8, 7)"],
  "gt.phys_step": ["(x, y, vx, vy, act, flags, pairs, n)", "integrate + wall-bounce (walls from gt.phys_bounds) + collision pairs"],
  "gt.phys_drag": ["(vx, vy, act, n)", "apply drag to the ball table"],
  "gt.phys_draw": ["(x, y, cells, n)", "draw the body table in bulk asm (size from gt.phys_sprite)"],
  "gt.parts_step": ["(pool)", "step a particle pool (move + age) in asm"],
  "gt.parallax_init": ["(n, [far], [mid], [near])", "parallax field: n drifting stars/specks; optional colors per depth tier"],
  "gt.parallax_move": ["(mode)", "scroll the parallax field"],
  "gt.parallax_draw": ["()", "draw the parallax field"],
  "gt.drift_init": ["(n)", "drifting particle layer (snow/rain/embers): allocate n"],
  "gt.drift_set": ["(i, x, y, w, h, spd8, col)", "restyle one drift slot (size/speed/color)"],
  "gt.drift_draw": ["(dx, dy)", "draw the drift layer, drifting by dx,dy"],
  "gt.drift_draw_range": ["(first, count, dx, dy)", "draw a slice of the drift slots (layering)"],
  "gt.drift_mode": ["(i, m)", "drift motion mode for a slot"],
  "gt.dbar": ["(px, py, v, m, col, col2, bg)", "segmented HUD bar: value v of max m (bg >= 16 skips the strip)"],
  "gt.dbar_style": ["(scale, strip_w, h, defc)", "bar look: px-per-unit scale (/256, default 77), strip width, height, deficit color"],
  "gt.print_buf": ["(buf, off, x, y, col)", "fast HUD text from a byte buffer (no string building)"],
  "gt.chunks_draw": ["(grid, lut, lut2, props, stride, cx0, cy0, cx1, cy1)", "24x24-chunk world renderer"],
  "gt.track_dims": ["(wtiles)", "track world size in tiles per side (default 90 = 30x30 chunks)"],
};

// tiers keep the everyday API on top; specialist engines sink
const memberTier = (n) => {
  if (["rgb", "ticks", "border", "autocls", "print_buf", "note", "noteoff"].includes(n)) return "1";
  if (/^(phys_|pool_|parts_|hit_scan|dbar|parallax_|drift_|chain)/.test(n)) return "2";
  if (/^(bg_|gspr|canvas_view|tiles_draw|gflush)/.test(n)) return "3";
  return "4";   // track_*, chunks_draw, mark, the exotic rest
};

const LANGUAGE = {
  builtins: BUILTINS,
  callbacks: CALLBACKS,
  members: GT_MEMBERS,
  memberNs: "gt",
  extraBuiltins: EXTRA,
  docs: DOCS,
  owner: "gtlua",
  callbackDoc: "callback (_init/_update/_draw...)",
  tiers: { memberRank: memberTier },
};

// a dark theme close to our app palette (colors Monaco's own Lua tokens)
let themed = false;
function defineTheme(m) {
  if (themed) return;
  themed = true;
  m.editor.defineTheme("gtlua-dark", {
    base: "vs-dark", inherit: true,
    rules: [
      { token: "comment.lua", foreground: "6b7280", fontStyle: "italic" },
      { token: "comment", foreground: "6b7280", fontStyle: "italic" },
      { token: "string.lua", foreground: "9ece6a" },
      { token: "string", foreground: "9ece6a" },
      { token: "number.lua", foreground: "ff9e64" },
      { token: "number", foreground: "ff9e64" },
      { token: "keyword.lua", foreground: "bb9af7" },
      { token: "keyword", foreground: "bb9af7" },
      { token: "identifier.lua", foreground: "d6dae2" },
    ],
    colors: { "editor.background": "#0f1117" },
  });
}

/**
 * The code editor: Monaco (the VS Code editor), self-hosted (no CDN), using
 * Monaco's built-in Lua language for highlighting, with a thin gt-lua layer on
 * top (completions for our builtins + the compiler's diagnostics as markers).
 */
export function Editor({ value, onChange, diagnostics }) {
  return (
    <LuaEditor
      className="monaco"
      value={value}
      onChange={onChange}
      language={LANGUAGE}
      diagnostics={diagnostics}
      theme="gtlua-dark"
      beforeMount={defineTheme}
      onPlay={() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "r", ctrlKey: true, metaKey: true }));
      }}
      options={{
        fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
        renderLineHighlight: "line",
        smoothScrolling: true,
        insertSpaces: true,
        padding: { top: 8 },
      }}
    />
  );
}
