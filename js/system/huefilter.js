import { emit, on } from "../core/state.js";
import { THEMES, hueInfo } from "./theme.js";

// Penyaring wallpaper menurut warna: titik warna di strip launcher dan panel tema (HP).
// Hue tiap wallpaper dihitung diam-diam di latar belakang, lalu disimpan supaya tidak dihitung ulang.
const KEY = "wall:hue";
const NEUTRAL = "n";
const COLORS = [   // [nama, hue pusat]; wallpaper masuk ke warna terdekat
  ["Red", 0], ["Orange", 30], ["Yellow", 55], ["Green", 125],
  ["Cyan", 180], ["Blue", 225], ["Purple", 275], ["Pink", 325],
];
const LABEL = { all: "All colors", [NEUTRAL]: "Neutral", ...Object.fromEntries(COLORS.map(([n], i) => [String(i), n])) };

const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
const dist = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };

// ---------- cache: id wallpaper -> { h, n } ----------
function readCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
  } catch {}
  return {};
}
let cache = readCache();
const saveCache = () => { try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch {} };

function bucketOf(c) {
  if (!c || !Number.isFinite(c.h)) return null;   // belum dihitung
  if (c.n) return NEUTRAL;
  let best = 0, bd = Infinity;
  COLORS.forEach(([, h], i) => { const d = dist(c.h, h); if (d < bd) { bd = d; best = i; } });
  return String(best);
}

// ---------- pilihan (boleh banyak; kosong = semua) ----------
const sel = new Set();
export const hueFilterActive = () => sel.size > 0;
export function themeMatches(t) {
  if (!sel.size || !t) return true;
  const b = bucketOf(cache[t.id]);
  return b !== null && sel.has(b);   // yang belum dianalisis disembunyikan sementara
}
export function nextVisible(themes, from, dir) {   // indeks tema berikutnya yang lolos penyaring (berputar di ujung)
  const n = themes.length;
  for (let k = 1; k <= n; k++) {
    const i = (((from + dir * k) % n) + n) % n;
    if (themeMatches(themes[i])) return i;
  }
  return from;
}

// ---------- menerapkan ke strip launcher dan grid panel tema ----------
function applyFilter() {
  const apply = (id, selector) => {
    const host = document.getElementById(id);
    if (!host) return;
    [...host.children].filter((c) => c.matches(selector)).forEach((b, i) => {
      b.classList.toggle("hf-hide", !themeMatches(THEMES[i]));
    });
  };
  apply("lc-themes", ".lc-theme:not(.lc-add)");
  apply("tp-grid", ".tp-item:not(.tp-add)");
}

// ---------- titik warna ----------
const sets = [];   // setiap deretan titik yang pernah dibuat (launcher dan panel tema)

function syncDots() {
  const counts = new Map();
  let known = 0;
  for (const t of THEMES) {
    const b = bucketOf(cache[t.id]);
    if (b !== null) { known++; counts.set(b, (counts.get(b) ?? 0) + 1); }
  }
  const complete = THEMES.length > 0 && known === THEMES.length;
  const visible = THEMES.filter(themeMatches).length;
  for (const { buttons, note } of sets) {
    for (const b of buttons) {
      const key = b.dataset.key;
      const on = key === "all" ? !sel.size : sel.has(key);
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
      b.classList.toggle("empty", key !== "all" && complete && !counts.get(key));
      b.title = LABEL[key] + (key !== "all" && complete ? ` · ${counts.get(key) ?? 0}` : "");
    }
    note.textContent = sel.size && !visible ? (complete ? "No wallpapers in these colors" : "Analyzing colors…") : "";
  }
}

function toggle(key) {
  if (key === "all") sel.clear();
  else if (sel.has(key)) sel.delete(key);
  else sel.add(key);
  syncDots();
  applyFilter();
  emit("huefilter:changed");
}

export function createHueDots({ keepFocus = false } = {}) {
  const wrap = el("div", "hue-dots");
  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", "Filter wallpapers by color");
  const buttons = [["all"], ...COLORS.map((_, i) => [String(i)]), [NEUTRAL]].map(([key]) => {
    const b = el("button", "hue-dot" + (key === "all" ? " all" : key === NEUTRAL ? " neutral" : ""));
    b.type = "button";
    b.dataset.key = key;
    b.setAttribute("aria-label", LABEL[key]);
    if (!["all", NEUTRAL].includes(key)) b.style.setProperty("--c", `hsl(${COLORS[Number(key)][1]} 75% 58%)`);
    if (keepFocus) b.tabIndex = -1;   // di launcher fokus harus tetap di kotak ketik
    b.addEventListener("click", () => toggle(key));
    return b;
  });
  const note = el("span", "hue-note");
  note.setAttribute("role", "status");
  wrap.append(...buttons, note);
  if (keepFocus) wrap.addEventListener("mousedown", (e) => e.preventDefault());
  sets.push({ buttons, note });
  syncDots();
  return wrap;
}

// ---------- analisis hue di latar belakang ----------
const failed = new Set();
let running = false;
const loadImg = (src) => new Promise((ok, fail) => {
  const i = new Image();
  i.onload = () => ok(i);
  i.onerror = fail;
  i.src = src;
});

async function analyze() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const t = THEMES.find((x) => !cache[x.id] && !failed.has(x.id));
      if (!t) break;
      try {
        const { hue, neutral } = hueInfo(await loadImg(t.thumb ?? t.src));
        cache[t.id] = { h: hue, n: neutral ? 1 : 0 };
        saveCache();
      } catch { failed.add(t.id); }
      syncDots();
      applyFilter();
      if (sel.size) emit("huefilter:changed");   // yang dipilih bisa baru saja tersembunyi
      await new Promise((r) => setTimeout(r, 120));   // satu per satu supaya tidak membebani
    }
  } finally { running = false; }
}

on("themes:changed", () => {
  const ids = new Set(THEMES.map((t) => t.id));
  let dirty = false;
  for (const k of Object.keys(cache)) if (!ids.has(k)) { delete cache[k]; dirty = true; }   // wallpaper yang sudah dihapus
  if (dirty) saveCache();
  syncDots();
  applyFilter();
  setTimeout(analyze, 2500);
});

// ---------- pasang ke halaman ----------
// strip launcher: gambar dibungkus supaya bisa berbentuk jajargenjang tanpa memiringkan isinya
function wrapThumbs(host) {
  for (const img of host.querySelectorAll(".lc-theme > img")) {
    const w = el("span", "skew-card");
    img.replaceWith(w);
    w.append(img);
  }
}
function watch(id, { dots, wrap }) {
  const host = document.getElementById(id);
  if (!host) return;
  host.before(createHueDots(dots));
  const run = () => { if (wrap) wrapThumbs(host); applyFilter(); };
  new MutationObserver(run).observe(host, { childList: true });
  run();
}
watch("lc-themes", { dots: { keepFocus: true }, wrap: true });
watch("tp-grid", { dots: {}, wrap: false });