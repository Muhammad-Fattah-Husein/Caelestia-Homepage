import { emit, uid } from "../core/state.js";
import { BUILTIN_TRACKS } from "../core/builtin-assets.js";

const MUSIC_DIR = "assets/music/";
const ALBUM_DIR = "assets/album/";
const DB_NAME = "caelestia-lib";
const AUDIO_EXT = /\.(mp3|wav|ogg|m4a|aac|flac|opus|webm)$/i;

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

let meta = read("lib:meta", {}); // { id: { title?, artist?, hidden? } }
if (!isObj(meta)) meta = {};
let plays = read("lib:plays", {}); // { id: jumlah putar }
if (!isObj(plays)) plays = {};
let durs = read("lib:dur", {}); // { id: detik }
if (!isObj(durs)) durs = {};
const favs = new Set((Array.isArray(read("lib:fav", [])) ? read("lib:fav", []) : []).filter((x) => typeof x === "string"));
let lists = (Array.isArray(read("lib:playlists", [])) ? read("lib:playlists", []) : [])
  .filter((l) => l && typeof l.id === "string" && typeof l.name === "string" && Array.isArray(l.ids))
  .map((l) => ({ id: l.id, name: l.name.slice(0, 60), ids: l.ids.filter((x) => typeof x === "string") }));

// ---- data lagu ----
let builtinTracks = BUILTIN_TRACKS;
let audioRows = []; // lagu impor (IndexedDB): { id, sig, name, title, artist, blob, added, dur }
let coverRows = new Map(); // cover kustom: id -> { id, blob }
let all = []; // lagu yang tampil (sudah digabung dengan perubahan)
const byId = new Map();
const urlCache = new Map(); // "a:id" / "c:id" -> object URL
let db = null;

export function parseName(file) {
  const base = file.replace(/\.[^.]+$/, "").trim();
  if (base.includes("--")) {
    const [t, ...a] = base.split("--");
    return { title: t.trim(), artist: a.join("--").trim() };
  }
  if (base.includes(" - ")) {
    const [a, ...t] = base.split(" - ");
    return { title: t.join(" - ").trim(), artist: a.trim() };
  }
  return { title: base, artist: "" };
}

function blobUrl(key, blob) {
  let u = urlCache.get(key);
  if (!u) {
    u = URL.createObjectURL(blob);
    urlCache.set(key, u);
  }
  return u;
}
function dropUrl(key) {
  const u = urlCache.get(key);
  if (u) {
    URL.revokeObjectURL(u);
    urlCache.delete(key);
  }
}

