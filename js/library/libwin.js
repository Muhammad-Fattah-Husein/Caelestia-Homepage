import { state, on, emit, closeOthers } from "../core/state.js";
import { openDialog } from "../core/dialog.js";
import * as lib from "./library.js";
import { initLibDnd } from "./libdnd.js";
import * as wall from "../appearance/wallpapers.js";
import { THEMES, setTheme } from "../system/theme.js";
import {
  playTracks, enqueue, playNext, getQueue, queueIndex, jumpTo,
  removeFromQueue, clearQueue, moveInQueue, currentTrack, isPlaying,
  isShuffle, toggleShuffle,
} from "../music/audio.js";
   import { inset, isPhone } from "../ui/layout.js";
   import { createIcon } from "../core/icons.js";

const SORTS = [
  ["default", "Default order"],
  ["title", "Title A–Z"],
  ["artist", "Artist A–Z"],
  ["recent", "Recently added"],
  ["plays", "Most played"],
];
const VIEW_TITLES = { all: "All tracks", fav: "Favorites", queue: "Queue" };

let view = "all",
  query = "",
  sort = "default";
let rows = []; // baris yang sedang tampil
let isOpen = false,
  placed = false,
  dirty = true,
  coverTarget = null,
  menuAnchor = null;

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const toast = (title, message, type = "info") => emit("toast", { title, message, type, duration: 2600 });
const fmtTime = (s) => (s > 0 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "");

// ---- pilihan banyak lagu (disimpan berdasarkan id lagu, bukan elemen di layar) ----
const selected = new Set();
let anchorId = null; // patokan untuk Shift+klik
const rowIdsInView = () => [...new Set(rows.map((r) => r.t.id))];
// yang terlihat mengikuti urutan baris; yang tersaring pencarian menyusul di belakang
function selIds() {
  const vis = rowIdsInView().filter((id) => selected.has(id));
  const seen = new Set(vis);
  return vis.concat([...selected].filter((id) => !seen.has(id)));
}
function refreshSel() {
  if (view === "wall") return;
  list.classList.toggle("selecting", selected.size > 0);
  for (const rowEl of list.querySelectorAll(".lib-row")) {
    const on = selected.has(rowEl.dataset.id);
    rowEl.classList.toggle("sel", on);
    const c = rowEl.querySelector(".lib-chk");
    if (c) c.checked = on;
  }
  renderActions();
}
function clearSel() {
  if (!selected.size && anchorId == null) return;
  selected.clear();
  anchorId = null;
  refreshSel();
}
function toggleSel(id, force) {
  if (force ?? !selected.has(id)) selected.add(id);
  else selected.delete(id);
  anchorId = id;
  refreshSel();
}
function rangeSel(id, additive) {
  const ids = rowIdsInView();
  const a = ids.indexOf(anchorId),
    b = ids.indexOf(id);
  if (a < 0 || b < 0) return toggleSel(id, true);
  if (!additive) selected.clear();
  for (const x of ids.slice(Math.min(a, b), Math.max(a, b) + 1)) selected.add(x);
  refreshSel();
}
function addedMsg(name, n, dup) {
  if (!n) return dup > 1 ? `All ${dup} tracks are already in “${name}”` : `Already in “${name}”`;
  return `${n === 1 ? "1 track" : n + " tracks"} added to “${name}”${dup ? `, ${dup} already there` : ""}`;
}

// ---- kerangka jendela ----
const win = el("section", "lib");
win.id = "lib";
win.inert = true;
win.setAttribute("role", "dialog");
win.setAttribute("aria-label", "Music library");
win.innerHTML = `
  <header class="lib-head">
    <span class="lib-title">♫ Library</span>
    <input class="lib-search" type="search" placeholder="Search tracks or wallpapers…" aria-label="Search tracks" spellcheck="false" autocomplete="off" />
    <button class="lib-btn lib-import" type="button" title="Import tracks or wallpapers">Import</button>
    <button class="lib-btn lib-more" type="button" aria-label="More options">⋯</button>
    <button class="lib-btn lib-close" type="button" aria-label="Close">✕</button>
  </header>
  <div class="lib-body">
    <nav class="lib-side" aria-label="Library">
      <div class="lib-navs"></div>
      <div class="lib-side-head">
        <span>Playlist</span>
        <button class="lib-btn lib-newpl" type="button" aria-label="New playlist">＋</button>
      </div>
      <div class="lib-pls"></div>
    </nav>
    <main class="lib-main">
      <div class="lib-bar">
        <div class="lib-bar-text">
          <h2 class="lib-view-title"></h2>
          <span class="lib-meta"></span>
        </div>
        <div class="lib-actions"></div>
        <select class="lib-sort" aria-label="Sort"></select>
      </div>
      <div class="lib-colhead"><span>#</span><span></span><span>Title</span><span>Duration</span><span>Plays</span><span></span><span></span></div>
      <div class="lib-list" role="list"></div>
      <div class="lib-status" role="status"></div>
    </main>
  </div>
  <input class="lib-file" type="file" accept="audio/*,image/*" multiple hidden />
  <input class="lib-cover-file" type="file" accept="image/*" hidden />
  <div class="lib-drop">Drop music or image files here to import</div>
  <div class="lib-pop" hidden></div>`;
