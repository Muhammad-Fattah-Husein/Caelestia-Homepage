import { state, setState, on, emit, uid } from "../core/state.js";
import { createIcon } from "../core/icons.js";
import { isPlaying } from "../music/audio.js";
import { DEFS } from "./widgetdefs.js";
import "../system/pluginhost.js"; // harus setelah widgetdefs.js; mendaftarkan widget plugin sebelum widget tersimpan dibaca
import { physics } from "../ux/wdphysics.js";
import { sfx, haptic } from "../ux/feedback.js";
import { motionReduced } from "../core/prefs.js";
   import { inset, onLayoutChange } from "../ui/layout.js";

const KEY = "widgets";
const GRID_KEY = "wdgrid";
const MAX = 12;
const layer = document.getElementById("wd-layer");

// widget lama yang bisa diskalakan; widget baru menyatakannya sendiri lewat def.resize
const LEGACY_SCALE = new Set(["clock", "pomodoro", "countdown", "checklist", "quote", "worldclock"]);
// "box" = lebar dan tinggi bebas (foto, catatan, RSS) | "scale" = diperbesar atau diperkecil utuh | null = tetap
const modeOf = (type) => DEFS[type]?.resize ?? (LEGACY_SCALE.has(type) ? "scale" : null);

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : (lo + hi) / 2));
const toX = (n) => clamp(n, Math.min(0.9, (inset().left + 38) / innerWidth), 0.95);
const toY = (n) => clamp(n, 0.06, Math.min(0.94, 1 - (inset().bottom + 6) / innerHeight));
const num = (n, lo, hi) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : undefined);
const ORIGIN = { get x() { return inset().left; }, get y() { return inset().top; } };

// data milik widget (tanggal, isi checklist, dll.), dibatasi ukurannya
const cleanData = (d) =>
  d && typeof d === "object" && !Array.isArray(d) && JSON.stringify(d).length <= 4000 ? d : undefined;

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (Array.isArray(raw)) {
      return raw.slice(0, MAX).flatMap((w) =>
        w && Object.hasOwn(DEFS, w.type) && typeof w.id === "string"
          ? [{
              id: w.id, type: w.type, x: toX(Number(w.x)), y: toY(Number(w.y)), data: cleanData(w.data),
              w: num(w.w, 100, 1600), h: num(w.h, 60, 1200), s: num(w.s, 0.5, 2.5),
            }]
          : []);
    }
  } catch {}
  return [];
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state.widgets)); } catch {}
}

state.widgets = load();

// ---------------------------------------------------------------
// Kisi penempel: sudut kiri atas widget menempel ke garis kisi
// ---------------------------------------------------------------
const SIZES = [20, 40, 80];

function loadGrid() {
  try {
    const g = JSON.parse(localStorage.getItem(GRID_KEY));
    if (g && typeof g === "object") return { on: g.on === true, size: SIZES.includes(g.size) ? g.size : 40 };
  } catch {}
  return { on: false, size: 40 };
}
const grid = loadGrid();

const gridEl = document.createElement("div");
gridEl.id = "wd-grid";
gridEl.setAttribute("aria-hidden", "true");
layer.before(gridEl);   // di bawah widget, di atas wallpaper

function paintGrid() {
  const r = document.documentElement;
  r.classList.toggle("grid-on", grid.on);
  r.style.setProperty("--g", grid.size + "px");
}
let flashTimer;
function flashGrid() {   // tampilkan kisi sebentar setelah pengaturannya diubah
  document.body.classList.add("wd-dragging");
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => document.body.classList.remove("wd-dragging"), 1200);
}

export const getGrid = () => ({ ...grid });
export function setGrid(patch) {
  const was = grid.on;
  Object.assign(grid, patch);
  try { localStorage.setItem(GRID_KEY, JSON.stringify(grid)); } catch {}
  paintGrid();
  if (grid.on && (!was || "size" in patch)) flashGrid();
  emit("grid:changed", getGrid());
}
export function toggleGrid() {
  setGrid({ on: !grid.on });
  emit("toast", { title: "Snap grid", message: grid.on ? `On · ${grid.size}px` : "Off", duration: 1800 });
}
paintGrid();

