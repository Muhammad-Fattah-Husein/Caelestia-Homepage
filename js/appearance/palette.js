import { state, on, emit } from "../core/state.js";
import { FONTS, motionReduced } from "../core/prefs.js";

const root = document.documentElement;
const HUE_KEY = "wallhue";    // hue wallpaper terakhir, supaya warna tidak berkedip saat halaman dimuat
const SUN_KEY = "suncache";   // jam terbit dan terbenam terakhir

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

let wallHue = (() => {
  const raw = store.get(HUE_KEY);
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : 270;
})();

let scheme = "dark", why = "", lastKey = "", applying = false;

// penimpa dari suasana: hanya tiga kunci ini yang boleh disentuh, apa pun isi state.modeLook
function cleanLook(l) {
  const out = {};
  if (!l || typeof l !== "object") return out;
  if (["dark", "light", "auto"].includes(l.scheme)) out.scheme = l.scheme;
  if (Number.isFinite(l.hueShift)) out.hueShift = Math.max(-180, Math.min(180, Math.round(l.hueShift)));
  if (Number.isFinite(l.sat)) out.sat = Math.max(0, Math.min(100, Math.round(l.sat)));
  return out;
}
const eff = () => ({ ...state.prefs, ...cleanLook(state.modeLook) });   // pengaturanmu, ditimpa suasana
const modeLabel = () => String(state.modeLook?.label ?? "").slice(0, 24) || "active";

const effectiveHue = (p = eff()) =>
  p.hueFollow ? (((wallHue + p.hueShift) % 360) + 360) % 360 : p.hue;

export const schemeInfo = () => ({
  scheme, why,
  mode: modeLabel(),
  override: Object.keys(cleanLook(state.modeLook)),   // kunci yang sedang ditimpa suasana
});

function syncSensor() {
  const p = eff();
  if (p.scheme === "auto" && p.autoSource === "light") startSensor();
  else {
    stopSensor();
    if (sensorStatus !== "unsupported") sensorStatus = "idle";
  }
}

// satu fungsi menghasilkan seluruh warna; f menskalakan saturasi permukaan mengikuti slider (80 = bawaan)
function palette(h, sat, mode) {
  const f = sat / 80;
  const S = (v) => Math.min(100, Math.round(v * f));
  if (mode === "dark") {
    return {
      "--primary": `hsl(${h} ${sat}% 78%)`,
      "--bg": `hsl(${h} ${S(25)}% 8%)`,
      "--surface": `hsl(${h} ${S(20)}% 14%)`,
      "--surface-2": `hsl(${h} ${S(20)}% 19%)`,
      "--on-surface": `hsl(${h} ${S(30)}% 90%)`,
      "--muted": `hsl(${h} ${S(15)}% 65%)`,
      "--danger": "hsl(355 72% 64%)",
      "--warn": "hsl(40 88% 62%)",
      "--ok": "hsl(142 45% 48%)",
    };
  }
  return {   // terang: krem atau pastel; aksen digelapkan supaya tetap terbaca di atas permukaan terang
    "--primary": `hsl(${h} ${sat}% 40%)`,
    "--bg": `hsl(${h} ${S(35)}% 92%)`,
    "--surface": `hsl(${h} ${S(40)}% 96%)`,
    "--surface-2": `hsl(${h} ${S(35)}% 91%)`,
    "--on-surface": `hsl(${h} ${S(35)}% 14%)`,
    "--muted": `hsl(${h} ${S(15)}% 38%)`,
    "--danger": "hsl(352 70% 46%)",
    "--warn": "hsl(33 90% 38%)",
    "--ok": "hsl(142 55% 30%)",
  };
}

