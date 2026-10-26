import { emit, uid } from "../core/state.js";
import { BUILTIN_WALLPAPERS } from "../core/builtin-assets.js";

const WALL_DIR = "assets/wallpapers/";
const MAX_BYTES = 40 * 1024 * 1024; // batas ukuran satu gambar
const IMG_EXT = /\.(jpe?g|png|webp|avif|gif|bmp)$/i;
const prettyName = (file) => {
  const base = file.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || "Wallpaper";
  return base[0].toUpperCase() + base.slice(1);
};
const DB_NAME = "caelestia-wall";

export const FALLBACK = BUILTIN_WALLPAPERS.map(({ file, name, thumb }) => ({
  id: "b:" + file,
  name,
  src: WALL_DIR + encodeURIComponent(file),
  thumb: thumb ? WALL_DIR + "thumbs/" + encodeURIComponent(thumb) : undefined,
  builtin: true,
}));

// ---- penyimpanan kecil di localStorage ----
const read = (key, fallback) => {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
};
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

const hidden = new Set((Array.isArray(read("wall:hidden", [])) ? read("wall:hidden", []) : []).filter((x) => typeof x === "string"));
let names = read("wall:names", {}); // nama baru untuk wallpaper bawaan
if (!isObj(names)) names = {};

const builtinItems = FALLBACK.map((w) => ({ ...w }));
let userRows = []; // { id, sig, name, blob, thumb, added }
let list = [];
const urls = new Map();
let db = null;

function blobUrl(key, blob) {
  let u = urls.get(key);
  if (!u) {
    u = URL.createObjectURL(blob);
    urls.set(key, u);
  }
  return u;
}
function dropUrl(key) {
  const u = urls.get(key);
  if (u) {
    URL.revokeObjectURL(u);
    urls.delete(key);
  }
}

// ---- IndexedDB ----
function openDB() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in globalThis)) return reject(new Error("IndexedDB is unavailable"));
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("items", { keyPath: "id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function run(mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction("items", mode);
    const req = fn(t.objectStore("items"));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
const needDB = () => {
  if (!db) throw new Error("This browser does not allow local storage (IndexedDB).");
};
export const hasWallStorage = () => !!db;

function rebuild() {
  const out = builtinItems
    .filter((w) => !hidden.has(w.id))
    .map((w) => ({ ...w, name: names[w.id] ?? w.name }));
  for (const r of [...userRows].sort((a, b) => a.added - b.added)) {
    out.push({
      id: r.id,
      name: r.name,
      src: blobUrl("w:" + r.id, r.blob),
      thumb: blobUrl("t:" + r.id, r.thumb),
      builtin: false,
    });
  }
  list = out;
}
const changed = () => emit("wallpapers:changed");

async function loadRows() {
  userRows = [];
  if (!db) return;
  try {
    userRows = (await run("readonly", (s) => s.getAll())) ?? [];
  } catch {}
}

export const wallpapers = () => list;

let loading = null;
export function loadWallpapers() {
  return (loading ??= (async () => {
    try {
      db = await openDB();
    } catch {
      db = null;
    }
    await loadRows();
    rebuild();
    changed();
    return list;
  })());
}
export async function reloadWallpapers() {
  rebuild();
  changed();
}

// ---- tambah, ubah, hapus ----
async function makeThumb(file) {
  const bmp = await createImageBitmap(file);
  const w = Math.min(360, bmp.width);
  const h = Math.max(1, Math.round((bmp.height / bmp.width) * w));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d").drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.8));
  if (!blob) throw new Error("Could not create image thumbnail");
  return blob;
}

export async function addWallpapers(files) {
  needDB();
  navigator.storage?.persist?.()?.catch?.(() => {});
  let added = 0,
    skipped = 0,
    failed = 0;
  for (const f of files) {
    if (!(f.type?.startsWith("image/") || IMG_EXT.test(f.name))) {
      skipped++;
      continue;
    }
    if (f.size > MAX_BYTES) {
      failed++;
      continue;
    }
    const sig = `${f.name}|${f.size}`;
    if (userRows.some((r) => r.sig === sig)) {
      skipped++;
      continue;
    }
    let thumb;
    try {
      thumb = await makeThumb(f); // sekaligus memastikan browser bisa membaca gambarnya
    } catch {
      failed++;
      continue;
    }
    const rec = { id: "u:" + uid(), sig, name: prettyName(f.name), blob: f, thumb, added: Date.now() };
    await run("readwrite", (s) => s.put(rec));
    userRows.push(rec);
    added++;
  }
  if (added) {
    rebuild();
    changed();
  }
  return { added, skipped, failed };
}

export async function renameWallpaper(id, name) {
  const n = String(name).trim().slice(0, 60);
  if (!n) return;
  const row = userRows.find((r) => r.id === id);
  if (row) {
    needDB();
    row.name = n;
    await run("readwrite", (s) => s.put(row));
  } else {
    names[id] = n;
    write("wall:names", names);
  }
  rebuild();
  changed();
}

// wallpaper bawaan hanya disembunyikan (filenya ada di folder); milikmu benar-benar dihapus.
// Mengembalikan false kalau ini wallpaper terakhir yang tersisa.
export async function removeWallpaper(id) {
  if (list.length <= 1 || !list.some((w) => w.id === id)) return false;
  const row = userRows.find((r) => r.id === id);
  if (row) {
    if (db) {
      try {
        await run("readwrite", (s) => s.delete(id));
      } catch {}
    }
    userRows = userRows.filter((r) => r.id !== id);
    dropUrl("w:" + id);
    dropUrl("t:" + id);
  } else {
    hidden.add(id);
    write("wall:hidden", [...hidden]);
  }
  rebuild();
  changed();
  return true;
}

export function restoreHiddenWallpapers() {
  const n = hidden.size;
  if (!n) return 0;
  hidden.clear();
  write("wall:hidden", []);
  rebuild();
  changed();
  return n;
}

export async function clearUserWallpapers() {
  needDB();
  const ids = userRows.map((r) => r.id);
  await run("readwrite", (s) => s.clear());
  for (const id of ids) {
    dropUrl("w:" + id);
    dropUrl("t:" + id);
  }
  userRows = [];
  if (!builtinItems.some((w) => !hidden.has(w.id))) {
    hidden.clear(); // jangan sampai tidak ada wallpaper sama sekali
    write("wall:hidden", []);
  }
  rebuild();
  changed();
  return ids.length;
}