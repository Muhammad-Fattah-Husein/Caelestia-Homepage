import { state, setState, on } from "../core/state.js";
import { THEMES, setTheme } from "../system/theme.js";
import { Spring } from "./spring.js";
import { motionReduced } from "../core/prefs.js";
import { openLibrary } from "../core/features.js";
import { createHueDots, themeMatches } from "../system/huefilter.js";

// Pemilih wallpaper ala carousel: kartu potret berjajar di tengah layar, kartu tengah paling besar,
// makin jauh makin kecil sehingga ujung atasnya membentuk lengkung. Carousel tetap terbuka saat
// wallpaper berganti (transisinya ada di theme.js).
const CARD_W = 100, CARD_H = 268, GAP = 6;
const SKEW = -12;      // kemiringan kartu (derajat); gambar di dalamnya dimiringkan sebaliknya supaya tetap tegak
const FALL = 0.15;     // tetap
const SHOWN = 12;
const POS = { stiffness: 190, damping: 25 };
const SPREAD = { stiffness: 170, damping: 22 };

const css = `
.wp{position:fixed;top:0;right:0;bottom:0;left:58px;z-index:70;opacity:0;pointer-events:none;overflow:hidden;
  touch-action:none;user-select:none;-webkit-user-select:none;outline:0}
.wp.open{pointer-events:auto}
.wp-track{position:absolute;inset:0;pointer-events:none}
.wp-card{position:absolute;left:0;top:0;width:${CARD_W}px;height:${CARD_H}px;margin:0;padding:0;border:0;
  border-radius:6px;overflow:hidden;background:var(--surface-2,#222);cursor:pointer;pointer-events:auto;
  will-change:transform;box-shadow:0 6px 18px rgba(0,0,0,.3);outline:0}
.wp-card img{position:absolute;left:50%;top:0;width:165%;max-width:none;height:100%;object-fit:cover;display:block;
  pointer-events:none;-webkit-user-drag:none;transform:translateX(-50%) skewX(${-SKEW}deg)}
.wp-card.now{box-shadow:0 0 0 2px var(--primary,#cba6f7),0 10px 30px rgba(0,0,0,.35)}
.wp-card:hover{box-shadow:0 0 0 1.5px rgba(255,255,255,.65),0 6px 18px rgba(0,0,0,.3)}
.wp-card:focus-visible{box-shadow:0 0 0 3px var(--primary,#cba6f7)}
.wp-label{position:absolute;left:50%;transform:translateX(-50%);padding:4px 12px;border-radius:999px;
  background:color-mix(in srgb,var(--surface,#1e1e2e) 80%,transparent);color:var(--on-surface,#eee);
  font:600 13px/1.4 var(--font,system-ui);pointer-events:none;white-space:nowrap;backdrop-filter:blur(8px)}
.wp-bar{position:absolute;left:50%;bottom:28px;transform:translateX(-50%);display:flex;gap:14px;align-items:center;
  color:var(--muted,#aaa);font:12px/1 var(--font,system-ui)}
.wp-manage{border:0;border-radius:999px;padding:7px 14px;cursor:pointer;font:inherit;
  background:color-mix(in srgb,var(--surface,#1e1e2e) 80%,transparent);color:var(--on-surface,#eee)}
.wp-manage:hover{background:var(--surface-2,#2a2a3a)}
.wp-dots{position:absolute;left:50%;bottom:70px;transform:translateX(-50%);display:flex;justify-content:center}
.wp-dots .hue-dots{padding:0;flex-wrap:nowrap;gap:12px}
.wp-dots .hue-note{position:absolute;left:50%;bottom:26px;transform:translateX(-50%);white-space:nowrap}
html.wp-picking #wd-layer{opacity:0;pointer-events:none}
#wd-layer{transition:opacity .25s}
`;
const styleEl = document.createElement("style");
styleEl.textContent = css;
document.head.append(styleEl);

const root = document.createElement("div");
root.className = "wp";
root.tabIndex = -1;
root.inert = true;
root.setAttribute("role", "dialog");
root.setAttribute("aria-label", "Choose a wallpaper");
const track = document.createElement("div");
track.className = "wp-track";
const label = document.createElement("div");
label.className = "wp-label";
const bar = document.createElement("div");
bar.className = "wp-bar";
const hint = document.createElement("span");
hint.textContent = "← → or scroll · Enter to apply · Esc to close";
const manage = document.createElement("button");
manage.type = "button";
manage.className = "wp-manage";
manage.textContent = "＋ Manage wallpapers";
bar.append(hint, manage);
const dots = document.createElement("div");
dots.className = "wp-dots";
dots.append(createHueDots({ keepFocus: true }));   // titik warna: menyaring kartu menurut warna wallpaper
root.append(track, label, dots, bar);
document.body.append(root);