const snap1 = (v, origin) => Math.round((v - origin) / grid.size) * grid.size + origin;
function snapCenter(cx, cy, w, h) {   // titik tengah widget -> titik tengah baru supaya sudut kirinya pas di kisi
  if (!grid.on) return [cx, cy];
  return [snap1(cx - w / 2, ORIGIN.x) + w / 2, snap1(cy - h / 2, ORIGIN.y) + h / 2];
}

// ---------------------------------------------------------------
// Daftar widget
// ---------------------------------------------------------------
const fresh = new Set();   // id widget yang baru saja ditambahkan (bukan dipulihkan dari penyimpanan)

export function addWidget(type, x, y, { quiet = false } = {}) {
  const def = DEFS[type];
  if (!def) return;
  if (def.unique && state.widgets.some((w) => w.type === type)) {
    emit("toast", { title: "Already added", message: def.name, type: "warn" });
    return;
  }
  if (state.widgets.length >= MAX) {
    emit("toast", { title: "Widget limit reached", message: `Maximum ${MAX} widgets`, type: "warn" });
    return;
  }
  const w = { id: uid(), type, x: toX(x), y: toY(y) };
  fresh.add(w.id);
  setState("widgets", [...state.widgets, w]);
  if (!quiet) emit("toast", { title: "Widget added", message: def.name, duration: 2000 });
}

const patchWidget = (id, patch) =>
  setState("widgets", state.widgets.map((w) => (w.id === id ? { ...w, ...patch } : w)));
const removeWidget = (id) =>
  setState("widgets", state.widgets.filter((w) => w.id !== id));
const setData = (id, data) =>
  setState("widgets", state.widgets.map((w) => (w.id === id ? { ...w, data: cleanData(data) } : w)));
const defOf = (id) => DEFS[state.widgets.find((w) => w.id === id)?.type];

const mounted = new Map();   // id -> { el, body, cleanup?, onTap? }
const tapOf = (id) => mounted.get(id)?.onTap ?? defOf(id)?.onTap;   // aksi ketuk bisa per-widget

function snapNew(id) {   // widget baru dari daftar: ukurannya baru diketahui setelah tampil
  const m = mounted.get(id);
  if (!m || !grid.on) return;
  const r = m.el.getBoundingClientRect();
  const [cx, cy] = snapCenter(r.left + r.width / 2, r.top + r.height / 2, r.width, r.height);
  patchWidget(id, { x: toX(cx / innerWidth), y: toY(cy / innerHeight) });
}

function create(w) {
  const el = document.createElement("div");
  el.className = `wd-widget wd-${w.type}`;
  el.dataset.id = w.id;
  el.tabIndex = 0;
  el.setAttribute("aria-label", DEFS[w.type].name);

  const body = document.createElement("div");
  body.className = "wd-body";
  const rm = document.createElement("button");
  rm.className = "wd-remove";
  rm.setAttribute("aria-label", "Remove widget");
  rm.textContent = "✕";
  el.append(body, rm);

  if (modeOf(w.type)) {
    const rz = document.createElement("div");
    rz.className = "wd-resize";
    rz.title = "Drag to resize · double-click to reset";
    el.append(rz);
  }

  // didaftarkan sebelum mount, supaya penyimpanan saat mount tidak membuat widget ganda
  const entry = { el, body, phys: physics(el) };
  mounted.set(w.id, entry);
  layer.append(el);

  const ctx = {
    id: w.id,
    data: w.data ?? null,
    isNew: fresh.delete(w.id),
    save: (d) => queueMicrotask(() => setData(w.id, d)),
  };

  // satu widget yang error tidak boleh menjatuhkan widget lain
  let r;
  try {
    r = DEFS[w.type].mount(body, ctx);
  } catch (err) {
    console.error(`Failed to load widget "${w.type}":`, err);
    body.replaceChildren(createIcon("13_warning.png"));
  }
  Object.assign(entry, typeof r === "function" ? { cleanup: r } : (r ?? {}));   // mount boleh mengembalikan fungsi atau { cleanup, onTap }

  if (ctx.isNew) {
    entry.phys.pop();   // muncul membesar dengan sedikit pantulan
    if (grid.on) queueMicrotask(() => snapNew(w.id));
  }
}

