// examples.js - the bundled, forkable example games (staged into public/examples
// from the gtlua package). Fetched at runtime so the Lua stays sourced from the
// SDK, not copy-pasted into JS.

const BASE = "/examples";

let manifestPromise = null;
export function loadExampleManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch(`${BASE}/manifest.json`).then((r) => r.json()).then((m) => m.examples || []);
  }
  return manifestPromise;
}

/** Fetch an example's files: .lua as text, binary assets (.gtg/.gsi) as bytes. */
export async function loadExampleFiles(example) {
  const entries = await Promise.all(
    example.files.map(async (rel) => {
      const res = await fetch(`${BASE}/${example.name}/${rel}`);
      const val = rel.endsWith(".lua") ? await res.text() : new Uint8Array(await res.arrayBuffer());
      return [rel, val];
    }),
  );
  return Object.fromEntries(entries);
}

/**
 * Fetch an example's staged FLASH2M placement (the CLI's build/.placement.json,
 * staged as placement.json for the big ports), or null if it doesn't ship one.
 * NOT part of the forked project files; it seeds the build worker's replay
 * cache so the first-ever build links in one pass.
 */
export async function loadExamplePlacement(example) {
  try {
    const res = await fetch(`${BASE}/${example.name}/placement.json`);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch { return null; }
}