// ---- IndexedDB ----
function openDB() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in globalThis)) return reject(new Error("IndexedDB is unavailable"));
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("audio", { keyPath: "id" });
      r.result.createObjectStore("covers", { keyPath: "id" });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function run(store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
const needDB = () => {
  if (!db) throw new Error("This browser does not allow local storage (IndexedDB).");
};

function rebuild() {
  const base = [];
  for (const e of builtinTracks) {
    const p = parseName(e.file);
    base.push({
      id: e.id ?? "f:" + e.file,
      source: "file",
      title: p.title,
      artist: p.artist,
      src: MUSIC_DIR + encodeURIComponent(e.file),
      cover: e.cover ? ALBUM_DIR + encodeURIComponent(e.cover) : null,
      added: 0,
    });
  }
  for (const r of audioRows) {
    base.push({
      id: r.id,
      source: "import",
      title: r.title,
      artist: r.artist,
      src: blobUrl("a:" + r.id, r.blob),
      cover: null,
      added: r.added || 0,
    });
  }
  all = [];
  byId.clear();
  for (const b of base) {
    const m = meta[b.id] || {};
    if (m.hidden) continue;
    const c = coverRows.get(b.id);
    const t = {
      ...b,
      title: (m.title ?? b.title) || "Tanpa judul",
      artist: m.artist ?? b.artist,
      cover: c ? blobUrl("c:" + b.id, c.blob) : b.cover,
      dur: durs[b.id] || 0,
    };
    all.push(t);
    byId.set(t.id, t);
  }
}

const changed = () => emit("library:changed");

let loading = null;
export function loadLibrary() {
  return (loading ??= (async () => {
    try {
      db = await openDB();
    } catch {
      db = null;
    }
    if (db) {
      try {
        audioRows = (await run("audio", "readonly", (s) => s.getAll())) ?? [];
        const cs = (await run("covers", "readonly", (s) => s.getAll())) ?? [];
        coverRows = new Map(cs.map((c) => [c.id, c]));
      } catch {}
    }
    for (const r of audioRows) if (r.dur && !durs[r.id]) durs[r.id] = r.dur;
    rebuild();
    changed();
    emit("library:ready");
  })());
}

export async function reloadLibrary() {
  rebuild();
  changed();
}

// ---- membaca ----
export const tracks = () => all;
export const getTrack = (id) => byId.get(id) ?? null;
export const hasStorage = () => !!db;

// ---- impor, ubah, hapus ----
function readDuration(blob) {
  return new Promise((resolve) => {
    const a = new Audio();
    const u = URL.createObjectURL(blob);
    const done = (d) => {
      URL.revokeObjectURL(u);
      a.removeAttribute("src");
      resolve(Number.isFinite(d) ? d : 0);
    };
    a.preload = "metadata";
    a.onloadedmetadata = () => done(a.duration);
    a.onerror = () => done(0);
    a.src = u;
    setTimeout(() => done(0), 4000);
  });
}

export async function importFiles(files) {
  needDB();
  navigator.storage?.persist?.()?.catch?.(() => {}); // minta browser jangan menghapus penyimpanan ini
  let added = 0,
    skipped = 0;
  for (const f of files) {
    if (!(f.type?.startsWith("audio/") || AUDIO_EXT.test(f.name))) {
      skipped++;
      continue;
    }
    const sig = `${f.name}|${f.size}`;
    if (audioRows.some((r) => r.sig === sig)) {
      skipped++;
      continue;
    }
    const p = parseName(f.name);
    const dur = Math.round(await readDuration(f));
    const rec = { id: "i:" + uid(), sig, name: f.name, title: p.title, artist: p.artist, blob: f, added: Date.now(), dur };
    await run("audio", "readwrite", (s) => s.put(rec));
    audioRows.push(rec);
    if (dur) durs[rec.id] = dur;
    added++;
  }
  if (added) {
    write("lib:dur", durs);
    rebuild();
    changed();
  }
  return { added, skipped };
}

export function updateTrack(id, patch) {
  const m = { ...(meta[id] || {}) };
  if (typeof patch.title === "string") m.title = patch.title.trim().slice(0, 120);
  if (typeof patch.artist === "string") m.artist = patch.artist.trim().slice(0, 120);
  meta[id] = m;
  write("lib:meta", meta);
  rebuild();
  changed();
}

export async function setCover(id, file) {
  needDB();
  if (!file || !file.type?.startsWith("image/")) throw new Error("This file is not an image.");
  await run("covers", "readwrite", (s) => s.put({ id, blob: file }));
  dropUrl("c:" + id);
  coverRows.set(id, { id, blob: file });
  rebuild();
  changed();
}

function purgeRefs(id) {
  favs.delete(id);
  delete plays[id];
  delete durs[id];
  delete meta[id];
  for (const l of lists) l.ids = l.ids.filter((x) => x !== id);
  write("lib:fav", [...favs]);
  write("lib:plays", plays);
  write("lib:dur", durs);
  write("lib:meta", meta);
  write("lib:playlists", lists);
}

export async function removeTrack(id) {
  const t = byId.get(id);
  if (!t) return;
  if (t.source === "file") {
    // file di folder tidak bisa dihapus dari halaman web: cukup disembunyikan
    purgeRefs(id);
    meta[id] = { hidden: true };
    write("lib:meta", meta);
  } else {
    if (db) {
      try {
        await run("audio", "readwrite", (s) => s.delete(id));
        await run("covers", "readwrite", (s) => s.delete(id));
      } catch {}
    }
    audioRows = audioRows.filter((r) => r.id !== id);
    coverRows.delete(id);
    dropUrl("a:" + id);
    dropUrl("c:" + id);
    purgeRefs(id);
  }
  rebuild();
  changed();
}

export function restoreHidden() {
  let n = 0;
  for (const id of Object.keys(meta)) {
    if (meta[id]?.hidden) {
      delete meta[id];
      n++;
    }
  }
  if (n) {
    write("lib:meta", meta);
    rebuild();
    changed();
  }
  return n;
}

export async function clearImports() {
  needDB();
  const ids = audioRows.map((r) => r.id);
  await run("audio", "readwrite", (s) => s.clear());
  await run("covers", "readwrite", (s) => s.clear());
  for (const id of ids) {
    dropUrl("a:" + id);
    dropUrl("c:" + id);
    purgeRefs(id);
  }
  audioRows = [];
  coverRows = new Map();
  rebuild();
  changed();
  return ids.length;
}

// ---- favorit, jumlah putar, durasi ----
export const isFav = (id) => favs.has(id);
export function toggleFav(id) {
  if (favs.has(id)) favs.delete(id);
  else favs.add(id);
  write("lib:fav", [...favs]);
  changed();
  return favs.has(id);
}
export const playsOf = (id) => plays[id] | 0;
export function addPlay(id) {
  plays[id] = (plays[id] | 0) + 1;
  write("lib:plays", plays);
  changed();
}
export function setDuration(id, seconds) {
  const v = Math.round(seconds);
  if (!Number.isFinite(v) || v <= 0 || durs[id] === v) return;
  durs[id] = v;
  write("lib:dur", durs);
  const t = byId.get(id);
  if (t) t.dur = v;
  changed();
}

// ---- playlist ----
export const playlists = () => lists;
export const getPlaylist = (id) => lists.find((l) => l.id === id) ?? null;
const savePlaylists = () => {
  write("lib:playlists", lists);
  changed();
};
export function createPlaylist(name, ids = []) {
  const l = {
    id: "p:" + uid(),
    name: String(name).trim().slice(0, 60) || "Playlist",
    ids: [...new Set(ids.filter((x) => byId.has(x)))],
  };
  lists.push(l);
  savePlaylists();
  return l;
}
export function renamePlaylist(id, name) {
  const l = getPlaylist(id);
  if (!l) return;
  l.name = String(name).trim().slice(0, 60) || l.name;
  savePlaylists();
}
export function deletePlaylist(id) {
  lists = lists.filter((l) => l.id !== id);
  savePlaylists();
}
export function addToPlaylist(id, trackIds) {
  const l = getPlaylist(id);
  if (!l) return 0;
  let n = 0;
  for (const t of trackIds) {
    if (byId.has(t) && !l.ids.includes(t)) {
      l.ids.push(t);
      n++;
    }
  }
  if (n) savePlaylists();
  return n;
}
export function removeFromPlaylist(id, trackId) {
  const l = getPlaylist(id);
  if (!l) return;
  l.ids = l.ids.filter((x) => x !== trackId);
  savePlaylists();
}

// Memindahkan lagu-lagu terpilih ke posisi tepat sebelum beforeId (null = paling akhir).
// Urutan relatif lagu yang dipindah dipertahankan. Mengembalikan true kalau urutan berubah.
export function moveInPlaylist(id, trackIds, beforeId = null) {
  const l = getPlaylist(id);
  if (!l) return false;
  const set = new Set(trackIds);
  const moving = l.ids.filter((x) => set.has(x));
  if (!moving.length) return false;
  const rest = l.ids.filter((x) => !set.has(x));
  let at = beforeId == null ? -1 : rest.indexOf(beforeId);
  if (at < 0) at = rest.length;
  const next = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
  if (next.every((x, i) => x === l.ids[i])) return false;
  l.ids = next;
  savePlaylists();
  return true;
}

// Salin (move = false) atau pindahkan (move = true) lagu dari satu playlist ke playlist lain.
// Lagu yang sudah ada di tujuan dilewati. Mengembalikan { added, dup }.
export function transferTracks(fromId, toId, trackIds, move = false) {
  const from = getPlaylist(fromId);
  const to = getPlaylist(toId);
  if (!from || !to || from === to) return { added: 0, dup: 0 };
  const ids = [...new Set(trackIds)].filter((x) => byId.has(x));
  let added = 0,
    dup = 0;
  for (const t of ids) {
    if (to.ids.includes(t)) dup++;
    else {
      to.ids.push(t);
      added++;
    }
  }
  if (move) {
    const drop = new Set(ids);
    from.ids = from.ids.filter((x) => !drop.has(x));
  }
  if (added || move) savePlaylists();
  return { added, dup };
}

// ---- memilih baris yang ditampilkan di layar perpustakaan ----
const collator = new Intl.Collator("id", { sensitivity: "base", numeric: true });
export function selectRows({ view = "all", query = "", sort = "default", queueIds = [] } = {}) {
  let rows;
  if (view === "queue") rows = queueIds.map((id, qi) => ({ t: byId.get(id), qi })).filter((r) => r.t);
  else if (view === "fav") rows = all.filter((t) => favs.has(t.id)).map((t) => ({ t }));
  else if (view.startsWith("pl:")) {
    const l = getPlaylist(view.slice(3));
    rows = (l ? l.ids : []).map((id) => byId.get(id)).filter(Boolean).map((t) => ({ t }));
  } else rows = all.map((t) => ({ t }));

  const q = query.trim().toLowerCase();
  if (q) rows = rows.filter(({ t }) => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q));

  if (view !== "queue" && sort !== "default") {
    const by = {
      title: (a, b) => collator.compare(a.t.title, b.t.title),
      artist: (a, b) => collator.compare(a.t.artist, b.t.artist) || collator.compare(a.t.title, b.t.title),
      recent: (a, b) => b.t.added - a.t.added,
      plays: (a, b) => playsOf(b.t.id) - playsOf(a.t.id),
    }[sort];
    if (by) rows = rows.slice().sort(by);
  }
  return rows;
}