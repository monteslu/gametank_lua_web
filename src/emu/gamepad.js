// gamepad.js — the GameTank binding for luacretro-web's shared gamepad layer.
//
// The polling, persistence and remap-capture logic live in the shared layer.
// What is genuinely GameTank-specific is the 8-input table (A/B/C sending
// RetroPad B/Y/A, per the core's poll_pad wiring) and the standard-pad
// defaults, both preserved here exactly as they were.
import { createGamepad } from "luacretro-web/input";
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

const gp = createGamepad({
  inputs: GT_INPUTS,
  standardBinds: STANDARD_BINDS,
  storagePrefix: "gt-gamepad-map:",
  // this IDE reads the by-key shape and drives the pad itself, so the shared
  // analog-stick-as-d-pad fold in pollGamepads does not apply here
  analogDpad: false,
});

export const {
  loadMapping, saveMapping, removeMapping,
  bindsFor, srcActive, firstConnected, firstUnmapped,
} = gp;

/**
 * Poll every connected gamepad and OR their GameTank inputs into one pad state.
 * Returns { pressed: Set<key>, active: gamepad[] } — `active` is the list of
 * connected pads (for the "needs mapping" prompt in the UI).
 */
export const pollGamepads = gp.pollPressed;