document.body.append(win);

const q = (sel) => win.querySelector(sel);
const head = q(".lib-head"),
  searchEl = q(".lib-search"),
  importBtn = q(".lib-import"),
  moreBtn = q(".lib-more"),
  side = q(".lib-side"),
  navs = q(".lib-navs"),
  pls = q(".lib-pls"),
  titleEl = q(".lib-view-title"),
  metaEl = q(".lib-meta"),
  actionsEl = q(".lib-actions"),
  sortEl = q(".lib-sort"),
  colheadEl = q(".lib-colhead"),
  list = q(".lib-list"),
  statusEl = q(".lib-status"),
  fileEl = q(".lib-file"),
  coverEl = q(".lib-cover-file"),
  pop = q(".lib-pop");

for (const [v, label] of SORTS) {
  const o = el("option", "", label);
  o.value = v;
  sortEl.append(o);
}

// ---- sisi kiri ----
function navBtn(id, label, count) {
  const b = el("button", "lib-nav");
  b.type = "button";
  b.dataset.view = id;
  b.classList.toggle("active", id === view);
  b.append(el("span", "lib-nav-label", label), el("span", "lib-count", String(count)));
  return b;
}
function renderSide() {
  const favN = lib.tracks().filter((t) => lib.isFav(t.id)).length;
  const fav = navBtn("fav", "Favorites", favN);
  fav.querySelector(".lib-nav-label").prepend(createIcon("11_heart.png"));
  navs.replaceChildren(
    navBtn("all", "All tracks", lib.tracks().length),
    fav,
    navBtn("queue", "Queue", getQueue().length),
    navBtn("wall", "Wallpaper", wall.wallpapers().length),
  );
  pls.replaceChildren(...lib.playlists().map((l) => navBtn("pl:" + l.id, l.name, l.ids.length)));
}
side.addEventListener("click", (e) => {
  const b = e.target.closest(".lib-nav");
  if (b) setView(b.dataset.view);
});
function setView(v) {
  view = v;
  selected.clear();
  anchorId = null;
  renderAll();
}

// ---- isi utama ----
function emptyText() {
  if (view === "wall") return query.trim() ? `No wallpapers found for “${query.trim()}”.` : "No wallpapers yet.";
  if (query.trim()) return `No results for “${query.trim()}”.`;
  if (view === "fav") return "No favorites yet. Click the heart icon on a track to add one.";
  if (view === "queue") return "The queue is empty.";
  if (view.startsWith("pl:")) return "This playlist is empty. Drag tracks here, or use a track’s ⋮ menu → Add to playlist.";
  return "No tracks yet. Click Import to add files. To add built-in tracks, place files in assets/music and register them in js/core/builtin-assets.js.";
}

