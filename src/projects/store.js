// store.js - project persistence in IndexedDB. Raw IDB (no dep).
//
// A project is { id, name, files: { path: string|Uint8Array }, createdAt,
// updatedAt }. `files` holds text (main.lua) and binary assets (.gtg/.gsi/...)
// keyed by project-relative path. IndexedDB (not localStorage) because assets
// are binary and can exceed localStorage's ~5MB.

const DB_NAME = "gtlua-ide";
const DB_VERSION = 1;
const STORE = "projects";

let dbPromise = null;
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let result;
    Promise.resolve(fn(store)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const reqP = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

// a short, url-safe-ish id without a dependency (time-free: crypto random)
function newId() {
  const a = new Uint8Array(9);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 12);
}

/** List all projects (newest updated first), without their file bodies. */
export async function listProjects() {
  const all = await tx("readonly", (s) => reqP(s.getAll()));
  return all
    .map(({ id, name, createdAt, updatedAt }) => ({ id, name, createdAt, updatedAt }))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/** Get one project (with files) by id, or null. */
export async function getProject(id) {
  return (await tx("readonly", (s) => reqP(s.get(id)))) || null;
}

/** Create a new project. Returns the stored record. */
export async function createProject(name, files, nowMs) {
  const rec = {
    id: newId(),
    name: name || "untitled",
    files: files || { "main.lua": "" },
    createdAt: nowMs || 0,
    updatedAt: nowMs || 0,
  };
  await tx("readwrite", (s) => s.put(rec));
  return rec;
}

/** Persist a project record (upsert). Stamps updatedAt if nowMs given. */
export async function saveProject(rec, nowMs) {
  const out = { ...rec, updatedAt: nowMs ?? rec.updatedAt ?? 0 };
  await tx("readwrite", (s) => s.put(out));
  return out;
}

/** Delete a project by id. */
export async function deleteProject(id) {
  await tx("readwrite", (s) => s.delete(id));
}
