// manifest.js - project.json, the one manifest every gtlua project carries.
//
// GameTank's official C SDK uses a project.json ({title, romname, progbanks,
// modules}); a gtlua project follows that shape so it's recognizable to GameTank
// devs, and adds the fields the Lua toolchain needs (entry, num8). Unlike a
// PICO-8 `.p8` (one text blob with code+gfx+sfx+music stuffed inside), a .gtlua
// project is a clean multi-file bundle - main.lua, gfx.gtg, gfx.gsi, music.json -
// and project.json is the manifest that names the pieces and holds the build
// settings. This module is the single source of truth for that file: every
// entry point (new / fork / import / open / export) reads and writes through
// here so the schema and defaults never drift.

const CURRENT_VERSION = 1;

/**
 * Build a fresh manifest for a project.
 * @param {string} name project name (used to default title + romname)
 * @param {object} [extra] fields to merge (e.g. { num8: true })
 */
export function defaultManifest(name, extra = {}) {
  const safe = (name || "game").trim() || "game";
  return {
    version: CURRENT_VERSION,
    title: safe,
    entry: "main.lua",        // the Lua file that is the game (gtlua-specific)
    romname: `${slug(safe)}.gtr`,
    num8: false,              // 8.8 fixed-point build mode
    ...extra,
  };
}

/**
 * Parse + normalize whatever is in a project's files["project.json"] into a
 * complete, valid manifest. Accepts a JSON string, an object, or null/garbage;
 * ALWAYS returns a full manifest with sane defaults (so callers never branch on
 * "does this project have a manifest"). `name` supplies the fallback title.
 * Also tolerates the old export shape ({name, entry}).
 */
export function readManifest(raw, name) {
  let o = {};
  try {
    if (raw) o = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch { /* fall through to defaults */ }
  if (!o || typeof o !== "object") o = {};
  const base = defaultManifest(o.title || o.name || name);
  return {
    ...base,
    ...o,
    // normalize / coerce the fields we rely on
    version: CURRENT_VERSION,
    title: String(o.title || o.name || base.title),
    entry: String(o.entry || base.entry),
    romname: String(o.romname || base.romname),
    num8: !!o.num8,
  };
}

/** Serialize a manifest to the pretty JSON string stored in files. */
export function writeManifest(manifest) {
  return JSON.stringify(manifest, null, 2);
}

/**
 * Ensure a project's files map has a valid project.json, creating/normalizing
 * it in place. Returns the normalized manifest. Use on new/import so a project
 * always has one. `name` is the fallback title.
 */
export function ensureManifest(files, name) {
  const m = readManifest(files["project.json"], name);
  files["project.json"] = writeManifest(m);
  return m;
}

// a filesystem-safe slug for the rom name
function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "game";
}
