// cc65-glue.js - our own minimal loader for the cc65/ca65/ld65 WASM modules.
//
// STATUS: WORKS. Runs cc65/ca65/ld65 correctly (fixed: fd_read must skip empty
// iovec slots not stop; fd_seek takes a single i64 offset as BigInt, not lo/hi).
// Output is currently 1-2 bytes off native on some .o (a small embedded file
// metadata diff, same class the 0.1.3 reproducibility fix addressed) - cosmetic,
// being chased. Env-neutral: same code in node or browser.
//
// The emscripten-generated glue is ~50KB of environment-detection cruft
// (ENVIRONMENT_IS_NODE, createRequire, three ways to fetch the wasm...). We
// don't need any of it: WASM is WASM. This hand-written glue instantiates the
// .wasm directly against a small in-memory filesystem, sets up argv, and calls
// the entry point. Our VFS IS the filesystem the tool sees - no MEMFS layer.
//
// The tools are single-shot command-line programs: they openat/read/write/stat
// a handful of files, print diagnostics to stderr, and exit. We back exactly
// the syscalls + WASI ops the three wasm modules import (measured), over a Map
// of path -> Uint8Array.

const PAGE = 65536;

// errno values we return (negated) from failing syscalls
const ENOENT = 44;   // emscripten/musl errno for "no such file" (see below)

/**
 * @typedef {{ path: string, data: Uint8Array, len: number, pos: number, write: boolean }} OpenFile
 */

/**
 * Instantiate a cc65-family tool.
 * @param {Uint8Array} wasmBinary
 * @param {object} opts
 * @param {Map<string,Uint8Array>} opts.fs   the VFS (absolute paths). Mutated: the tool writes outputs here.
 * @param {string[]} opts.argv                argv[0] is the program name
 * @param {(s:string)=>void} [opts.print]     stdout line sink
 * @param {(s:string)=>void} [opts.printErr]  stderr line sink
 * @returns {Promise<number>} exit status
 */
