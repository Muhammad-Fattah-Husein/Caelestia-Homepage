import { state, setState, on, emit } from "../core/state.js";
import { FALLBACK, loadWallpapers, wallpapers } from "../appearance/wallpapers.js";

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

const NEUTRAL_SHARE = 0.04;   // di bawah ini (kira-kira 8% piksel berwarna sedang) gambar dianggap netral: abu-abu, hitam-putih

// hue dominan + apakah gambarnya hampir tanpa warna (dipakai penyaring warna di huefilter.js)
export function hueInfo(img) {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);

  const buckets = new Array(18).fill(0);   // 360° dibagi per 20°
  for (let i = 0; i < data.length; i += 4) {
    const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    if (s < 0.25 || l < 0.15 || l > 0.85) continue;  // buang abu-abu, gelap, terang
    buckets[Math.floor(h / 20) % 18] += s;           // makin jenuh, makin berbobot
  }

  const best = buckets.indexOf(Math.max(...buckets));
  const total = buckets.reduce((a, b) => a + b, 0);
  return {
    hue: buckets[best] === 0 ? 270 : best * 20 + 10,   // fallback ungu
    neutral: total < size * size * NEUTRAL_SHARE,
  };
}
const dominantHue = (img) => hueInfo(img).hue;

function applyTheme(h) {
  const root = document.documentElement.style;
  root.setProperty("--primary",    `hsl(${h} 80% 78%)`);
  root.setProperty("--bg",         `hsl(${h} 25% 8%)`);
  root.setProperty("--surface",    `hsl(${h} 20% 14%)`);
  root.setProperty("--on-surface", `hsl(${h} 30% 90%)`);
}

// daftar tema berasal dari registry wallpaper dan wallpaper yang ditambahkan lewat halaman
export const THEMES = FALLBACK.map((w) => ({ ...w })); // isi sementara, diganti setelah daftar selesai dimuat

// ---- transisi ganti wallpaper: lingkaran bertepi lembut melebar dari titik klik ----
let origin = { x: innerWidth, y: 0 };   // bawaan: pojok kanan atas (dipakai kalau belum ada klik)
addEventListener("pointerdown", (e) => { origin = { x: e.clientX, y: e.clientY }; }, true);

let endWipe = null;

function wipeTo(wall, src) {
  endWipe?.();   // transisi sebelumnya belum selesai: selesaikan dulu
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || !wall.style.backgroundImage) {   // tanpa animasi, atau wallpaper pertama saat halaman dibuka
    wall.style.backgroundImage = `url("${src}")`;
    return;
  }

  const cs = getComputedStyle(wall);
  const next = document.createElement("div");
  next.setAttribute("aria-hidden", "true");
  Object.assign(next.style, {
    position: cs.position === "static" ? "fixed" : cs.position,
    inset: "0",
    zIndex: cs.zIndex === "auto" ? "" : cs.zIndex,
    backgroundImage: `url("${src}")`,
    backgroundSize: cs.backgroundSize,
    backgroundPosition: cs.backgroundPosition,
    backgroundRepeat: cs.backgroundRepeat,
    filter: cs.filter,
    pointerEvents: "none",
  });
  wall.after(next);   // tepat di atas wallpaper lama

  const { x, y } = origin;
  const max = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const SOFT = 160, DUR = 900;   // lebar tepi lembut (px) dan lama animasi (ms)
  const t0 = performance.now();
  let raf = 0;

  const paint = (r) => {
    const m = `radial-gradient(circle at ${x}px ${y}px,#000 ${Math.max(0, r - SOFT)}px,transparent ${r}px)`;
    next.style.maskImage = next.style.webkitMaskImage = m;
  };
  endWipe = () => {
    cancelAnimationFrame(raf);
    wall.style.backgroundImage = `url("${src}")`;   // wallpaper lama diganti permanen
    next.remove();
    endWipe = null;
  };

  paint(0);
  const tick = (now) => {
    const p = Math.min(1, (now - t0) / DUR);
    paint((1 - Math.pow(1 - p, 3)) * (max + SOFT));   // easeOutCubic
    if (p < 1) raf = requestAnimationFrame(tick);
    else endWipe();
  };
  raf = requestAnimationFrame(tick);
}

let latest = 0;

export async function setWallpaper(src) {
  const mine = ++latest;
  try {
    const img = await loadImage(src);
    if (mine !== latest) return;   // sudah ada pilihan yang lebih baru, abaikan
    wipeTo(document.getElementById("wallpaper"), src);
    const hue = dominantHue(img);
    applyTheme(hue);
    emit("theme:changed", hue);
  } catch (err) {
    console.warn("Failed to load wallpaper:", err);
    emit("toast", { title: "Wallpaper", message: "Could not load image", type: "error" });
  }
}

export function setTheme(i) {
  setState("theme", (i + THEMES.length) % THEMES.length);   // muter balik di ujung
}

on("state:theme", i => {
  setWallpaper(THEMES[i].src);
  emit("toast", { title: "Theme changed", message: THEMES[i].name, duration: 2500 });
  try { localStorage.setItem("theme", THEMES[i].id) } catch {}
});

// tema tersimpan sebagai id wallpaper (format lama: nomor urut)
let savedId = null;
try {
  const raw = localStorage.getItem("theme");
  if (raw !== null) savedId = /^\d+$/.test(raw) ? (THEMES[Number(raw)]?.id ?? null) : raw;
} catch {}
{
  const i = THEMES.findIndex((t) => t.id === savedId);
  if (i >= 0) state.theme = i;
}
setWallpaper(THEMES[state.theme].src);

// daftar wallpaper selesai dimuat atau berubah: samakan THEMES dan jaga agar tema aktif tetap yang sama
let synced = false;
function syncThemes() {
  const first = !synced;
  synced = true;
  const wantId = (first ? savedId : null) ?? THEMES[state.theme]?.id;
  const curSrc = THEMES[state.theme]?.src;
  const next = wallpapers();
  if (!next.length) return;
  THEMES.length = 0;
  THEMES.push(...next);
  let i = THEMES.findIndex((t) => t.id === wantId);
  if (i < 0) i = 0;
  state.theme = i; // Keep sync silent; do not show a "Theme changed" toast.
  try { localStorage.setItem("theme", THEMES[i].id); } catch {}
  if (THEMES[i].src !== curSrc) setWallpaper(THEMES[i].src);
  emit("themes:changed");
}
on("wallpapers:changed", syncThemes);
loadWallpapers();