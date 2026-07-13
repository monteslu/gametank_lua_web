// gametank-host.js - run a GameTank .gtr in the browser.
//
// The browser port of the SDK's bin/gtlua-run.mjs (the node-sdl host). The
// libretro wiring is identical - env/video/audio/input callbacks, av_info
// offsets, the pad map - only the present layer (canvas instead of node-sdl)
// and the audio sink (Web Audio instead of an SDL device) differ. The core
// glue is node-targeted (-sENVIRONMENT=node); we fetch its text and flip the
// env flags to web, same trick browser-toolchain.js uses for cc65, so we run
// the SDK's published core verbatim.
//
// GameTank pad (libretro RetroPad id -> GameTank btn index 0-3 d-pad, 4=A,
// 5=B, 6=C, 7=START). btn() indices per the SDK.

const CORE_BASE = "/core";

const RETRO_DEVICE_JOYPAD = 1;
const RETRO_PIXEL_FORMAT_XRGB8888 = 1;
const RETRO_PIXEL_FORMAT_RGB565 = 2;

// libretro RetroPad button ids (what retro_set_input_state is queried with)
export const PAD = { B: 0, Y: 1, SELECT: 2, START: 3, UP: 4, DOWN: 5, LEFT: 6, RIGHT: 7, A: 8, X: 9 };

// gt-lua btn(n) index -> the RetroPad id the core expects.
//   0 UP  1 DOWN  2 LEFT  3 RIGHT  4 A  5 B  6 C  7 START
export const GT_BTN = [PAD.UP, PAD.DOWN, PAD.LEFT, PAD.RIGHT, PAD.A, PAD.B, PAD.Y, PAD.START];

let factoryPromise = null;
// Load + env-flip the core glue once (cached for the page's life).
async function loadCoreFactory() {
  if (factoryPromise) return factoryPromise;
  factoryPromise = (async () => {
    const [glueText, wasmBinary] = await Promise.all([
      fetch(`${CORE_BASE}/gametank_libretro.js`).then((r) => r.text()),
      fetch(`${CORE_BASE}/gametank_libretro.wasm`).then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b)),
    ]);
    const patched = glueText
      .replace("var ENVIRONMENT_IS_WORKER=false", "var ENVIRONMENT_IS_WORKER=true")
      .replace("var ENVIRONMENT_IS_NODE=true", "var ENVIRONMENT_IS_NODE=false");
    const blobUrl = URL.createObjectURL(new Blob([patched], { type: "text/javascript" }));
    const mod = await import(/* @vite-ignore */ blobUrl);
    URL.revokeObjectURL(blobUrl);
    return { factory: mod.default, wasmBinary };
  })();
  return factoryPromise;
}

/**
 * A running GameTank instance bound to a canvas. One host per loaded cart;
 * call dispose() before loading another.
 */
export class GameTankHost {
  constructor() {
    this.mod = null;
    this.canvas = null;
    this.ctx = null;
    this.imageData = null;      // reused ImageData sized to the framebuffer
    this.running = false;
    this._rafId = 0;
    this.buttons = new Uint8Array(16);
    this._latestFrame = null;   // { ptr, width, height, pitch }
    this._pixelFormat = RETRO_PIXEL_FORMAT_XRGB8888;
    this.fbWidth = 128;
    this.fbHeight = 128;
    this.fps = 60;
    this.sampleRate = 44100;
    // audio
    this._audioCtx = null;
    this._nextAudioTime = 0;
  }