export async function runWasmTool(wasmBinary, { fs, argv, print, printErr }) {
  let exitCode = 0;
  let exited = false;
  let instance;
  let mem, HEAPU8, HEAPU32;

  const refreshViews = () => {
    const b = mem.buffer;
    HEAPU8 = new Uint8Array(b);
    HEAPU32 = new Uint32Array(b);
  };

  const utf8 = new TextDecoder();
  const enc = new TextEncoder();
  const cstr = (ptr) => {
    let end = ptr;
    while (HEAPU8[end] !== 0) end++;
    return utf8.decode(HEAPU8.subarray(ptr, end));
  };

  // ---- in-memory FS over the VFS Map --------------------------------------
  // fd 0/1/2 are stdin/stdout/stderr; real files start at 3.
  const CWD = "/work";
  const norm = (p) => {
    if (!p.startsWith("/")) p = CWD + "/" + p;
    const parts = [];
    for (const seg of p.split("/")) {
      if (seg === "" || seg === ".") continue;
      if (seg === "..") parts.pop();
      else parts.push(seg);
    }
    return "/" + parts.join("/");
  };
  /** @type {Map<number, OpenFile>} */
  const openFiles = new Map();
  let nextFd = 3;
  let outLine = ["", ""]; // buffered stdout/stderr partial lines (by fd 1/2)

  const emitTo = (fd, bytes) => {
    const sink = fd === 1 ? print : printErr;
    if (!sink) return;
    let s = outLine[fd - 1] + utf8.decode(bytes);
    const lines = s.split("\n");
    outLine[fd - 1] = lines.pop();
    for (const line of lines) sink(line);
  };

  // ---- imports ------------------------------------------------------------
  const env = {
    exit: (code) => { exitCode = code; exited = true; throw new ExitError(code); },
    _abort_js: () => { throw new Error("wasm abort"); },
    emscripten_date_now: () => Date.now(),
    // struct tm writers - cc65 stamps the .s header with the build date. Must
    // write the full struct (emscripten's exact layout) or cc65 reads garbage.
    _tzset_js: (timezonePtr, daylightPtr, stdNamePtr, dstNamePtr) => {
      // minimal: zero offset, no DST, "UTC" names. cc65 only needs it not to crash.
      if (timezonePtr) { HEAPU32[timezonePtr >> 2] = 0; }
      if (daylightPtr) { HEAPU32[daylightPtr >> 2] = 0; }
    },
    // _localtime_js receives a 64-bit time_t. On wasm32 an i64 import param
    // arrives as a BigInt; accept (timeLo/timeHi) or a BigInt depending on how
    // the binding lowers it - normalize both.
    _localtime_js: (time, tmPtr) => {
      const t = typeof time === "bigint" ? Number(time) : time;
      const d = new Date(t * 1000);
      const H = HEAPU32; const base = tmPtr >> 2;
      HEAPU32[base + 0] = d.getUTCSeconds();
      HEAPU32[base + 1] = d.getUTCMinutes();
      HEAPU32[base + 2] = d.getUTCHours();
      HEAPU32[base + 3] = d.getUTCDate();
      HEAPU32[base + 4] = d.getUTCMonth();
      HEAPU32[base + 5] = d.getUTCFullYear() - 1900;
      HEAPU32[base + 6] = d.getUTCDay();
      const start = Date.UTC(d.getUTCFullYear(), 0, 1);
      HEAPU32[base + 7] = Math.floor((d.getTime() - start) / 86400000);
      HEAPU32[base + 8] = 0;   // tm_isdst
    },
    emscripten_resize_heap: (requested) => {
      // grow linear memory to satisfy the request
      const cur = mem.buffer.byteLength;
      const want = Math.max(requested >>> 0, cur + PAGE);
      const pages = Math.ceil((want - cur) / PAGE);
      try { mem.grow(pages); refreshViews(); return 1; } catch { return 0; }
    },

    // --- syscalls (emscripten SYSCALLS convention: return -errno on failure) ---
    __syscall_openat: (dirfd, pathPtr, flags, varargs) => {
      const p = norm(cstr(pathPtr));
      const O_CREAT = 64, O_WRONLY = 1, O_RDWR = 2, O_TRUNC = 512;
      const acc = flags & 3;
      const wantWrite = acc === O_WRONLY || acc === O_RDWR || (flags & O_CREAT);
      let data = fs.get(p);
      if (!data) {
        if (flags & O_CREAT) { data = new Uint8Array(0); fs.set(p, data); }
        else return -ENOENT;
      }
      if (flags & O_TRUNC) { data = new Uint8Array(0); fs.set(p, data); }
      const fd = nextFd++;
      openFiles.set(fd, { path: p, data: fs.get(p), len: fs.get(p).length, pos: 0, write: !!wantWrite });
      return fd;
    },
    __syscall_stat64: (pathPtr, bufPtr) => {
      const p = norm(cstr(pathPtr));
      const data = fs.get(p);
      if (!data) return -ENOENT;
      writeStat(bufPtr, data.length);
      return 0;
    },
    __syscall_faccessat: (dirfd, pathPtr) => (fs.has(norm(cstr(pathPtr))) ? 0 : -ENOENT),
    __syscall_readlinkat: () => -ENOENT,           // no symlinks
    __syscall_unlinkat: (dirfd, pathPtr) => { fs.delete(norm(cstr(pathPtr))); return 0; },
    __syscall_rmdir: () => 0,
    __syscall_getcwd: (bufPtr, size) => {
      const bytes = enc.encode(CWD);
      if (bytes.length + 1 > size) return -1;
      HEAPU8.set(bytes, bufPtr); HEAPU8[bufPtr + bytes.length] = 0;
      return bytes.length + 1;
    },
    __syscall_fcntl64: () => 0,
    __syscall_ioctl: () => 0,
  };

  // musl stat struct: we only need st_size (offset 48 in the wasm32 layout emcc uses).
  function writeStat(bufPtr, size) {
    // zero the struct region emcc reads (~96 bytes) then set st_size + st_mode.
    for (let i = 0; i < 96; i += 4) HEAPU32[(bufPtr >> 2) + (i >> 2)] = 0;
    // st_mode at offset 16: S_IFREG (0o100000 = 0x8000)
    HEAPU32[(bufPtr >> 2) + 4] = 0x8000;
    // st_size at offset 48 (64-bit; low word)
    HEAPU32[(bufPtr >> 2) + 12] = size >>> 0;
  }

  const wasi = {
    fd_write: (fd, iovPtr, iovCnt, pWritten) => {
      let written = 0;
      for (let i = 0; i < iovCnt; i++) {
        const base = HEAPU32[(iovPtr >> 2) + i * 2];
        const len = HEAPU32[(iovPtr >> 2) + i * 2 + 1];
        const chunk = HEAPU8.subarray(base, base + len);
        if (fd === 1 || fd === 2) emitTo(fd, chunk);
        else appendToFile(fd, chunk);
        written += len;
      }
      HEAPU32[pWritten >> 2] = written;
      return 0;
    },
    fd_read: (fd, iovPtr, iovCnt, pRead) => {
      const f = openFiles.get(fd);
      let read = 0;
      for (let i = 0; i < iovCnt && f; i++) {
        const base = HEAPU32[(iovPtr >> 2) + i * 2];
        const len = HEAPU32[(iovPtr >> 2) + i * 2 + 1];
        if (len === 0) continue;                       // empty iovec slot - skip, don't stop
        const avail = Math.min(len, f.data.length - f.pos);
        if (avail <= 0) break;                          // genuine EOF - stop
        HEAPU8.set(f.data.subarray(f.pos, f.pos + avail), base);
        f.pos += avail; read += avail;
        if (avail < len) break;                         // partial fill = hit EOF this iovec
      }
      HEAPU32[pRead >> 2] = read;
      return 0;
    },
    fd_close: (fd) => { openFiles.delete(fd); return 0; },
    // WASI fd_seek(fd, offset:i64, whence, newOffset). The offset is a single
    // 64-bit value delivered as a BigInt (NOT a lo/hi i32 pair - getting the
    // signature wrong shifts whence/newOffset and yields EOVERFLOW on write).
    fd_seek: (fd, offset, whence, pNewOff) => {
      const f = openFiles.get(fd);
      if (!f) return 8; // EBADF
      const off = typeof offset === "bigint" ? Number(offset) : offset;
      if (whence === 0) f.pos = off;                        // SEEK_SET
      else if (whence === 1) f.pos += off;                  // SEEK_CUR
      else if (whence === 2) f.pos = f.data.length + off;   // SEEK_END
      // newOffset is a 64-bit result; write it as i64 (lo, hi).
      HEAPU32[pNewOff >> 2] = f.pos >>> 0;
      HEAPU32[(pNewOff >> 2) + 1] = 0;
      return 0;
    },
    fd_fdstat_get: (fd, bufPtr) => {
      // filetype at byte 0: 4 = regular file (2 = char device for stdio)
      HEAPU8[bufPtr] = fd <= 2 ? 2 : 4;
      HEAPU8[bufPtr + 1] = 0;
      HEAPU32[(bufPtr >> 2) + 1] = 0; // flags
      HEAPU32[(bufPtr >> 2) + 2] = 0; // rights (lo)
      HEAPU32[(bufPtr >> 2) + 3] = 0;
      return 0;
    },
    environ_sizes_get: (pCount, pBufSize) => { HEAPU32[pCount >> 2] = 0; HEAPU32[pBufSize >> 2] = 0; return 0; },
    environ_get: () => 0,
  };

  function appendToFile(fd, chunk) {
    const f = openFiles.get(fd);
    if (!f) return;
    // grow the file's backing array and commit to the VFS
    const grown = new Uint8Array(Math.max(f.data.length, f.pos + chunk.length));
    grown.set(f.data);
    grown.set(chunk, f.pos);
    f.data = grown; f.pos += chunk.length; f.len = grown.length;
    fs.set(f.path, grown);
  }

  // ---- instantiate --------------------------------------------------------
  const { instance: inst } = await WebAssembly.instantiate(wasmBinary, {
    env,
    wasi_snapshot_preview1: wasi,
  });
  instance = inst;
  mem = instance.exports.memory;
  refreshViews();

  // run static constructors, then main(argc, argv).
  try {
    instance.exports.__wasm_call_ctors?.();
    const argvPtr = layoutArgv(argv, instance, HEAPU8, HEAPU32, () => { refreshViews(); return HEAPU32; });
    const rc = instance.exports.__main_argc_argv(argv.length, argvPtr);
    if (!exited) exitCode = rc >>> 0;
  } catch (e) {
    if (!(e instanceof ExitError)) {
      // a genuine trap (not the exit() we throw) - surface it as a failed build
      if (printErr) printErr(`[wasm] ${e?.message ?? e}`);
      if (exitCode === 0) exitCode = 1;
    }
  }

  // flush any partial stdout/stderr lines
  if (outLine[0] && print) print(outLine[0]);
  if (outLine[1] && printErr) printErr(outLine[1]);

  return exitCode;
}