function render() {
  const ids = new Set(state.widgets.map((w) => w.id));
  for (const [id, m] of mounted) {
    if (ids.has(id)) continue;
    m.cleanup?.();
    mounted.delete(id);
    if (motionReduced() || !m.el.animate || m.el.classList.contains("wd-disc")) m.el.remove();
    else {   // mengecil dan memudar sebentar; disc dilepas langsung karena kartu pemutarnya ikut di dalamnya
      m.el.style.pointerEvents = "none";
      m.el.animate([{ opacity: 1, scale: 1 }, { opacity: 0, scale: 0.6 }], { duration: 160, easing: "ease-in" })
        .onfinish = () => m.el.remove();
    }
  }
  for (const w of state.widgets) {
    if (!mounted.has(w.id)) create(w);
    const { el, body } = mounted.get(w.id);
    el.style.left = w.x * 100 + "%";
    el.style.top = w.y * 100 + "%";

    const mode = modeOf(w.type);
    const sized = mode === "box" && w.w && w.h;
    el.classList.toggle("sized", Boolean(sized));
    el.style.width = sized ? w.w + "px" : "";
    el.style.height = sized ? w.h + "px" : "";
    body.style.zoom = mode === "scale" && w.s && w.s !== 1 ? String(w.s) : "";
  }
}

layer.addEventListener("click", (e) => {
  const rm = e.target.closest(".wd-remove");
  if (rm) {
    sfx("remove");
    haptic("remove");
    removeWidget(rm.closest(".wd-widget").dataset.id);
  }
});

layer.addEventListener("dblclick", (e) => {   // klik dua kali pada pegangan: ukuran kembali ke bawaan
  const h = e.target.closest(".wd-resize");
  if (h) patchWidget(h.closest(".wd-widget").dataset.id, { w: undefined, h: undefined, s: undefined });
});

layer.addEventListener("keydown", (e) => {
  if (!e.target.matches(".wd-widget")) return;
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    tapOf(e.target.dataset.id)?.();
  } else if (e.key === "Delete") {   // hapus lewat keyboard
    e.preventDefault();
    sfx("remove");
    haptic("remove");
    removeWidget(e.target.dataset.id);
  }
});

// ubah ukuran lewat pegangan di pojok kanan bawah
layer.addEventListener("pointerdown", (e) => {
  const handle = e.target.closest(".wd-resize");
  if (!handle || e.button !== 0) return;
  e.preventDefault();

  const el = handle.closest(".wd-widget");
  const id = el.dataset.id;
  const rec = state.widgets.find((w) => w.id === id);
  if (!rec) return;
  const mode = modeOf(rec.type);
  const [minW, minH] = DEFS[rec.type].min ?? [140, 100];
  const r = el.getBoundingClientRect();
  const sx = e.clientX, sy = e.clientY;
  const s0 = rec.s ?? 1;
  let out = null, lastW = 0, lastH = 0;

  handle.setPointerCapture(e.pointerId);
  document.body.classList.add("wd-dragging");

  const move = (ev) => {
    const dx = ev.clientX - sx, dy = ev.clientY - sy;
    if (mode === "box") {
      const maxW = Math.max(minW, innerWidth - r.left - inset().right);
const maxH = Math.max(minH, innerHeight - r.top - inset().bottom);
      let w = clamp(r.width + dx, minW, maxW);
      let h = clamp(r.height + dy, minH, maxH);
      if (grid.on) {   // tepi kanan dan bawah menempel ke kisi
        w = clamp(snap1(r.left + w, ORIGIN.x) - r.left, minW, maxW);
        h = clamp(snap1(r.top + h, ORIGIN.y) - r.top, minH, maxH);
      }
      if (grid.on && (Math.round(w) !== lastW || Math.round(h) !== lastH)) { sfx("snap"); haptic("snap"); }
      lastW = Math.round(w);
      lastH = Math.round(h);
      const x = toX((r.left + w / 2) / innerWidth);   // sudut kiri atas tetap, jadi titik tengah ikut bergeser
      const y = toY((r.top + h / 2) / innerHeight);
      Object.assign(el.style, { width: w + "px", height: h + "px", left: x * 100 + "%", top: y * 100 + "%" });
      el.classList.add("sized");
      out = { w: Math.round(w), h: Math.round(h), x, y };
    } else {
      const s = clamp(s0 * (1 + (dx + dy) / (r.width + r.height)), 0.6, 2.2);
      el.querySelector(".wd-body").style.zoom = String(s);
      out = { s: Math.round(s * 100) / 100 };
    }
  };
  const up = () => {
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", up);
    handle.removeEventListener("pointercancel", up);
    document.body.classList.remove("wd-dragging");
    if (out) patchWidget(id, out);
  };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", up);
  handle.addEventListener("pointercancel", up);
});