  /** Load the core and a cart. romBytes is a Uint8Array of the .gtr. */
  async load(romBytes) {
    const { factory, wasmBinary } = await loadCoreFactory();
    const mod = await factory({ wasmBinary, locateFile: (p) => p });
    this.mod = mod;

    // --- libretro callback wiring (identical to gtlua-run.mjs) -------------
    const envCb = mod.addFunction((cmd, dataPtr) => {
      if (cmd === 10) { this._pixelFormat = mod.HEAP32[dataPtr >> 2]; return 1; } // SET_PIXEL_FORMAT
      return 0;
    }, "iii");
    mod._retro_set_environment(envCb);

    const videoCb = mod.addFunction((dataPtr, width, height, pitch) => {
      if (dataPtr) this._latestFrame = { ptr: dataPtr, width, height, pitch };
      this.fbWidth = width; this.fbHeight = height;
    }, "viiii");
    mod._retro_set_video_refresh(videoCb);

    this._audioQueue = [];
    const audioBatchCb = mod.addFunction((dataPtr, frames) => {
      const n = frames * 2;                      // interleaved s16 stereo
      const src = new Int16Array(mod.HEAP16.buffer, dataPtr, n);
      this._audioQueue.push(Int16Array.from(src));
      return frames;
    }, "iii");
    mod._retro_set_audio_sample_batch(audioBatchCb);
    mod._retro_set_audio_sample(mod.addFunction(() => {}, "vii"));

    mod._retro_set_input_poll(mod.addFunction(() => {}, "v"));
    const inputStateCb = mod.addFunction((port, device, index, id) => {
      if (port !== 0 || device !== RETRO_DEVICE_JOYPAD) return 0;
      return this.buttons[id] ? 1 : 0;
    }, "iiiii");
    mod._retro_set_input_state(inputStateCb);

    mod._retro_init();

    // load the cart
    const romPtr = mod._malloc(romBytes.length);
    mod.HEAPU8.set(romBytes, romPtr);
    const info = mod._malloc(24);
    mod.HEAPU32[(info >> 2) + 0] = 0;                 // path = NULL
    mod.HEAPU32[(info >> 2) + 1] = romPtr;            // data
    mod.HEAPU32[(info >> 2) + 2] = romBytes.length;   // size
    mod.HEAPU32[(info >> 2) + 3] = 0;                 // meta = NULL
    if (!mod._retro_load_game(info)) throw new Error("retro_load_game failed");

    // av_info: geometry (5x u32) + pad, then timing doubles at offset 24/32.
    const av = mod._malloc(64);
    mod._retro_get_system_av_info(av);
    const dv = new DataView(mod.HEAPU8.buffer, av, 64);
    this.fps = dv.getFloat64(24, true) || 60;
    this.sampleRate = dv.getFloat64(32, true) || 44100;
    return this;
  }

  /** Bind to a canvas and start the frame loop. */
  start(canvas) {
    if (!this.mod) throw new Error("load() a cart before start()");
    this.canvas = canvas;
    this.canvas.width = this.fbWidth;
    this.canvas.height = this.fbHeight;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.ctx.imageSmoothingEnabled = false;   // crisp pixels; CSS does the scaling
    this.imageData = this.ctx.createImageData(this.fbWidth, this.fbHeight);
    this.running = true;
    this._loop();
  }

  pause() {
    this.running = false;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = 0;
    // silence + freeze audio: suspend the context so no queued buffer keeps
    // playing, and reset the schedule cursor so resume() doesn't try to schedule
    // in the past (which would burst-play a backlog).
    if (this._audioCtx && this._audioCtx.state === "running") {
      try { this._audioCtx.suspend(); } catch { /* ignore */ }
    }
    if (this._audioQueue) this._audioQueue.length = 0;
  }

  resume() {
    if (this.running || !this.mod) return;
    this.running = true;
    if (this._audioCtx) {
      try { this._audioCtx.resume(); } catch { /* ignore */ }
      this._nextAudioTime = this._audioCtx.currentTime;
    }
    this._loop();
  }

  /** True while the loop is stopped (paused) but the cart is still loaded. */
  isPaused() { return !this.running && !!this.mod; }

  /** Hardware reset (re-runs the cart from the reset vector). */
  reset() { if (this.mod) this.mod._retro_reset(); }

  // --- memory access (the debugger's RAM view) ----------------------------
  // RETRO_MEMORY_SYSTEM_RAM = 2. The core exposes the 65C02 system RAM via
  // retro_get_memory_data/size; we read/write it live through the WASM heap.
  _ramView() {
    const mod = this.mod;
    if (!mod) return null;
    const ptr = mod._retro_get_memory_data(2);
    const size = mod._retro_get_memory_size(2);
    if (!ptr || !size) return null;
    return new Uint8Array(mod.HEAPU8.buffer, ptr, size);
  }
  /** System RAM size in bytes (0 if unavailable). */
  ramSize() { const v = this._ramView(); return v ? v.length : 0; }
  /** Read `len` bytes of system RAM starting at `addr` (a copy). */
  readRam(addr = 0, len) {
    const v = this._ramView();
    if (!v) return new Uint8Array(0);
    const end = len === undefined ? v.length : Math.min(v.length, addr + len);
    return v.slice(addr, end);
  }
  /** Write one byte of system RAM. Returns true if it stuck. */
  writeRam(addr, byte) {
    const v = this._ramView();
    if (!v || addr < 0 || addr >= v.length) return false;
    v[addr] = byte & 0xff;
    return true;
  }

