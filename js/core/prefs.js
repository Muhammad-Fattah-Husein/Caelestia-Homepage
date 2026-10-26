import { state, setState, on, emit } from "./state.js";

const KEY = "prefs";

// semua kunci localStorage milik halaman ini: dipakai ekspor, impor, dan reset
export const STORAGE_KEYS = ["theme", "workspace", "filter", "shortcuts", "notes", "widgets", "mode", KEY];

export const SEARCH_ENGINES = {
  google:     { name: "Google",     url: "https://www.google.com/search?q={q}" },
  duckduckgo: { name: "DuckDuckGo", url: "https://duckduckgo.com/?q={q}" },
  bing:       { name: "Bing",       url: "https://www.bing.com/search?q={q}" },
  brave:      { name: "Brave",      url: "https://search.brave.com/search?q={q}" },
  ecosia:     { name: "Ecosia",     url: "https://www.ecosia.org/search?q={q}" },
};

// "google" = bagian ?family= di URL Google Fonts; "stack" = cadangan saat belum selesai diunduh atau gagal
export const FONTS = {
  system:  { name: "System default", stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  inter:   { name: "Inter",          stack: '"Inter", system-ui, sans-serif',          google: "Inter:wght@400;600" },
  plex:    { name: "IBM Plex Sans",  stack: '"IBM Plex Sans", system-ui, sans-serif',  google: "IBM+Plex+Sans:wght@400;600" },
  poppins: { name: "Poppins",        stack: '"Poppins", system-ui, sans-serif',        google: "Poppins:wght@400;600" },
  nunito:  { name: "Nunito (rounded)", stack: '"Nunito", system-ui, sans-serif',         google: "Nunito:wght@400;600" },
  grotesk: { name: "Space Grotesk",  stack: '"Space Grotesk", system-ui, sans-serif',  google: "Space+Grotesk:wght@400;600" },
  lora:    { name: "Lora (serif)",   stack: '"Lora", Georgia, serif',                  google: "Lora:wght@400;600" },
  mono:    { name: "JetBrains Mono", stack: '"JetBrains Mono", ui-monospace, Consolas, monospace', google: "JetBrains+Mono:wght@400;600" },
};

export const DEFAULTS = {
  name: "Your Name",
  tagline: "caelestia · homepage",
  avatar: null,        // gambar kecil dalam bentuk data URL, atau null
  search: "google",    // kunci SEARCH_ENGINES, atau "custom"
  searchCustom: "",    // templat alamat yang memuat {q}
  frame: 10,           // tebal bingkai (px)
  radius: 22,          // sudut jendela wallpaper (px)
  fillet: 20,          // lengkung panel (px)
  motion: "auto",      // "auto" | "on" | "off"
  lite: false,         // mode hemat
    scheme: "dark",        // "dark" | "light" | "auto"
  autoSource: "system",  // "system" | "sun" | "light"
  hueFollow: true,       // true: hue wallpaper digeser hueShift; false: pakai hue tetap
  hue: 270,
  hueShift: 0,
  sat: 80,
  font: "system",
  fontScale: 100,
};

const num = (n, lo, hi, d) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d);
const text = (v, max, d) => (typeof v === "string" ? v.slice(0, max) : d);

export function validTemplate(s) {
  if (typeof s !== "string" || s.length > 200 || !s.includes("{q}")) return false;
  try { return /^https?:$/.test(new URL(s.replace("{q}", "x")).protocol); }
  catch { return false; }
}

const validAvatar = (s) =>
  typeof s === "string" && s.length <= 60000 &&
  /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(s);

export function cleanPrefs(raw) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const custom = validTemplate(r.searchCustom) ? r.searchCustom : "";
  const name = text(r.name, 24, DEFAULTS.name).trim();
  let search = r.search === "custom" || Object.hasOwn(SEARCH_ENGINES, r.search) ? r.search : DEFAULTS.search;
  if (search === "custom" && !custom) search = DEFAULTS.search;
  return {
    name: !name || name === "Nama Kamu" ? DEFAULTS.name : name,
    tagline: text(r.tagline, 40, DEFAULTS.tagline),
    avatar: validAvatar(r.avatar) ? r.avatar : null,
    search,
    searchCustom: custom,
    frame: num(Number(r.frame), 0, 24, DEFAULTS.frame),
    radius: num(Number(r.radius), 0, 40, DEFAULTS.radius),
    fillet: num(Number(r.fillet), 0, 40, DEFAULTS.fillet),
    motion: ["auto", "on", "off"].includes(r.motion) ? r.motion : DEFAULTS.motion,
    lite: r.lite === true,
        scheme: ["dark", "light", "auto"].includes(r.scheme) ? r.scheme : DEFAULTS.scheme,
    autoSource: ["system", "sun", "light"].includes(r.autoSource) ? r.autoSource : DEFAULTS.autoSource,
    hueFollow: r.hueFollow !== false,
    hue: num(Number(r.hue), 0, 359, DEFAULTS.hue),
    hueShift: num(Number(r.hueShift), -180, 180, DEFAULTS.hueShift),
    sat: num(Number(r.sat), 0, 100, DEFAULTS.sat),
    font: Object.hasOwn(FONTS, r.font) ? r.font : DEFAULTS.font,
    fontScale: num(Number(r.fontScale), 85, 130, DEFAULTS.fontScale),
  };
}

function load() {
  try { return cleanPrefs(JSON.parse(localStorage.getItem(KEY))); }
  catch { return cleanPrefs(null); }
}
state.prefs = load();

let timer, frozen = false;
function save() {
  if (frozen) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (frozen) return;
    try { localStorage.setItem(KEY, JSON.stringify(state.prefs)); }
    catch {
      emit("toast", { title: "Settings", message: "Could not save (storage is full or disabled)", type: "error" });
    }
  }, 200);
}
export function freezeSaves() { frozen = true; clearTimeout(timer); }   // dipakai sebelum impor dan reset

export const setPrefs = (patch) => setState("prefs", cleanPrefs({ ...state.prefs, ...patch }));

export function searchUrl(q) {
  const p = state.prefs;
  const tpl = p.search === "custom" ? p.searchCustom : SEARCH_ENGINES[p.search].url;
  return tpl.replace("{q}", () => encodeURIComponent(q));
}

const root = document.documentElement;
const system = matchMedia("(prefers-reduced-motion: reduce)");

export const motionReduced = () => {
  const p = state.prefs;
  return p.lite || p.motion === "off" || (p.motion === "auto" && system.matches);
};

function apply() {
  const p = state.prefs;
  root.style.setProperty("--frame", p.frame + "px");
  root.style.setProperty("--window-r", p.radius + "px");
  root.style.setProperty("--fillet", p.fillet + "px");
  root.classList.toggle("lite", p.lite);
  root.classList.toggle("no-motion", motionReduced());
  emit("motion:changed");
}

on("state:prefs", () => { apply(); save(); });
system.addEventListener("change", apply);
apply();