// geser widget yang sudah ada di halaman, dengan fisika pegas:
// posisi resmi (left/top) baru pindah saat dilepas; selama diseret widget meluncur mengikuti kursor
layer.addEventListener("pointerdown", (e) => {
  const el = e.target.closest(".wd-widget");
  if (!el || e.button !== 0) return;
  // kotak teks, tautan, centang, dan tombol di dalam widget bekerja normal, bukan memulai geseran
  if (e.target.closest(".wd-remove, .wd-resize, a, input, textarea, select, button, label, [data-nodrag]")) return;

  const id = el.dataset.id;
  const rec = state.widgets.find((w) => w.id === id);
  const phys = mounted.get(id)?.phys;
  if (!rec || !phys) return;
  const sx = e.clientX, sy = e.clientY;
  let moved = false, fx = rec.x, fy = rec.y;
  el.setPointerCapture(e.pointerId);

  const move = (ev) => {
    if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;   // geseran kecil = klik
    if (!moved) {
      moved = true;
      phys.grab();
      el.classList.add("lifted");
      document.body.classList.add("wd-dragging");
      sfx("pick");
      haptic("pick");
    }
    const [cx, cy] = snapCenter(ev.clientX, ev.clientY, el.offsetWidth, el.offsetHeight);
    const nx = toX(cx / innerWidth), ny = toY(cy / innerHeight);
    if (grid.on && (nx !== fx || ny !== fy)) { sfx("snap"); haptic("snap"); }   // pindah ke sel kisi lain
    fx = nx;
    fy = ny;
    phys.follow((fx - rec.x) * innerWidth, (fy - rec.y) * innerHeight);
  };
  const up = () => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", up);
    document.body.classList.remove("wd-dragging");
    el.classList.remove("lifted");
    if (!moved) return tapOf(id)?.();
    const off = phys.offset();
    patchWidget(id, { x: fx, y: fy });   // left/top pindah ke tujuan (render berjalan langsung)
    phys.release({ x: off.x - (fx - rec.x) * innerWidth, y: off.y - (fy - rec.y) * innerHeight });   // sisa jarak diluncurkan ke 0
    sfx("drop");
    haptic("drop");
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
});

on("audio:play", (p) => layer.classList.toggle("playing", p));
layer.classList.toggle("playing", isPlaying());

on("state:widgets", () => { render(); save(); });
render();

// ---- Snap grid controls in the Workspaces tab ----
(function buildGridRow() {
  const hint = document.querySelector(".wd-hint");
  if (!hint) return;
  const row = document.createElement("div");
  row.className = "grid-row";
  const label = document.createElement("label");
  const cb = document.createElement("input");
  cb.type = "checkbox";
  label.append(cb, " Snap to grid");
  const sizes = document.createElement("span");
  sizes.className = "grid-sizes";
  for (const n of SIZES) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = n;
    b.dataset.n = String(n);
    b.setAttribute("aria-label", `${n}-pixel grid`);
    b.addEventListener("click", () => setGrid({ size: n, on: true }));
    sizes.append(b);
  }
  row.append(label, sizes);
  hint.before(row);
  cb.addEventListener("change", () => setGrid({ on: cb.checked }));
  const sync = () => {
    cb.checked = grid.on;
    sizes.querySelectorAll("button").forEach((b) => b.classList.toggle("active", Number(b.dataset.n) === grid.size));
  };
  on("grid:changed", sync);
  sync();
})();