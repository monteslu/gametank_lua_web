// gametank-host.js — the GameTank binding for the shared browser presenter.
//
// The libretro wiring + canvas/audio/input presentation now live in
// luacretro-web's WebHost (over romdev-core-host). What remains here is the
// genuinely GameTank-specific part: which core to fetch, and the button map.
//
// GameTank pad: btn() indices 0-3 d-pad, 4=A, 5=B, 6=C, 7=START.

import { WebHost, PAD as BASE_PAD } from "luacretro-web/emu";

const CORE_BASE = "/core";

// libretro RetroPad button ids (what retro_set_input_state is queried with).
// GameTank has no shoulder buttons, so this is the base set without L/R.
export const PAD = {
  B: BASE_PAD.B, Y: BASE_PAD.Y, SELECT: BASE_PAD.SELECT, START: BASE_PAD.START,
  UP: BASE_PAD.UP, DOWN: BASE_PAD.DOWN, LEFT: BASE_PAD.LEFT, RIGHT: BASE_PAD.RIGHT,
  A: BASE_PAD.A, X: BASE_PAD.X,
};

// gt-lua btn(n) index -> the RetroPad id the CORE maps to that GameTank button.
// The core (gametank-libretro poll_pad) wires: GameTank A <- RetroPad B,
// GameTank B <- RetroPad Y, GameTank C <- RetroPad A. So gt-lua's A/B/C
// (btn 4/5/6) must send RetroPad B/Y/A, NOT A/B/Y.
//   0 UP  1 DOWN  2 LEFT  3 RIGHT  4 A  5 B  6 C  7 START
export const GT_BTN = [PAD.UP, PAD.DOWN, PAD.LEFT, PAD.RIGHT, PAD.B, PAD.Y, PAD.A, PAD.START];

/**
 * A running GameTank instance bound to a canvas. One host per loaded cart;
 * call dispose() before loading another.
 */
export class GameTankHost extends WebHost {
  constructor() {
    super({
      platform: "gametank",
      coreGlueUrl: `${CORE_BASE}/gametank_libretro.js`,
      coreWasmUrl: `${CORE_BASE}/gametank_libretro.wasm`,
      buttonMap: GT_BTN,
      width: 128,          // native GameTank framebuffer
      height: 128,
      fpsFallback: 60,
    });
  }

  /**
   * Read system RAM. Keeps this IDE's original signature, where omitting `len`
   * means "to the end" (the RAM viewer relies on it); the shared host requires
   * an explicit length.
   */
  readRam(addr = 0, len) {
    const size = this.ramSize();
    if (!size) return new Uint8Array(0);
    const n = len === undefined ? size - addr : Math.min(len, size - addr);
    return super.readRam(addr, n);
  }

  /** Write one byte of system RAM. Returns true if it stuck. */
  writeRam(addr, byte) {
    if (addr < 0 || addr >= this.ramSize()) return false;
    super.writeRam(addr, byte);
    return true;
  }
}
