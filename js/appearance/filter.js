import { state, setState, on, zone, closeOthers } from "../core/state.js";
import { createSlider } from "../ux/slider.js";

const KEY = "filter";
const WARM = [255, 165, 85];
const COOL = [135, 175, 255];
const DIM_MAX = 0.8;     // paling gelap: 80% hitam, layar masih terbaca
const BOOST_MAX = 0.7;   // paling terang: kekuatan lapisan soft-light
const PEEK_MS = 2500;    // panel yang "mengintip" karena pintasan keyboard menutup sendiri setelah ini

// ---- suhu otomatis ----
// jadwal [jam, suhu]; di antara dua titik diinterpolasi linear (positif = hangat)
// ubah angkanya kalau mau lebih awal/lambat atau lebih kuat/lemah
const SCHEDULE = [[0, 55], [5, 55], [7, 0], [17, 0], [19, 30], [21, 50], [24, 55]];
const hourFmt = new Intl.DateTimeFormat("en-GB", {
  hour: "numeric", minute: "numeric", hourCycle: "h23", timeZone: zone,
});

export function autoTemp(date = new Date()) {
  const p = Object.fromEntries(hourFmt.formatToParts(date).map(x => [x.type, Number(x.value)]));
  const h = p.hour + p.minute / 60;
  for (let i = 1; i < SCHEDULE.length; i++) {
    const [h0, t0] = SCHEDULE[i - 1], [h1, t1] = SCHEDULE[i];
    if (h <= h1) return Math.round(t0 + ((t1 - t0) * (h - h0)) / (h1 - h0));
  }
  return SCHEDULE.at(-1)[1];
}

export function toggleAutoTemp(enable = !state.filter.auto) {
  setState("filter", {
    ...state.filter,
    auto: enable,
    temp: enable ? autoTemp() : state.filter.temp,   // dimatikan: suhu berhenti di nilai terakhir
  });
}

// ---- elemen ----
const tint = document.getElementById("tint");
const dim = document.getElementById("dim");
const panel = document.getElementById("filter-panel");
const edge = document.getElementById("edge-r");
const trigger = document.getElementById("btn-filter");
const tempOut = document.getElementById("val-temp");
const lightOut = document.getElementById("val-bright");
const autoBtn = document.getElementById("btn-auto-temp");

const clamp = (n, lo, hi, fallback) =>
  Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;

try {
  const saved = JSON.parse(localStorage.getItem(KEY));
  if (saved) {
    // data lama memakai "bright" (20..100, 100 = normal); ubah ke skala baru -100..100
    const light = Number.isFinite(saved.light) ? saved.light
                : Number.isFinite(saved.bright) ? (saved.bright - 100) * 1.25
                : 0;
    state.filter = {
      temp: clamp(saved.temp, -100, 100, 0),
      light: Math.round(clamp(light, -100, 100, 0)),
      auto: saved.auto === true,
    };
  }
} catch {}
if (state.filter.auto) state.filter.temp = autoTemp();   // hitung ulang sesuai jam sekarang

let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state.filter)); } catch {}
  }, 250);
}

const tempSlider = createSlider({
  label: "Color temperature", min: -100, max: 100, value: state.filter.temp, origin: 0, reset: 0,
  onInput: v => setState("filter", { ...state.filter, temp: v, auto: false }),   // digeser tangan = otomatis mati
  onChange: save,
});
const lightSlider = createSlider({
  label: "Brightness", min: -100, max: 100, value: state.filter.light, origin: 0, reset: 0,
  onInput: v => setState("filter", { ...state.filter, light: v }),
  onChange: save,
});
document.getElementById("sl-temp").append(tempSlider);
document.getElementById("sl-bright").append(lightSlider);

// Neutral buttons below each slider provide a reset option for touch and keyboard.
for (const [id, name, patch] of [
  ["sl-temp", "color temperature", () => ({ temp: 0, auto: false })],
  ["sl-bright", "brightness", () => ({ light: 0 })],
]) {
  const col = document.getElementById(id)?.closest(".fp-col");
  if (!col) continue;
  const b = document.createElement("button");
  b.type = "button";
  b.className = "fp-reset";
  b.textContent = "↺ Neutral";
  b.setAttribute("aria-label", `Reset ${name} to neutral`);
  b.addEventListener("click", () => setState("filter", { ...state.filter, ...patch() }));
  col.append(b);
}