function buildRow(r, i) {
  const t = r.t;
  const row = el("div", "lib-row");
  row.dataset.i = i;
  row.dataset.id = t.id;
  if (r.qi != null) row.dataset.qi = r.qi;
  row.tabIndex = 0;
  row.setAttribute("role", "listitem");

  const num = el("span", "lib-num");
  const eq = el("span", "lib-eq");
  eq.append(el("i"), el("i"), el("i"));
  const chk = el("input", "lib-chk");
  chk.type = "checkbox";
  chk.tabIndex = -1; // keyboard: Spasi pada baris
  chk.setAttribute("aria-label", "Select track");
  chk.checked = selected.has(t.id);
  row.classList.toggle("sel", chk.checked);
  num.append(chk, el("b", "", String((r.qi ?? i) + 1)), eq);

  const cov = el("span", "lib-cov");
  if (t.cover) cov.style.backgroundImage = `url("${t.cover}")`;

  const info = el("span", "lib-info");
  info.append(el("span", "lib-t", t.title), el("span", "lib-a", t.artist || "Unknown artist"));

  const n = lib.playsOf(t.id);
  const favOn = lib.isFav(t.id);
  const fav = el("button", "lib-fav");
  fav.append(createIcon("11_heart.png"));
  fav.type = "button";
  fav.classList.toggle("on", favOn);
  fav.setAttribute("aria-label", "Favorite");
  fav.setAttribute("aria-pressed", String(favOn));
  const more = el("button", "lib-rowmenu", "⋮");
  more.type = "button";
  more.setAttribute("aria-label", "Track options");

  row.append(num, cov, info, el("span", "lib-dur", fmtTime(t.dur)), el("span", "lib-plays", n ? String(n) : ""), fav, more);
  return row;
}

function renderActions() {
  const acts = [];
  const add = (label, run, cls = "") => {
    const b = el("button", "lib-btn " + cls, label);
    b.type = "button";
    b.addEventListener("click", run);
    acts.push(b);
  };
  if (selected.size) {
    const n = selected.size;
    acts.push(el("span", "lib-selcount", `${n} selected`));
    add("Add to playlist…", (e) => pickPlaylist(e.currentTarget, selIds()));
    add("Play next", () => {
      playNext(selIds());
      toast("Queue", n === 1 ? "Will play next" : `${n} tracks will play next`);
    });
    add("Add to queue", () => {
      enqueue(selIds());
      toast("Queue", n === 1 ? "Added to queue" : `${n} tracks added to queue`);
    });
    add("Deselect", clearSel);
  }
  if (view === "queue") {
    if (getQueue().length > 1) add("Clear queue", () => clearQueue());
  } else if (rows.length) {
    add("Play all", () => playTracks(rows.map((r) => r.t.id), 0));
    add("Shuffle", () => {
      if (!isShuffle()) toggleShuffle();
      const ids = rows.map((r) => r.t.id);
      playTracks(ids, Math.floor(Math.random() * ids.length));
    });
  }
  if (view.startsWith("pl:")) {
    add("Rename", () => renamePlaylist(view.slice(3)));
    add("Delete playlist", () => deletePlaylist(view.slice(3)), "danger");
  }
  actionsEl.replaceChildren(...acts);
}

function renderMain() {
  list.classList.toggle("wall", view === "wall");
  colheadEl.hidden = view === "wall";
  if (view === "wall") return renderWall();
  if (view.startsWith("pl:") && !lib.getPlaylist(view.slice(3))) view = "all";
  rows = lib.selectRows({ view, query, sort, queueIds: getQueue() });
  for (const id of [...selected]) if (!lib.getTrack(id)) selected.delete(id); // lagu yang sudah dihapus
  if (anchorId != null && !lib.getTrack(anchorId)) anchorId = null;
  list.classList.toggle("selecting", selected.size > 0);

  titleEl.textContent = view.startsWith("pl:") ? lib.getPlaylist(view.slice(3)).name : VIEW_TITLES[view];
  const total = rows.reduce((s, r) => s + (r.t.dur || 0), 0);
  metaEl.textContent = `${rows.length} tracks${total ? " · " + Math.max(1, Math.round(total / 60)) + " min" : ""}`;
  sortEl.hidden = view === "queue";
  sortEl.value = sort;
  importBtn.disabled = !lib.hasStorage() && !wall.hasWallStorage();
  importBtn.title = importBtn.disabled ? "This browser does not allow local storage" : "Import tracks or wallpapers";
  renderActions();

  // render ulang tidak boleh membuat fokus keyboard hilang dari baris yang sedang dipilih
  const fid = list.contains(document.activeElement) ? document.activeElement.dataset?.id : null;
  if (rows.length) list.replaceChildren(...rows.map(buildRow));
  else list.replaceChildren(el("div", "lib-empty", emptyText()));
  if (fid) list.querySelector(`.lib-row[data-id="${CSS.escape(fid)}"]`)?.focus({ preventScroll: true });
  markNow();
}

function renderAll() {
  dirty = false;
  renderSide();
  renderMain();
}