  /** Set a gt-lua button (0-7, see GT_BTN) down/up. */
  setButton(gtIndex, down) {
    const id = GT_BTN[gtIndex];
    if (id !== undefined) this.buttons[id] = down ? 1 : 0;
  }

  /** Set a RetroPad id (PAD.*) directly. */
  setPad(padId, down) { this.buttons[padId] = down ? 1 : 0; }

  _loop = () => {
    if (!this.running || !this.mod) return;
    this.mod._retro_run();
    this._present();
    this._flushAudio();
    this._rafId = requestAnimationFrame(this._loop);
  };

  _present() {
    const f = this._latestFrame;
    if (!f) return;
    const { ptr, width, height, pitch } = f;
    if (width !== this.imageData.width || height !== this.imageData.height) {
      this.canvas.width = width; this.canvas.height = height;
      this.imageData = this.ctx.createImageData(width, height);
    }
    const out = this.imageData.data;      // RGBA Uint8ClampedArray
    const mod = this.mod;
    if (this._pixelFormat === RETRO_PIXEL_FORMAT_RGB565) {
      const src = new Uint16Array(mod.HEAP16.buffer, ptr, (pitch / 2) * height);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const p = src[y * (pitch / 2) + x], o = (y * width + x) * 4;
        out[o] = ((p >> 11) & 0x1f) << 3; out[o + 1] = ((p >> 5) & 0x3f) << 2; out[o + 2] = (p & 0x1f) << 3; out[o + 3] = 255;
      }
    } else {
      // XRGB8888 in memory is BGRA byte order -> RGBA
      const src = new Uint8Array(mod.HEAPU8.buffer, ptr, pitch * height);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const s = y * pitch + x * 4, o = (y * width + x) * 4;
        out[o] = src[s + 2]; out[o + 1] = src[s + 1]; out[o + 2] = src[s]; out[o + 3] = 255;
      }
    }
    this.ctx.putImageData(this.imageData, 0, 0);
  }

  // Create/resume the AudioContext from a USER GESTURE (a click on the emulator).
  // Browsers start a context suspended until a gesture, so audio created purely
  // from the frame loop stays silent forever - call this on click to unmute.
  unlockAudio() {
    if (!this._audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this._audioCtx = new AC({ sampleRate: this.sampleRate });
      this._nextAudioTime = this._audioCtx.currentTime;
    }
    if (this._audioCtx.state === "suspended") this._audioCtx.resume();
  }

  _flushAudio() {
    if (!this._audioQueue || !this._audioQueue.length) return;
    // Lazily create the AudioContext on first audio (may be suspended until the
    // user clicks the screen - unlockAudio() resumes it).
    if (!this._audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this._audioCtx = new AC({ sampleRate: this.sampleRate });
      this._nextAudioTime = this._audioCtx.currentTime;
    }
    const ctx = this._audioCtx;
    for (const chunk of this._audioQueue) {
      const frames = chunk.length / 2;
      if (!frames) continue;
      const buf = ctx.createBuffer(2, frames, this.sampleRate);
      const L = buf.getChannelData(0), R = buf.getChannelData(1);
      for (let i = 0; i < frames; i++) {
        L[i] = chunk[i * 2] / 32768;
        R[i] = chunk[i * 2 + 1] / 32768;
      }
      const node = ctx.createBufferSource();
      node.buffer = buf;
      node.connect(ctx.destination);
      // schedule back-to-back; if we've fallen behind, catch up to now
      const now = ctx.currentTime;
      if (this._nextAudioTime < now) this._nextAudioTime = now;
      node.start(this._nextAudioTime);
      this._nextAudioTime += frames / this.sampleRate;
    }
    this._audioQueue.length = 0;
  }

  dispose() {
    this.pause();
    const mod = this.mod;
    if (mod) {
      try { mod._retro_unload_game(); mod._retro_deinit(); } catch { /* ignore */ }
    }
    if (this._audioCtx) { try { this._audioCtx.close(); } catch { /* ignore */ } this._audioCtx = null; }
    this.mod = null;
    this._latestFrame = null;
  }
}
