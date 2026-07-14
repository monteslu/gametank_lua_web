// gamepad.js - Gamepad API -> GameTank pad, with per-controller remapping.
//
// The GameTank pad is 8 inputs: UP DOWN LEFT RIGHT A B C START. This polls the
// browser Gamepad API each frame and reports which of those 8 are pressed,
// resolving each through a mapping so any controller works. A "standard"-layout
// pad (Xbox/PS, mapping === "standard") uses sensible defaults with no setup;
// anything non-standard walks through the remap flow (see GamepadMapper.jsx)
// and the result is saved per-controller id in localStorage.
//
// A mapping is: { id, binds: { UP: src, DOWN: src, ... } } where src is
//   { kind: "button", index } | { kind: "axis", index, dir: +1|-1 }
// dir handles d-pads-on-an-axis and analog sticks reported as axes.

import { PAD } from "./gametank-host.js";

// the 8 GameTank inputs, in remap-walk order, each with its PAD id
export const GT_INPUTS = [
  { key: "UP", label: "Up", pad: PAD.UP },
  { key: "DOWN", label: "Down", pad: PAD.DOWN },
  { key: "LEFT", label: "Left", pad: PAD.LEFT },
  { key: "RIGHT", label: "Right", pad: PAD.RIGHT },
  // the core maps GameTank A/B/C from RetroPad B/Y/A (gametank-libretro
  // poll_pad), so these send those RetroPad ids
  { key: "A", label: "A", pad: PAD.B },
  { key: "B", label: "B", pad: PAD.Y },
  { key: "C", label: "C", pad: PAD.A },
  { key: "START", label: "Start", pad: PAD.START },
];

const STORAGE_PREFIX = "gt-gamepad-map:";
const BUTTON_ON = 0.5;
const AXIS_ON = 0.5;

// Standard-layout default: the browser normalizes Xbox/PS pads to a fixed
// button/axis order, so these binds work for any "standard" controller.
export const STANDARD_BINDS = {
  UP: { kind: "button", index: 12 },
  DOWN: { kind: "button", index: 13 },
  LEFT: { kind: "button", index: 14 },
  RIGHT: { kind: "button", index: 15 },
  A: { kind: "button", index: 0 },   // bottom face (Cross / A)
  B: { kind: "button", index: 1 },   // right face (Circle / B)
  C: { kind: "button", index: 2 },   // left face (Square / X) -> GameTank C
  START: { kind: "button", index: 9 },
};

export function loadMapping(id) {
  try {
    const j = localStorage.getItem(STORAGE_PREFIX + id);
    return j ? JSON.parse(j) : null;
  } catch { return null; }
}
export function saveMapping(mapping) {
  try { localStorage.setItem(STORAGE_PREFIX + mapping.id, JSON.stringify(mapping)); return true; }
  catch { return false; }
}
export function removeMapping(id) {
  try { localStorage.removeItem(STORAGE_PREFIX + id); return true; } catch { return false; }
}

// The binds a controller should use right now: a saved custom map wins; else
// the standard defaults if the browser recognizes the layout; else null (needs
// mapping).
export function bindsFor(gp) {
  const saved = loadMapping(gp.id);
  if (saved) return saved.binds;
  if (gp.mapping === "standard" || gp.mapping === "xbox") return STANDARD_BINDS;
  return null;
}

// Is one source (button/axis) currently active on this raw gamepad?
export function srcActive(gp, src) {
  if (!src) return false;
  if (src.kind === "button") {
    const b = gp.buttons[src.index];
    return !!b && (b.pressed || b.value > BUTTON_ON);
  }
  // axis: active when it moves past the threshold in the bound direction
  const v = gp.axes[src.index] ?? 0;
  return src.dir > 0 ? v > AXIS_ON : v < -AXIS_ON;
}

/**
 * Poll every connected gamepad and OR their GameTank inputs into one pad state.
 * Returns { pressed: Set<key>, active: gamepad[] } - `active` is the list of
 * connected pads (for the "needs mapping" prompt in the UI).
 */
export function pollGamepads() {
  const pressed = new Set();
  const active = [];
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const gp of pads) {
    if (!gp) continue;
    active.push(gp);
    const binds = bindsFor(gp);
    if (!binds) continue;   // unmapped: contributes nothing until mapped
    for (const inp of GT_INPUTS) {
      if (srcActive(gp, binds[inp.key])) pressed.add(inp.key);
    }
  }
  return { pressed, active };
}

// A connected pad that has no usable binds (non-standard, unsaved).
export function firstUnmapped() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const gp of pads) {
    if (gp && !bindsFor(gp)) return gp;
  }
  return null;
}
