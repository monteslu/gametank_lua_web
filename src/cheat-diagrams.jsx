// cheat-diagrams.jsx - crisp inline-SVG replacements for the CHEATSHEET.md ASCII
// diagrams. The SDK's markdown keeps the ASCII (so it still reads on GitHub/npm);
// the IDE detects those blocks by a content signature and renders these instead.
// All self-contained SVG - no deps, works offline, theme-aware via currentColor.
import React from "react";

// palette pulled from the app's CSS vars so diagrams match the theme
const INK = "var(--fg)";
const DIM = "var(--dim)";
const LINE = "var(--line)";
const ACC = "var(--accent-2)";
const GRAPE = "var(--grape)";
const SUN = "var(--sun)";

// --- 1. "the machine at a glance" - it's really a spec table -----------------
const SPEC = [
  ["CPU", "65C02 @ 3.58 MHz (native, no VM)"],
  ["Screen", "128 × 128 pixels, hundreds of colors"],
  ["Sprites", "one 128×128 sheet of 8×8 cells (0-255)"],
  ["Sound", "4-op FM on a second 65C02 (the ACP)"],
  ["Input", "2 controllers, 6 buttons + START each"],
  ["Numbers", "16.16 fixed point (or 8.8 with --num8)"],
  ["Blitter", "hardware rectangle / sprite copier"],
  ["Limit", "ROM / RAM size - there is NO cycle cap"],
];
function SpecTable() {
  return (
    <table className="cheat-spec">
      <tbody>
        {SPEC.map(([k, v]) => (
          <tr key={k}><th>{k}</th><td>{v}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

// --- 2. screen coordinate frame ---------------------------------------------
function CoordFrame() {
  return (
    <svg className="cheat-svg" viewBox="0 0 440 190" role="img" aria-label="screen coordinate frame">
      <rect x="70" y="30" width="150" height="130" fill="none" stroke={LINE} strokeWidth="2" />
      {/* center marker */}
      <line x1="145" y1="85" x2="145" y2="105" stroke={ACC} strokeWidth="2" />
      <line x1="135" y1="95" x2="155" y2="95" stroke={ACC} strokeWidth="2" />
      {/* corner labels */}
      <text x="66" y="24" textAnchor="end" fill={DIM} fontSize="13" fontFamily="monospace">(0,0)</text>
      <text x="224" y="178" fill={DIM} fontSize="13" fontFamily="monospace">(127,127)</text>
      {/* notes */}
      <text x="250" y="48" fill={INK} fontSize="13">coordinates are 0..127</text>
      <text x="250" y="72" fill={INK} fontSize="13">rect / rectfill corners</text>
      <text x="250" y="90" fill={INK} fontSize="13">are <tspan fill={SUN}>INCLUSIVE</tspan></text>
      <text x="250" y="122" fill={INK} fontSize="13"><tspan fill={GRAPE}>camera()</tspan> shifts every</text>
      <text x="250" y="140" fill={INK} fontSize="13">draw call</text>
      <text x="228" y="100" fill={GRAPE} fontSize="15">←</text>
    </svg>
  );
}

// --- 3. turns-based trig circle ---------------------------------------------
function TrigCircle() {
  const cx = 110, cy = 100, r = 62;
  return (
    <svg className="cheat-svg" viewBox="0 0 460 210" role="img" aria-label="turns-based trig circle">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={LINE} strokeWidth="2" />
      {/* axes */}
      <line x1={cx - r - 12} y1={cy} x2={cx + r + 12} y2={cy} stroke={LINE} strokeWidth="1" />
      <line x1={cx} y1={cy - r - 12} x2={cx} y2={cy + r + 12} stroke={LINE} strokeWidth="1" />
      {/* turn markers */}
      <text x={cx} y={cy - r - 16} textAnchor="middle" fill={ACC} fontSize="13" fontFamily="monospace">0.75</text>
      <text x={cx} y={cy - r - 2} textAnchor="middle" fill={DIM} fontSize="11">(up)</text>
      <text x={cx} y={cy + r + 26} textAnchor="middle" fill={ACC} fontSize="13" fontFamily="monospace">0.25</text>
      <text x={cx} y={cy + r + 40} textAnchor="middle" fill={DIM} fontSize="11">(down)</text>
      <text x={cx - r - 16} y={cy - 6} textAnchor="end" fill={ACC} fontSize="13" fontFamily="monospace">0.5</text>
      <text x={cx - r - 16} y={cy + 10} textAnchor="end" fill={DIM} fontSize="11">(left)</text>
      <text x={cx + r + 16} y={cy - 6} fill={ACC} fontSize="13" fontFamily="monospace">0.0 / 1.0</text>
      <text x={cx + r + 16} y={cy + 10} fill={DIM} fontSize="11">(right)</text>
      {/* notes */}
      <text x="300" y="86" fill={INK} fontSize="13">one full turn = <tspan fill={SUN}>1.0</tspan></text>
      <text x="300" y="112" fill={INK} fontSize="13" fontFamily="monospace">sin(0.25) == 1</text>
      <text x="300" y="130" fill={INK} fontSize="13" fontFamily="monospace">cos(0) == 1</text>
      <text x="300" y="150" fill={DIM} fontSize="12">y grows downward</text>
    </svg>
  );
}

// --- 5. the controller: d-pad + 3 face buttons, each with its btn() index ----
function Controller() {
  // d-pad geometry (left), face buttons (right)
  const P = (cx, cy, label, idx, fill) => (
    <g>
      <circle cx={cx} cy={cy} r="15" fill={fill} stroke="#0c0e14" strokeWidth="1.5" />
      <text x={cx} y={cy + 5} textAnchor="middle" fill="#160b1e" fontSize="13" fontWeight="700">{label}</text>
      <text x={cx} y={cy - 20} textAnchor="middle" fill={ACC} fontSize="12" fontFamily="monospace">{idx}</text>
    </g>
  );
  // d-pad arm as a rounded rect
  const arm = (x, y, w, h) => <rect x={x} y={y} width={w} height={h} rx="4" fill="#2a2f42" stroke="#0c0e14" strokeWidth="1.5" />;
  const dcx = 78, dcy = 96;
  const dLabel = (dx, dy, ch, idx) => (
    <g>
      <text x={dcx + dx} y={dcy + dy + 5} textAnchor="middle" fill="#cbd2de" fontSize="14" fontWeight="700">{ch}</text>
    </g>
  );
  return (
    <svg className="cheat-svg" viewBox="0 0 470 200" role="img" aria-label="controller button indices">
      {/* pad body */}
      <rect x="16" y="34" width="438" height="140" rx="18" fill="#171b26" stroke={LINE} strokeWidth="1.5" />
      <text x="235" y="24" textAnchor="middle" fill={GRAPE} fontSize="12">GameTank pad - btn(index)</text>

      {/* D-PAD (left) */}
      {arm(dcx - 13, dcy - 40, 26, 32)}{/* up */}
      {arm(dcx - 13, dcy + 8, 26, 32)}{/* down */}
      {arm(dcx - 40, dcy - 13, 32, 26)}{/* left */}
      {arm(dcx + 8, dcy - 13, 32, 26)}{/* right */}
      <rect x={dcx - 13} y={dcy - 13} width="26" height="26" fill="#2a2f42" stroke="#0c0e14" strokeWidth="1.5" />
      {/* arrows */}
      {dLabel(0, -26, "↑", 2)}{dLabel(0, 26, "↓", 3)}{dLabel(-26, 0, "←", 0)}{dLabel(26, 0, "→", 1)}
      {/* d-pad indices in accent, just outside each arm */}
      <text x={dcx - 50} y={dcy - 18} textAnchor="middle" fill={ACC} fontSize="12" fontFamily="monospace">0</text>
      <text x={dcx + 50} y={dcy - 18} textAnchor="middle" fill={ACC} fontSize="12" fontFamily="monospace">1</text>
      <text x={dcx} y={dcy - 48} textAnchor="middle" fill={ACC} fontSize="12" fontFamily="monospace">2</text>
      <text x={dcx} y={dcy + 60} textAnchor="middle" fill={ACC} fontSize="12" fontFamily="monospace">3</text>

      {/* FACE BUTTONS (right): C B A on a diagonal, PICO-8-ish */}
      {P(300, 118, "A", 4, "#57e2e5")}
      {P(340, 96, "B", 5, "#ffd45e")}
      {P(380, 74, "C", 6, "#ff7ac6")}

      {/* START */}
      <rect x="208" y="150" width="54" height="16" rx="8" fill="#2a2f42" stroke="#0c0e14" strokeWidth="1.5" />
      <text x="235" y="162" textAnchor="middle" fill="#cbd2de" fontSize="10" fontWeight="700">START</text>
      <text x="235" y="146" textAnchor="middle" fill={ACC} fontSize="12" fontFamily="monospace">7</text>

      {/* legend */}
      <text x="235" y="192" textAnchor="middle" fill={DIM} fontSize="11" fontFamily="monospace">btn(i) · btn(i, 1) = player 2 · ⬅️➡️⬆️⬇️🅾️❎ = 0-5</text>
    </svg>
  );
}

// --- 4. sprite-sheet cell layout --------------------------------------------
function SheetGrid() {
  const ox = 14, oy = 34, s = 26, n = 4;   // draw a 4x3 corner of the 16x16 grid
  const cells = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < n; c++) {
    cells.push(
      <g key={`${r}-${c}`}>
        <rect x={ox + c * s} y={oy + r * s} width={s} height={s} fill="none" stroke={LINE} strokeWidth="1.5" />
        <text x={ox + c * s + s / 2} y={oy + r * s + s / 2 + 4} textAnchor="middle" fill={DIM} fontSize="11" fontFamily="monospace">{r * 16 + c}</text>
      </g>
    );
  }
  return (
    <svg className="cheat-svg" viewBox="0 0 460 150" role="img" aria-label="sprite sheet cell layout">
      <text x={ox} y="22" fill={GRAPE} fontSize="12">sheet cells 0-255 (16 across)</text>
      {cells}
      {/* ellipsis to imply continuation */}
      <text x={ox + n * s + 6} y={oy + s / 2 + 4} fill={DIM} fontSize="13">…</text>
      <text x={ox + s / 2} y={oy + 3 * s + 16} fill={DIM} fontSize="13">⋮</text>
      {/* the perf note */}
      <text x="180" y="48" fill={INK} fontSize="13">a blit costs ~the same setup</text>
      <text x="180" y="66" fill={INK} fontSize="13"><tspan fill={SUN}>REGARDLESS</tspan> of size - so</text>
      <text x="180" y="84" fill={INK} fontSize="13">ONE big blit beats many</text>
      <text x="180" y="102" fill={INK} fontSize="13">tiny ones. That's why the</text>
      <text x="180" y="120" fill={INK} fontSize="13"><tspan fill={ACC} fontFamily="monospace">gt.*</tspan> engines batch wide.</text>
    </svg>
  );
}

// Detect which diagram a raw ASCII code block is (by a stable content signature),
// return the matching component or null (leave it as a normal <pre>).
export function diagramFor(text) {
  if (/CPU\s+65C02/.test(text) && /Blitter/.test(text)) return <SpecTable />;
  if (/button\s*→?\s*index/.test(text) || (/LEFT 0/.test(text) && /START 7/.test(text))) return <Controller />;
  if (/\(0,0\)/.test(text) && /\(127,127\)/.test(text)) return <CoordFrame />;
  if (/0\.75 \(up\)/.test(text) || (/sin\(0\.25\)/.test(text) && /one full turn/.test(text))) return <TrigCircle />;
  if (/sheet cell layout/.test(text)) return <SheetGrid />;
  return null;
}