// ---- tampilan wallpaper ----
function buildWallCard(w) {
  const idx = THEMES.findIndex((t) => t.id === w.id);
  const card = el("div", "wall-card");
  card.dataset.id = w.id;
  card.tabIndex = 0;
  card.setAttribute("role", "listitem");
  card.classList.toggle("now", idx >= 0 && idx === state.theme);

  const box = el("span", "wall-img");
  const img = document.createElement("img");
  img.loading = "lazy";
  img.decoding = "async";
  img.draggable = false;
  img.alt = "";
  img.src = w.thumb ?? w.src;
  img.addEventListener("error", () => img.remove());
  box.append(img);

  const info = el("span", "wall-info");
  info.append(el("span", "wall-name", w.name), el("span", "wall-tag", w.builtin ? "Built-in" : "Your wallpaper"));
  const more = el("button", "lib-rowmenu", "⋮");
  more.type = "button";
  more.setAttribute("aria-label", "Wallpaper options");
  card.append(box, info, more);
  return card;
}

function renderWall() {
  rows = [];
  const qy = query.trim().toLowerCase();
  const items = wall.wallpapers().filter((w) => !qy || w.name.toLowerCase().includes(qy));
  titleEl.textContent = "Wallpaper";
  metaEl.textContent = `${items.length} wallpaper`;
  sortEl.hidden = true;
  importBtn.disabled = !lib.hasStorage() && !wall.hasWallStorage();
  importBtn.title = importBtn.disabled ? "This browser does not allow local storage" : "Import tracks or wallpapers";

  const add = el("button", "lib-btn", "Add wallpaper");
  add.type = "button";
  add.disabled = !wall.hasWallStorage();
  add.addEventListener("click", () => fileEl.click());
  actionsEl.replaceChildren(add);

  const fid = list.contains(document.activeElement) ? document.activeElement.dataset?.id : null;
  if (items.length) list.replaceChildren(...items.map(buildWallCard));
  else list.replaceChildren(el("div", "lib-empty", emptyText()));
  if (fid) list.querySelector(`.wall-card[data-id="${CSS.escape(fid)}"]`)?.focus({ preventScroll: true });
}

function useWallpaper(w) {
  const i = THEMES.findIndex((t) => t.id === w.id);
  if (i >= 0) setTheme(i);
}
list.addEventListener("click", (e) => {
  const card = e.target.closest(".wall-card");
  if (!card) return;
  const w = wall.wallpapers().find((x) => x.id === card.dataset.id);
  if (!w) return;
  const menu = e.target.closest(".lib-rowmenu");
  if (menu) openWallMenu(menu, w);
  else useWallpaper(w);
});
function openWallMenu(anchor, w) {
  openMenu(anchor, [
    { label: "Use now", run: () => useWallpaper(w) },
    { label: "Rename…", run: () => renameWall(w) },
    { sep: true },
    { label: w.builtin ? "Hide…" : "Delete…", danger: true, run: () => deleteWall(w) },
  ]);
}
async function renameWall(w) {
  const v = await openDialog({
    title: "Rename wallpaper",
    fields: [{ name: "name", label: "Name", value: w.name, maxlength: 60 }],
    validate: (x) => (x.name ? "" : "Name cannot be empty."),
  });
  if (!v) return;
  try {
    await wall.renameWallpaper(w.id, v.name);
  } catch (err) {
    toast("Error", err.message, "error");
  }
}
async function deleteWall(w) {
  const v = await openDialog({
    title: w.builtin ? `Hide “${w.name}”? (the file in the folder will not be deleted)` : `Delete wallpaper “${w.name}”?`,
    fields: [],
  });
  if (!v) return;
  const ok = await wall.removeWallpaper(w.id);
  if (ok) toast(w.builtin ? "Hidden" : "Deleted", w.name);
  else toast("Wallpaper", "At least one wallpaper must remain", "warn");
}

// tanda lagu yang sedang diputar
function markNow() {
  const cur = currentTrack();
  const playing = isPlaying();
  for (const row of list.querySelectorAll(".lib-row")) {
    const same = cur && row.dataset.id === cur.id && (view !== "queue" || Number(row.dataset.qi) === queueIndex());
    row.classList.toggle("now", !!same);
    row.classList.toggle("playing", !!same && playing);
  }
}