const pos = new Spring(0, POS);
const spread = new Spring(0, SPREAD);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const trigger = document.getElementById("bar-title");
const syncTrigger = () => {
  trigger.textContent = THEMES[state.theme]?.name ?? "";
};
trigger.setAttribute("aria-expanded", "false");
syncTrigger();

let cards = [], isOpen = false, target = 0, raf = 0, last = 0, lastFocus = null, snapTimer = 0;
let openedAt = 0;   // waktu carousel dibuka, untuk mengabaikan tombol yang menjadi pemicunya

const mod = (n, m) => ((n % m) + m) % m;

// kartu yang lolos penyaring warna; posisi carousel (target, pos) dihitung di antara kartu-kartu ini saja
let vis = [], visPos = new Map(), visSig = "";
function recompute() {   // true kalau daftar yang tampil berubah
  vis = THEMES.map((_, i) => i).filter((i) => themeMatches(THEMES[i]));
  visPos = new Map(vis.map((i, k) => [i, k]));
  const sig = vis.join(",");
  const changed = sig !== visSig;
  visSig = sig;
  return changed;
}
recompute();

const sel = () => (vis.length ? vis[mod(Math.round(target), vis.length)] : -1);   // nomor tema pada kartu tengah
// selisih terpendek dari kartu aktif ke posisi k, boleh melewati ujung
const shortest = (k) => { const m = vis.length || 1; return mod(k - Math.round(target) + m / 2, m) - m / 2; };

function build() {
  cards = THEMES.map((t, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "wp-card";
    b.dataset.i = String(i);
    b.tabIndex = -1;
    b.setAttribute("aria-label", t.name);
    const img = document.createElement("img");
    img.src = t.thumb ?? t.src;
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.draggable = false;
    img.addEventListener("error", () => {
      if (t.thumb && img.getAttribute("src") === t.thumb) img.src = t.src;
      else img.remove();
    });
    b.append(img);
    return b;
  });
  track.replaceChildren(...cards);
  markNow();
}

function markNow() {
  cards.forEach((c, i) => c.classList.toggle("now", i === state.theme));
}

function layout() {
  const w = root.clientWidth, h = root.clientHeight;
  const cx = w / 2, cy = h / 2 - 10;
  const sp = spread.value;
  root.style.opacity = String(clamp(sp, 0, 1));
  const m = vis.length;
  for (let i = 0; i < cards.length; i++) {
    const el = cards[i];
    const k = visPos.get(i);
    const d = k === undefined ? Infinity : mod(k - pos.value + m / 2, m) - m / 2, a = Math.abs(d);   // jarak melingkar
    if (a > SHOWN) {
      if (el.style.visibility !== "hidden") el.style.visibility = "hidden";
      continue;
    }
    if (el.style.visibility === "hidden") el.style.visibility = "";
    const s = 1 / (1 + FALL * a);
    // jarak mendatar: integral dari skala, supaya kartu rapat dan tidak saling menimpa
    const x = Math.sign(d) * (CARD_W + GAP) * (Math.log(1 + FALL * a) / FALL) * sp;
    el.style.transform = `translate(${(cx + x - CARD_W / 2).toFixed(1)}px,${(cy - CARD_H / 2).toFixed(1)}px) scale(${s.toFixed(4)}) skewX(${SKEW}deg)`;
    el.style.zIndex = String(100 - Math.round(a * 10));
    el.style.opacity = String(clamp(Math.min((SHOWN - a) / 1.5, m > 3 ? (m / 2 - a) / 0.6 : 1), 0, 1));
  }
  label.style.top = cy + CARD_H / 2 + 22 + "px";
}

function frame(now) {
  raf = 0;
  const dt = Math.min(0.032, last ? (now - last) / 1000 : 0.016);
  last = now;
  pos.step(dt);
  spread.step(dt);
  layout();
  if (!(pos.settled && spread.settled)) raf = requestAnimationFrame(frame);
  else {
    last = 0;
    if (!isOpen) finishClose();
  }
}
const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };

function moveTo(t, { snap = false } = {}) {
  target = t;   // tidak dibatasi, nomor kartu dihitung lewat sel()
  label.textContent = THEMES[sel()]?.name ?? "";
  if (motionReduced()) { pos.snap(target); layout(); }
  else { pos.to(target); kick(); }
  clearTimeout(snapTimer);
  if (snap) snapTimer = setTimeout(() => moveTo(Math.round(target)), 140);   // gulir selesai: rapikan ke kartu terdekat
}

function apply(i) {
  if (!THEMES[i]) return;
  setTheme(i);
  closeWallPicker();   // pilihan sudah diterapkan: carousel langsung menutup
}

function finishClose() {
  root.inert = true;
  trigger.setAttribute("aria-expanded", "false");
  if (lastFocus?.isConnected) lastFocus.focus({ preventScroll: true });
  lastFocus = null;
}