function apply({ temp, light, auto }) {
  // suhu: lapisan warna dikalikan (multiply) dengan halaman; putih = tidak ada perubahan
  const s = Math.abs(temp) / 100;
  const target = temp > 0 ? WARM : COOL;
  tint.style.background = `rgb(${target.map(v => Math.round(255 + (v - 255) * s)).join(",")})`;
  tint.style.display = temp === 0 ? "none" : "block";

  // cahaya: di bawah 0 = lapisan hitam, di atas 0 = lapisan putih soft-light
  if (light === 0) {
    dim.style.display = "none";
  } else {
    const brighten = light > 0;
    dim.style.background = brighten ? "#fff" : "#000";
    dim.style.mixBlendMode = brighten ? "soft-light" : "normal";
    dim.style.opacity = (Math.abs(light) / 100) * (brighten ? BOOST_MAX : DIM_MAX);
    dim.style.display = "block";
  }

  // posisi slider ikut berubah saat diatur dari luar (suhu otomatis, mode, pintasan)
  tempSlider.setValue(temp);
  lightSlider.setValue(light);

  tempOut.textContent =
    (temp === 0 ? "Neutral" : `${temp > 0 ? "Warm" : "Cool"} ${Math.abs(temp)}%`) + (auto ? " · auto" : "");
  lightOut.textContent = light === 0 ? "Neutral" : `${light > 0 ? "Bright" : "Dim"} ${Math.abs(light)}%`;
  tempSlider.style.setProperty("--fill", temp > 0 ? "#ffa555" : temp < 0 ? "#87afff" : "var(--primary)");
  lightSlider.style.setProperty("--fill", light > 0 ? "#ffe08a" : light < 0 ? "#8e96a8" : "var(--primary)");
  autoBtn?.setAttribute("aria-pressed", String(Boolean(auto)));
}

on("state:filter", f => { apply(f); save(); });   // semua perubahan (slider, mode, otomatis) tersimpan
apply(state.filter);

// ---- suhu otomatis: cek tiap menit dan saat tab kembali aktif ----
function tickAuto() {
  if (!state.filter.auto || state.off) return;
  const t = autoTemp();
  if (t !== state.filter.temp) setState("filter", { ...state.filter, temp: t });
}
setInterval(tickAuto, 60_000);
on("power:on", tickAuto);
document.addEventListener("visibilitychange", () => { if (!document.hidden) tickAuto(); });
autoBtn?.addEventListener("click", () => toggleAutoTemp());

// ---- buka dan tutup panel ----
// Ada tiga cara membukanya: kursor singgah di tepi kanan (menutup sendiri), dibuka dengan sengaja
// lewat tombol, ketukan, geseran, atau keyboard (pin: bertahan sampai Esc atau klik di luar), dan
// "mengintip" saat nilainya diubah lewat pintasan (menutup sendiri setelah beberapa detik).
let closeTimer, peekTimer, dragging = false, pinned = false, opener = null;

export function openFilter({ pin = false, focus = false } = {}) {
  clearTimeout(closeTimer);
  clearTimeout(peekTimer);
  if (pin) pinned = true;
  if (focus && !state.menu) opener = document.activeElement;
  setState("menu", true);
  if (focus) tempSlider.focus({ preventScroll: true });
  if (pin) { pinned = true; closeOthers("menu"); }
}

export function closeFilter({ restore = false } = {}) {
  clearTimeout(closeTimer);
  clearTimeout(peekTimer);
  pinned = false;
  setState("menu", false);
  if (restore && opener?.isConnected) opener.focus({ preventScroll: true });
  opener = null;
}

export const toggleFilter = (opts = {}) =>
  state.menu ? closeFilter({ restore: true }) : openFilter({ pin: true, ...opts });

function scheduleClose() {
  if (dragging || pinned) return;
  clearTimeout(closeTimer);
  closeTimer = setTimeout(() => setState("menu", false), 300);
}

// tampilkan panel sebentar supaya perubahan terlihat, lalu tutup sendiri
function peek() {
  openFilter();
  if (pinned) return;
  peekTimer = setTimeout(() => {
    if (!pinned && !dragging && !panel.matches(":hover") && !panel.contains(document.activeElement)) closeFilter();
  }, PEEK_MS);
}

// ubah nilai langkah demi langkah (dipakai pintasan keyboard)
export function nudge(kind, delta) {
  const key = kind === "temp" ? "temp" : "light";
  const v = Math.max(-100, Math.min(100, state.filter[key] + delta));
  setState("filter", { ...state.filter, [key]: v, ...(kind === "temp" ? { auto: false } : {}) });
  peek();
}

edge.addEventListener("mouseenter", () => openFilter());
edge.addEventListener("mouseleave", scheduleClose);
panel.addEventListener("mouseenter", () => {
  clearTimeout(closeTimer);
  if (!state.menu) openFilter();
});
panel.addEventListener("mouseleave", scheduleClose);

panel.addEventListener("pointerdown", () => { dragging = true; });
const endDrag = () => {
  if (!dragging) return;
  dragging = false;
  if (!pinned && !panel.matches(":hover") && !edge.matches(":hover")) scheduleClose();
};
window.addEventListener("pointerup", endDrag);
window.addEventListener("pointercancel", endDrag);

on("state:menu", (isOpen) => {
  panel.classList.toggle("open", isOpen);
  panel.inert = !isOpen;
  trigger?.classList.toggle("active", isOpen);
  trigger?.setAttribute("aria-expanded", String(isOpen));
  if (!isOpen) pinned = false;
});

if (trigger) {   // tombol di bar kiri: ketuk, klik, atau Enter/Spasi
  trigger.setAttribute("aria-controls", "filter-panel");
  trigger.setAttribute("aria-expanded", "false");
  trigger.addEventListener("click", (e) => toggleFilter({ focus: e.detail === 0 }));
}

document.addEventListener("pointerdown", (e) => {
  if (state.menu && !state.modal && !panel.contains(e.target) && !e.target.closest("#edge-r, #btn-filter, #fab, #fab-menu"))
    closeFilter();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && state.menu) closeFilter({ restore: true });
});