// ---- klik pada baris ----
list.addEventListener("click", (e) => {
  const rowEl = e.target.closest(".lib-row");
  if (!rowEl) return;
  const r = rows[Number(rowEl.dataset.i)];
  if (!r) return;
  const fav = e.target.closest(".lib-fav");
  const menu = e.target.closest(".lib-rowmenu");
  const chk = e.target.closest(".lib-chk");
  if (chk) {
    if (e.shiftKey) rangeSel(r.t.id, e.ctrlKey || e.metaKey);
    else toggleSel(r.t.id, chk.checked);
  } else if (fav) lib.toggleFav(r.t.id);
  else if (menu) openRowMenu(menu, r);
  else if (e.ctrlKey || e.metaKey) toggleSel(r.t.id);
  else if (e.shiftKey) rangeSel(r.t.id, false);
  else playRow(r);
});
list.addEventListener("keydown", (e) => {
  const row = e.target.closest?.(".lib-row, .wall-card");
  if (!row || e.target !== row) return;
  const isTrack = row.classList.contains("lib-row");
  if (e.key === "Enter") {
    e.preventDefault();
    row.click();
  } else if (e.key === " " && isTrack) {
    e.preventDefault();
    toggleSel(row.dataset.id);
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a" && isTrack) {
    e.preventDefault();
    for (const id of rowIdsInView()) selected.add(id);
    anchorId = row.dataset.id;
    refreshSel();
  } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const n = e.key === "ArrowDown" ? row.nextElementSibling : row.previousElementSibling;
    n?.focus();
    if (e.shiftKey && isTrack && n?.classList.contains("lib-row")) {
      if (anchorId == null) anchorId = row.dataset.id;
      rangeSel(n.dataset.id, false);
    }
  }
});
function playRow(r) {
  if (view === "queue") jumpTo(r.qi);
  else playTracks(rows.map((x) => x.t.id), rows.indexOf(r));
}

// ---- menu kecil ----
function openMenu(anchor, items) {
  pop.replaceChildren(
    ...items.map((it) => {
      if (it.sep) return el("div", "lib-sep");
      if (it.head) return el("div", "lib-pophead", it.head);
      const b = el("button", "lib-item" + (it.danger ? " danger" : ""), it.label);
      b.type = "button";
      b.addEventListener("click", () => {
        const keep = it.run?.() === "keep";
        if (!keep) closeMenu();
      });
      return b;
    }),
  );
  pop.hidden = false;
  menuAnchor = anchor;
  const a = anchor.getBoundingClientRect(),
    w = win.getBoundingClientRect();
  const pw = pop.offsetWidth,
    ph = pop.offsetHeight;
  let x = a.right - w.left - pw;
  let y = a.bottom - w.top + 4;
  if (y + ph > w.height - 8) y = Math.max(8, a.top - w.top - ph - 4);
  x = Math.max(8, Math.min(x, w.width - pw - 8));
  pop.style.left = x + "px";
  pop.style.top = y + "px";
  pop.querySelector(".lib-item")?.focus();
}
function closeMenu() {
  pop.hidden = true;
  menuAnchor = null;
}
win.addEventListener("pointerdown", (e) => {
  if (!pop.hidden && !pop.contains(e.target) && !(menuAnchor && menuAnchor.contains(e.target))) closeMenu();
});

function openRowMenu(anchor, r) {
  const t = r.t;
  const items = [
    { label: "Play now", run: () => playRow(r) },
    { label: "Play next", run: () => playNext([t.id]) },
    { label: "Add to queue", run: () => enqueue([t.id]) },
    { label: "Add to playlist…", run: () => { pickPlaylist(anchor, [t.id]); return "keep"; } },
  ];
  if (view === "queue") {
    items.push(
      { sep: true },
      { label: "Move up", run: () => moveInQueue(r.qi, r.qi - 1) },
      { label: "Move down", run: () => moveInQueue(r.qi, r.qi + 1) },
      { label: "Remove from queue", run: () => removeFromQueue(r.qi) },
    );
  }
  if (view.startsWith("pl:"))
    items.push({ sep: true }, { label: "Remove from playlist", run: () => lib.removeFromPlaylist(view.slice(3), t.id) });
  items.push(
    { sep: true },
    { label: "Edit details…", run: () => editTrack(t) },
    { label: "Change cover…", run: () => pickCover(t) },
    { label: t.source === "file" ? "Hide track…" : "Delete track…", danger: true, run: () => deleteTrack(t) },
  );
  openMenu(anchor, items);
}

