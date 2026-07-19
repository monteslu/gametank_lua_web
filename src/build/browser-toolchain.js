// browser-toolchain.js — cc65/ca65/ld65 as WASM in the browser.
//
// The runner itself now lives in luacretro-web/build: fetch the glue + wasm
// once, flip the emscripten env flags to web, mount the share tree and the
// caller's VFS into MEMFS, callMain, read the declared outputs back. That is
// the same shape as native cc65 and is proven byte-identical there.
//
// What stays here is only WHICH toolchain: the staged /cc65 tree.

import { cc65Toolchain } from "luacretro-web/build";

const { runTool } = cc65Toolchain("/cc65");

/**
 * Run one cc65-family tool in the browser.
 * @param {"cc65"|"ca65"|"ld65"} tool
 * @param {string[]} argv  same argv you'd pass native cc65 (VFS paths)
 * @param {Map<string,Uint8Array>} vfs  input files, keyed by absolute VFS path
 * @returns {Promise<{ status:number, stderr:string, outputs:Map<string,Uint8Array> }>}
 */
export { runTool };
