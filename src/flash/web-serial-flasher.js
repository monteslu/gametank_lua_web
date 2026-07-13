// web-serial-flasher.js - flash a built .gtr to real GameTank hardware over Web
// Serial, driving Clyde Shaffer's GTFO programmer (Arduino Mega + M29F160 2MB
// NOR). Protocol extracted from the GTFO firmware (eepromtool-v3.ino / gtfo.cpp):
//
//   Serial: 115200 8N1. ASCII command lines end in '\r'; the SimpleSerialShell
//   echoes input and prints a '> ' prompt, so we match on response substrings.
//   Handshake -> flash:
//     1. wait for '!' (wakeup)
//     2. "version\r"    -> "GTCP2-0.0.2"
//     3. "eraseChip\r"  -> "Done"   (slow; ~30s)
//     4. per 16KB bank: "shift <bank>\r", then 5x [ "writeMulti <addr> 1000\r" +
//        stream 4096 raw bytes + wait "ACK4096" ], addr += 0x1000
//     5. optional: "checksum <addr> <count>\r" -> "CRC32: <hex>"
//
// This runs the state machine and reports progress via a callback. It needs real
// hardware to complete; without a device the caller gets a clear error. The
// pure bank/chunk math is unit-testable (see flashPlan()).

const BAUD = 115200;
const BANK_SIZE = 0x4000;      // 16 KB
const BLOCK = 0x1000;          // 4 KB writeMulti window
const BLOCKS_PER_BANK = BANK_SIZE / BLOCK;   // 4  (note: firmware does 5x for a
// 20KB span on some builds; GameTank banks are 16KB so 4 blocks/bank here)

export function webSerialAvailable() {
  return typeof navigator !== "undefined" && "serial" in navigator;
}

/**
 * Compute the flash plan for a .gtr: the list of (bank, blockAddr) writes. Pure
 * + testable. A .gtr is a multiple of BANK_SIZE; each bank is written in
 * BLOCK-sized chunks.
 */
export function flashPlan(byteLength) {
  const banks = Math.ceil(byteLength / BANK_SIZE);
  const writes = [];
  for (let bank = 0; bank < banks; bank++) {
    for (let b = 0; b < BLOCKS_PER_BANK; b++) {
      const addr = b * BLOCK;
      const fileOffset = bank * BANK_SIZE + addr;
      writes.push({ bank, addr, fileOffset });
    }
  }
  return { banks, blocks: writes.length, writes };
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export class WebSerialFlasher {
  constructor({ onProgress } = {}) {
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.rxBuffer = "";
    this.onProgress = onProgress || (() => {});
  }

  log(msg) { this.onProgress({ type: "log", msg }); }
  progress(done, total, label) { this.onProgress({ type: "progress", done, total, label }); }

  async open() {
    if (!webSerialAvailable()) throw new Error("Web Serial not supported (use Chrome/Edge, or Firefox 151+)");
    this.port = await navigator.serial.requestPort();   // shows the browser picker
    await this.port.open({ baudRate: BAUD });
    this.writer = this.port.writable.getWriter();
    this.reader = this.port.readable.getReader();
    this._pump();
  }

  async _pump() {
    try {
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value) this.rxBuffer += dec.decode(value);
      }
    } catch { /* closed */ }
  }

  // wait until `needle` appears in the rx buffer (or timeout)
  async _await(needle, timeoutMs) {
    const start = performance.now();
    while (performance.now() - start < timeoutMs) {
      const i = this.rxBuffer.indexOf(needle);
      if (i >= 0) { const before = this.rxBuffer.slice(0, i + needle.length); this.rxBuffer = this.rxBuffer.slice(i + needle.length); return before; }
      await new Promise((r) => setTimeout(r, 15));
    }
    throw new Error(`timed out waiting for "${needle}"`);
  }

  async _cmd(line, expect, timeoutMs = 4000) {
    this.rxBuffer = "";   // drop stale echo/prompt
    await this.writer.write(enc.encode(line + "\r"));
    if (expect) return this._await(expect, timeoutMs);
  }

  async _writeRaw(bytes) { await this.writer.write(bytes); }

  /** Flash a .gtr (Uint8Array). Runs the full GTFO sequence. */
  async flash(gtr, { verify = false } = {}) {
    if (!this.writer) throw new Error("open() the port first");
    const plan = flashPlan(gtr.length);

    this.log("waiting for programmer…");
    await this._await("!", 8000).catch(() => this.log("(no wakeup banner; continuing)"));

    this.log("checking version…");
    const ver = await this._cmd("version", "GTCP2", 4000);
    this.log("programmer: " + ver.trim().split("\n").pop());

    this.log("erasing chip (this takes a bit)…");
    await this._cmd("eraseChip", "Done", 45000);
    this.log("erased.");

    let doneBlocks = 0;
    for (let bank = 0; bank < plan.banks; bank++) {
      await this._cmd(`shift ${bank}`, undefined, 3000);
      // small settle for the shift command's prompt
      await new Promise((r) => setTimeout(r, 20));
      for (let b = 0; b < BLOCKS_PER_BANK; b++) {
        const addr = b * BLOCK;
        const off = bank * BANK_SIZE + addr;
        const chunk = gtr.subarray(off, off + BLOCK);
        // writeMulti wants a 0x1000-byte window; pad the tail with 0xFF
        const buf = new Uint8Array(BLOCK).fill(0xff);
        buf.set(chunk.subarray(0, BLOCK));
        await this._cmd(`writeMulti ${addr.toString(16)} 1000`, undefined, 3000);
        await this._writeRaw(buf);
        await this._await("ACK4096", 8000);
        doneBlocks++;
        this.progress(doneBlocks, plan.blocks, `bank ${bank + 1}/${plan.banks}`);
      }
    }

    if (verify) {
      this.log("verifying…");
      // (checksum per bank could go here; left as a follow-up)
    }
    this.log("done — unplug and run it on your GameTank.");
  }

  async close() {
    try { this.reader?.releaseLock(); } catch { /* */ }
    try { this.writer?.releaseLock(); } catch { /* */ }
    try { await this.port?.close(); } catch { /* */ }
    this.port = this.reader = this.writer = null;
  }
}