function pickPlaylist(anchor, ids) {
  const items = [{ head: "Add to playlist" }];
  for (const l of lib.playlists()) {
    items.push({
      label: l.name,
      run: () => {
        const n = lib.addToPlaylist(l.id, ids);
        toast("Playlist", addedMsg(l.name, n, ids.length - n));
      },
    });
  }
  items.push({ sep: true }, { label: "＋ New playlist…", run: () => newPlaylist(ids) });
  openMenu(anchor, items);
}

// ---- dialog dan aksi pengelolaan ----
async function editTrack(t) {
  const v = await openDialog({
    title: "Edit track details",
    fields: [
      { name: "title", label: "Title", value: t.title, maxlength: 120 },
      { name: "artist", label: "Artist", value: t.artist, maxlength: 120 },
    ],
    validate: (x) => (x.title ? "" : "Title cannot be empty."),
  });
  if (v) lib.updateTrack(t.id, v);
}
async function deleteTrack(t) {
  const hide = t.source === "file";
  const v = await openDialog({
    title: hide ? `Hide “${t.title}”? (the file in the folder will not be deleted)` : `Remove “${t.title}” from the library?`,
    fields: [],
  });
  if (!v) return;
  try {
    await lib.removeTrack(t.id);
    toast(hide ? "Hidden" : "Deleted", t.title);
  } catch (err) {
    toast("Error", err.message, "error");
  }
}
async function newPlaylist(ids = []) {
  const v = await openDialog({
    title: "New playlist",
    fields: [{ name: "name", label: "Name", maxlength: 60 }],
    validate: (x) => (x.name ? "" : "Name cannot be empty."),
  });
  if (!v) return;
  const l = lib.createPlaylist(v.name, ids);
  toast("Playlist", ids.length ? `Created “${l.name}” with ${l.ids.length} tracks` : `Created “${l.name}”`);
}
async function renamePlaylist(id) {
  const l = lib.getPlaylist(id);
  if (!l) return;
  const v = await openDialog({
    title: "Rename playlist",
    fields: [{ name: "name", label: "Name", value: l.name, maxlength: 60 }],
    validate: (x) => (x.name ? "" : "Name cannot be empty."),
  });
  if (v) lib.renamePlaylist(id, v.name);
}
async function deletePlaylist(id) {
  const l = lib.getPlaylist(id);
  if (!l) return;
  const v = await openDialog({ title: `Delete playlist “${l.name}”? (tracks will not be deleted)`, fields: [] });
  if (v) lib.deletePlaylist(id);
}
q(".lib-newpl").addEventListener("click", () => newPlaylist());

function pickCover(t) {
  coverTarget = t.id;
  coverEl.value = "";
  coverEl.click();
}
coverEl.addEventListener("change", async () => {
  const f = coverEl.files?.[0];
  if (!f || !coverTarget) return;
  try {
    await lib.setCover(coverTarget, f);
    toast("Cover", "Cover updated");
  } catch (err) {
    toast("Error", err.message, "error");
  }
});

// ---- impor ----
const AUDIO_EXT = /\.(mp3|wav|ogg|m4a|aac|flac|opus|webm)$/i;
const IMG_EXT = /\.(jpe?g|png|webp|avif|gif|bmp)$/i;
const isAudio = (f) => f.type?.startsWith("audio/") || AUDIO_EXT.test(f.name);
const isImage = (f) => f.type?.startsWith("image/") || IMG_EXT.test(f.name);
async function doImport(files) {
  const all = [...files];
  const songs = all.filter(isAudio);
  const pics = all.filter((f) => !isAudio(f) && isImage(f));
  if (!songs.length && !pics.length) {
    toast("Import", "No music or image files selected", "warn");
    return;
  }
  try {
    if (songs.length) {
      statusEl.textContent = `Importing ${songs.length} tracks…`;
      try {
        const { added, skipped } = await lib.importFiles(songs);
        toast("Import", `${added} tracks added${skipped ? `, ${skipped} skipped (already in library)` : ""}`);
      } catch (err) {
        toast("Import failed", err.message, "error");
      }
    }
    if (pics.length) {
      statusEl.textContent = `Adding ${pics.length} wallpapers…`;
      try {
        const { added, skipped, failed } = await wall.addWallpapers(pics);
        const extra = [skipped ? `${skipped} already present` : "", failed ? `${failed} failed (too large or unreadable)` : ""].filter(Boolean).join(", ");
        toast("Wallpaper", `${added} wallpapers added${extra ? `, ${extra}` : ""}`, failed && !added ? "error" : "info");
      } catch (err) {
        toast("Wallpaper import failed", err.message, "error");
      }
    }
  } finally {
    statusEl.textContent = "";
  }
}
importBtn.addEventListener("click", () => fileEl.click());
fileEl.addEventListener("change", async () => {
  await doImport(fileEl.files);
  fileEl.value = "";
});
win.addEventListener("dragover", (e) => {
  if (!e.dataTransfer?.types?.includes("Files")) return;
  e.preventDefault();
  win.classList.add("dropping");
});
win.addEventListener("dragleave", (e) => {
  if (!win.contains(e.relatedTarget)) win.classList.remove("dropping");
});
win.addEventListener("drop", (e) => {
  e.preventDefault();
  win.classList.remove("dropping");
  if (e.dataTransfer?.files?.length) doImport(e.dataTransfer.files);
});