export function openWallPicker() {
  if (state.off || state.prefsOpen || isOpen || !THEMES.length) return;
  ["panelOpen", "launcher", "terminal", "menu", "powerMenu"].forEach((k) => setState(k, false));
  isOpen = true;
  openedAt = performance.now();
  setState("themePicker", true);
  if (cards.length !== THEMES.length) build();
  else markNow();
  recompute();
  const k0 = visPos.get(state.theme);
  target = k0 ?? 0;   // tema aktif tersaring: mulai dari kartu pertama yang tampil
  pos.snap(target);
  label.textContent = THEMES[sel()]?.name ?? "";
  lastFocus = document.activeElement;
  root.inert = false;
  trigger.setAttribute("aria-expanded", "true");
  root.classList.add("open");
  document.documentElement.classList.add("wp-picking");
  root.focus({ preventScroll: true });
  if (motionReduced()) spread.snap(1);
  else { spread.snap(0); spread.to(1); }
  layout();
  kick();
}

export function closeWallPicker() {
  if (!isOpen) return;
  isOpen = false;
  setState("themePicker", false);
  clearTimeout(snapTimer);
  root.classList.remove("open");
  document.documentElement.classList.remove("wp-picking");
  if (motionReduced()) { spread.snap(0); layout(); finishClose(); }
  else { spread.to(0); kick(); }
}
export const toggleWallPicker = () => (isOpen ? closeWallPicker() : openWallPicker());

trigger.addEventListener("click", toggleWallPicker);
on("state:themePicker", (open) => open ? openWallPicker() : closeWallPicker());

// ---- interaksi ----
let drag = null, justDragged = false;
root.addEventListener("pointerdown", (e) => {
  if (!isOpen || (e.pointerType === "mouse" && e.button !== 0)) return;
  drag = { x: e.clientX, t: target, moved: false, id: e.pointerId };
});
root.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x;
  if (!drag.moved) {
    if (Math.abs(dx) < 6) return;
    drag.moved = true;
    root.setPointerCapture(e.pointerId);   // baru ditangkap saat benar-benar menggeser, supaya ketukan biasa tetap mengenai kartunya
  }
  moveTo(drag.t - dx / (CARD_W * 0.8));
});
const endDrag = () => {
  if (!drag) return;
  if (drag.moved) {
    justDragged = true;
    setTimeout(() => { justDragged = false; }, 0);
    moveTo(Math.round(target));
  }
  drag = null;
};
root.addEventListener("pointerup", endDrag);
root.addEventListener("pointercancel", endDrag);

root.addEventListener("wheel", (e) => {
  if (!isOpen) return;
  e.preventDefault();
  moveTo(target + (e.deltaY || e.deltaX) / 90, { snap: true });
}, { passive: false });

root.addEventListener("click", (e) => {
  if (justDragged) return;
  const card = e.target.closest(".wp-card");
  if (card) {
    const i = Number(card.dataset.i);
    moveTo(Math.round(target) + shortest(visPos.get(i) ?? 0));
    apply(i);
  } else if (e.target === root) closeWallPicker();
});

manage.addEventListener("click", () => {
  closeWallPicker();
  openLibrary("wall");
});

document.addEventListener("keydown", (e) => {
  if (!isOpen || e.timeStamp <= openedAt) return;   // abaikan Enter yang tadi membuka carousel
  if (e.key === "Escape") { closeWallPicker(); return; }
  const to = {
  ArrowRight: Math.round(target) + 1, ArrowLeft: Math.round(target) - 1,
}[e.key];
  if (to !== undefined) { e.preventDefault(); moveTo(to); }
  else if (e.key === "Enter") { e.preventDefault(); apply(sel()); }
});

// ---- mengikuti keadaan lain ----
on("state:theme", markNow);
on("state:theme", syncTrigger);
on("themes:changed", () => {
  cards = [];   // daftar berubah: dibangun ulang saat dibuka lagi
  recompute();
  target = clamp(target, 0, Math.max(0, vis.length - 1));
  syncTrigger();
  track.replaceChildren();
  if (isOpen) {
    build();
    moveTo(target);
  }
});

// titik warna diklik (atau analisis warna selesai saat ada yang dipilih): susun ulang kartu yang tampil
on("huefilter:changed", () => {
  const cur = vis.length ? sel() : state.theme;   // dihitung dengan daftar lama
  if (!recompute()) return;
  let k = visPos.get(cur);
  if (k === undefined) k = Math.max(0, vis.findIndex((i) => i > cur));   // kartu aktif tersaring: ambil yang berikutnya
  target = vis.length ? k : 0;
  if (!isOpen) return;
  label.textContent = THEMES[sel()]?.name ?? "";
  pos.snap(target);
  if (!motionReduced()) { spread.snap(0.8); spread.to(1); }   // kartu "mengembang" sebentar
  layout();
  kick();
});
for (const k of ["panelOpen", "launcher", "terminal", "menu", "powerMenu", "prefsOpen"]) {
  on("state:" + k, (open) => open && closeWallPicker());
}
on("state:off", (off) => off && closeWallPicker());
addEventListener("resize", () => isOpen && layout());