const loadedFonts = new Set();
function loadFont(key) {
  const f = FONTS[key];
  if (!f?.google || loadedFonts.has(key)) return;
  loadedFonts.add(key);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${f.google}&display=swap`;
  link.addEventListener("error", () => {
    loadedFonts.delete(key);
    link.remove();
    emit("toast", { title: "Font", message: `Could not download ${f.name}; using fallback font`, type: "warn" });
  });
  document.head.append(link);
}

const cleanSun = (d) => {
  const list = (a) => (Array.isArray(a) ? a.filter(Number.isFinite).slice(0, 10) : []);
  const rise = list(d?.rise), set = list(d?.set);
  return rise.length && set.length ? { rise, set } : null;
};
let sun = (() => { try { return cleanSun(JSON.parse(store.get(SUN_KEY))); } catch { return null; } })();

// true = malam, false = siang, null = data belum ada atau sudah kedaluwarsa
function sunNight(now = Date.now()) {
  if (!sun) return null;
  const nextSet = sun.set.filter((s) => s > now).sort((a, b) => a - b)[0];
  if (nextSet === undefined) return null;
  const rise = sun.rise.filter((r) => r < nextSet).sort((a, b) => b - a)[0];
  if (rise === undefined) return null;
  return now < rise;   // sebelum terbit = malam; sesudah terbit dan sebelum terbenam = siang
}

let sensor = null, lightScheme = null, sensorStatus = "idle";
export const lightStatus = () => sensorStatus;   // idle | waiting | active | unsupported | error

function startSensor() {
  if (sensor || sensorStatus === "unsupported" || sensorStatus === "error") return;
  if (!("AmbientLightSensor" in window)) { sensorStatus = "unsupported"; return; }
  try {
    const s = new AmbientLightSensor({ frequency: 0.5 });
    let dark = 0, bright = 0;
    s.addEventListener("reading", () => {
      if (sensorStatus !== "active") { sensorStatus = "active"; emit("palette:changed", { scheme, why }); }
      const lux = s.illuminance;
      if (!Number.isFinite(lux)) return;
      if (lux < 25) { dark++; bright = 0; }
      else if (lux > 90) { bright++; dark = 0; }
      else dark = bright = 0;   // di antara dua ambang: tidak mengubah apa-apa
      const next = dark >= 3 ? "dark" : bright >= 3 ? "light" : lightScheme;
      if (next !== lightScheme) { lightScheme = next; resolve(true); }
    });
    s.addEventListener("error", () => { stopSensor(); sensorStatus = "error"; resolve(true); });
    s.start();
    sensor = s;
    sensorStatus = "waiting";
  } catch {
    sensor = null;
    sensorStatus = "error";
  }
}

function stopSensor() {
  try { sensor?.stop(); } catch {}
  sensor = null;
  lightScheme = null;
}

const sysDark = matchMedia("(prefers-color-scheme: dark)");

function resolve(animated = true) {
  const p = eff();
  const look = cleanLook(state.modeLook);
  syncSensor();

  const night = p.autoSource === "sun" ? sunNight() : null;
  let next, reason;
  if (p.scheme !== "auto") {
    next = p.scheme;
    reason = look.scheme && look.scheme !== "auto" ? `the ${modeLabel()} mode` : "selected manually";
  } else if (p.autoSource === "light" && lightScheme) { next = lightScheme; reason = "light sensor"; }
  else if (night !== null) { next = night ? "dark" : "light"; reason = "sunrise and sunset"; }
  else {
    next = sysDark.matches ? "dark" : "light";
    reason = p.autoSource === "system"
      ? "system settings"
      : `system settings because ${p.autoSource === "sun" ? "sun data" : "light sensor"} is unavailable`;
  }

  const changed = next !== scheme;
  scheme = next;
  why = reason;
  apply(animated && changed, false);
  emit("palette:changed", { scheme, why });
}

function announce() {
  applying = true;
  try { emit("theme:changed", wallHue); }   // pemberi tahu kanvas (cincin musik, batang, efek) agar membaca warna baru
  finally { applying = false; }
  emit("palette:changed", { scheme, why });
}

function apply(animated, force) {
  const p = eff();
  const hue = Math.round(effectiveHue(p));
  const key = [scheme, hue, p.sat, p.font, p.fontScale].join("|");
  if (!force && key === lastKey) return;
  lastKey = key;

  const run = () => {
    for (const [k, v] of Object.entries(palette(hue, p.sat, scheme))) root.style.setProperty(k, v);
    root.style.colorScheme = scheme;
    root.dataset.scheme = scheme;
    root.style.setProperty("--font", FONTS[p.font].stack);
    root.style.setProperty("--font-scale", String(p.fontScale / 100));
  };
  loadFont(p.font);

  if (animated && document.startViewTransition && !motionReduced()) {
    document.startViewTransition(run).updateCallbackDone.then(announce, announce);
  } else {
    run();
    announce();
  }
}

on("theme:changed", (h) => {   // dari theme.js, setiap wallpaper berganti
  if (applying) return;        // abaikan peristiwa yang kita kirim sendiri
  if (Number.isFinite(h)) { wallHue = h; store.set(HUE_KEY, String(h)); }
  apply(false, true);          // dipaksa: theme.js baru saja menimpa variabel dengan palet gelapnya
});
on("state:prefs", () => resolve(true));
on("state:modeLook", () => resolve(true));
on("sun:data", (d) => {
  sun = cleanSun(d);
  if (sun) store.set(SUN_KEY, JSON.stringify(sun));
  resolve(true);
});
on("power:on", () => resolve(true));
sysDark.addEventListener("change", () => resolve(true));
document.addEventListener("visibilitychange", () => { if (!document.hidden) resolve(true); });
setInterval(() => resolve(true), 60_000);   // memeriksa batas terbit atau terbenam; murah karena tidak berubah = berhenti di cek kunci

resolve(false);