// ---- menu "lainnya" di header ----
moreBtn.addEventListener("click", () =>
  openMenu(moreBtn, [
    {
      label: "Reload tracks and wallpapers",
      run: async () => {
        await lib.reloadLibrary();
        await wall.reloadWallpapers();
        toast("Library", "Lists reloaded");
      },
    },
    {
      label: "Restore hidden tracks",
      run: () => {
        const n = lib.restoreHidden();
        toast("Library", n ? `${n} tracks restored` : "No hidden tracks");
      },
    },
    {
      label: "Restore hidden wallpapers",
      run: () => {
        const n = wall.restoreHiddenWallpapers();
        toast("Library", n ? `${n} wallpapers restored` : "No hidden wallpapers");
      },
    },
    { sep: true },
    {
      label: "Delete all your wallpapers…",
      danger: true,
      run: async () => {
        const v = await openDialog({ title: "Delete all wallpapers you added?", fields: [] });
        if (!v) return;
        try {
          toast("Library", `${await wall.clearUserWallpapers()} wallpapers deleted`);
        } catch (err) {
          toast("Error", err.message, "error");
        }
      },
    },
    {
      label: "Delete all imported tracks…",
      danger: true,
      run: async () => {
        const v = await openDialog({ title: "Delete all tracks imported into this browser?", fields: [] });
        if (!v) return;
        try {
          toast("Library", `${await lib.clearImports()} imported tracks deleted`);
        } catch (err) {
          toast("Error", err.message, "error");
        }
      },
    },
  ]),
);

searchEl.addEventListener("input", () => {
  query = searchEl.value;
  renderMain();
});
sortEl.addEventListener("change", () => {
  sort = sortEl.value;
  renderMain();
});

// ---- buka, tutup, geser ----
   function placeWin() {
     const w = win.offsetWidth, h = win.offsetHeight, e = inset();
     win.style.left = (isPhone() ? e.left : Math.max(e.left, Math.round((innerWidth - w) / 2 + 24))) + "px";
     win.style.top = (isPhone() ? e.top : Math.max(e.top, Math.round((innerHeight - h) / 2))) + "px";
   }
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
function keepInView() {
  const r = win.getBoundingClientRect();
  win.style.left = clamp(r.left, 0, Math.max(0, innerWidth - 120)) + "px";
  win.style.top = clamp(r.top, 0, Math.max(0, innerHeight - 60)) + "px";
}
window.addEventListener("resize", () => placed && keepInView());

export function openLibrary(v) {
  if (state.off) return;
  if (["all", "fav", "queue", "wall"].includes(v)) {
    if (v !== view) {
      selected.clear();
      anchorId = null;
    }
    view = v;
    dirty = true;
  }
  if (isOpen) {
    if (dirty) renderAll();
    return;
  }
  closeOthers("library");
  isOpen = true;
  win.inert = false;
  if (!placed) {
    placeWin();
    placed = true;
  }
  win.classList.add("open");
  if (dirty) renderAll();
  else markNow();
  if (matchMedia("(pointer: fine)").matches) searchEl.focus({ preventScroll: true }); // di HP: jangan langsung memunculkan keyboard
}
export function closeLibrary() {
  if (!isOpen) return;
  isOpen = false;
  closeMenu();
  win.classList.remove("open", "dropping");
  win.inert = true;
}
export const toggleLibrary = () => (isOpen ? closeLibrary() : openLibrary());

q(".lib-close").addEventListener("click", closeLibrary);

