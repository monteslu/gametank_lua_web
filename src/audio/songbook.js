// songbook.js - the project's music.json holds MULTIPLE .gtm2 songs.
//
// GameTank plays one song at a time with song(tune); a game can carry several
// (title / level / boss) and switch between them. We persist them as a songbook
// envelope: { v: 2, songs: [{ name, model }, ...], current }. Each `model` is the
// MusicEditor's tracker grid model ({ steps, delay, instruments, grid, velocity }).
//
// Back-compat: an older music.json is a BARE single model object (has .grid /
// .steps). parseSongbook wraps it as a one-song book so old projects keep working.

let untitledSeq = 0;

/** A safe, unique-ish default name for a new song within a book. */
export function defaultSongName(book) {
  const used = new Set((book?.songs ?? []).map((s) => s.name));
  let n = book?.songs?.length ?? 0;
  let name;
  do { name = `song ${n}`; n++; } while (used.has(name));
  return name;
}

/** Is this a bare tracker model (the pre-songbook music.json shape)? */
function isBareModel(o) {
  return o && typeof o === "object" && Array.isArray(o.grid) && !Array.isArray(o.songs);
}

// Note-convention migration. Grids saved before v3 used the OLD note bytes
// (1-based-MIDI: A4 = 70); v3 grids store the console's official pitch-table
// index (A4 = 57 = MIDI - 12, the byte Clyde's tools read/write and the SDK
// keys unshifted). Shift old cells -13 so a song previews AND plays at the
// pitch its author composed. 0 stays 0 (rest); results clamp to 1..107.
function migrateModelNotes(model) {
  const mig = (n) => (n ? Math.max(1, Math.min(107, n - 13)) : 0);
  const grid = (model.grid || []).map((row) => (row || []).map((cell) => {
    if (cell && typeof cell === "object") return { ...cell, note: mig(cell.note | 0) };
    return mig(cell | 0);
  }));
  return { ...model, grid };
}

/**
 * Parse a stored music.json (string or object) into a songbook. Accepts:
 *  - a v3 songbook envelope (current: new note bytes, returned as-is)
 *  - a v2 envelope or bare single model (old note bytes: migrated -13)
 *  - null/undefined/"" (returns null - no music)
 * @returns {{ songs: {name:string, model:object}[], current:number } | null}
 */
export function parseSongbook(raw) {
  if (!raw) return null;
  const o = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!o) return null;
  if (Array.isArray(o.songs)) {
    const old = (o.v | 0) < 3;
    const songs = o.songs
      .filter((s) => s && s.model)
      .map((s, i) => ({ name: String(s.name ?? `song ${i}`), model: old ? migrateModelNotes(s.model) : s.model }));
    if (!songs.length) return null;
    const current = Math.min(Math.max(0, o.current | 0), songs.length - 1);
    return { songs, current };
  }
  if (isBareModel(o)) return { songs: [{ name: "song 0", model: migrateModelNotes(o) }], current: 0 };
  return null;
}

/** Serialize a songbook to the stored envelope string (v3 = official note bytes). */
export function serializeSongbook(book) {
  return JSON.stringify({ v: 3, songs: book.songs, current: book.current });
}

/** A lua-identifier-safe variable name derived from a song's name. */
export function songVarName(name, index) {
  const id = String(name || "").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  if (!id || /^[0-9]/.test(id)) return `tune${index}`;
  return id;
}