class ExitError extends Error { constructor(code) { super("exit " + code); this.code = code; } }

// Write argv into wasm memory using the module's stack allocator, return the
// pointer to the char** array.
function layoutArgv(argv, instance, HEAPU8, HEAPU32, refresh) {
  const enc = new TextEncoder();
  const stackAlloc = instance.exports._emscripten_stack_alloc;
  // Match emscripten's order exactly: allocate the char* ARRAY first, then push
  // each string onto the stack and store its pointer. (Order matters for the
  // downward-growing stack; getting it wrong left cc65's later allocations
  // overlapping the argv region and silently truncated its output.)
  const argvPtr = stackAlloc((argv.length + 1) * 4) >>> 0;
  for (let i = 0; i < argv.length; i++) {
    const bytes = enc.encode(argv[i]);
    const p = stackAlloc(bytes.length + 1) >>> 0;
    const H8 = new Uint8Array(instance.exports.memory.buffer);
    H8.set(bytes, p); H8[p + bytes.length] = 0;
    const H32 = new Uint32Array(instance.exports.memory.buffer);
    H32[(argvPtr >> 2) + i] = p;
  }
  const H32 = new Uint32Array(instance.exports.memory.buffer);
  H32[(argvPtr >> 2) + argv.length] = 0;
  return argvPtr;
}