head.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || e.target.closest("input, button")) return;
  const r = win.getBoundingClientRect();
  const dx = e.clientX - r.left,
    dy = e.clientY - r.top;
  head.setPointerCapture(e.pointerId);
  const move = (ev) => {
    win.style.left = clamp(ev.clientX - dx, 0, Math.max(0, innerWidth - 120)) + "px";
    win.style.top = clamp(ev.clientY - dy, 0, Math.max(0, innerHeight - 60)) + "px";
  };
  const up = () => {
    head.removeEventListener("pointermove", move);
    head.removeEventListener("pointerup", up);
    head.removeEventListener("pointercancel", up);
  };
  head.addEventListener("pointermove", move);
  head.addEventListener("pointerup", up);
  head.addEventListener("pointercancel", up);
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !isOpen) return;
  if (!pop.hidden) {
    closeMenu();
    e.stopPropagation();
  } else if (selected.size && win.contains(document.activeElement)) {
    clearSel(); // Esc pertama mengosongkan pilihan, Esc kedua baru menutup jendela
    e.stopPropagation();
  } else closeLibrary();
});

// tombol di bar kiri
const slot = document.getElementById("bar-ws");
if (slot) {
  const b = el("button", "bar-btn", "♫");
  b.type = "button";
  b.title = "Music library (M)";
  b.setAttribute("aria-label", "Open music library");
  b.addEventListener("click", toggleLibrary);
  slot.append(b);
}

// ---- seret dan lepas ----
// menu kecil di titik lepas: pura-pura jadi "anchor" yang berukuran nol
const pointAnchor = (x, y) => ({ getBoundingClientRect: () => ({ left: x, right: x, top: y, bottom: y }), contains: () => false });
const plName = (id) => lib.getPlaylist(id)?.name ?? "playlist";
initLibDnd({
  win,
  list,
  side,
  bar: q(".lib-bar"),
  view: () => view,
  canReorder: () => view.startsWith("pl:") && sort === "default" && !query.trim(),
  idsFor: (id) => (selected.has(id) ? selIds() : [id]), // menyeret baris yang belum dipilih = hanya baris itu
  onAdd(plId, ids) {
    const n = lib.addToPlaylist(plId, ids);
    toast("Playlist", addedMsg(plName(plId), n, ids.length - n));
  },
  onTransfer(srcId, dstId, ids, x, y) {
    const dst = plName(dstId);
    openMenu(pointAnchor(x, y), [
      { head: `${ids.length === 1 ? "1 track" : ids.length + " tracks"} → “${dst}”` },
      {
        label: "Copy",
        run: () => {
          const r = lib.transferTracks(srcId, dstId, ids, false);
          toast("Playlist", addedMsg(dst, r.added, r.dup));
        },
      },
      {
        label: "Move",
        run: () => {
          for (const id of ids) selected.delete(id); // sebelum render ulang yang dipicu transferTracks
          const r = lib.transferTracks(srcId, dstId, ids, true);
          toast("Playlist", `${ids.length === 1 ? "1 track" : ids.length + " tracks"} moved to “${dst}”${r.dup ? `, ${r.dup} already there` : ""}`);
        },
      },
    ]);
  },
  onNewPlaylist: (ids) => newPlaylist(ids),
  onPlayNext(ids) {
    playNext(ids);
    toast("Queue", ids.length === 1 ? "Will play next" : `${ids.length} tracks will play next`);
  },
  onReorder: (plId, ids, beforeId) => lib.moveInPlaylist(plId, ids, beforeId),
  onBlockedReorder: () => toast("Playlist", "To reorder, set sort to “Default order” and clear the search.", "warn"),
});

// ---- mengikuti perubahan data ----
on("library:changed", () => (isOpen ? renderAll() : (dirty = true)));
on("audio:queue", () => {
  if (!isOpen) return;
  renderSide();
  if (view === "queue") renderMain();
  else markNow();
});
on("audio:track", () => isOpen && markNow());
on("audio:play", () => isOpen && markNow());
on("wallpapers:changed", () => (isOpen ? renderAll() : (dirty = true)));
on("themes:changed", () => (isOpen ? renderAll() : (dirty = true)));
on("state:theme", () => isOpen && view === "wall" && renderMain());
on("state:off", (v) => v && closeLibrary());
on("overlay:open", (k) => { if (k !== "library") closeLibrary(); });