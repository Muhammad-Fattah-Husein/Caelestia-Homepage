import { state, setState, on, emit } from "../core/state.js";
import { THEMES, setTheme } from "../system/theme.js";
import { addWidget } from "../widgets/widgets.js";
import { autoTemp } from "../appearance/filter.js";
import { createIcon, normalizeIcon } from "../core/icons.js";

const KEY = "mode";               // id mode yang sedang aktif
const LIST_KEY = "modes:list";    // daftar mode buatan user
const OWNED_KEY = "mode:owned";   // jenis widget yang dinyalakan otomatis oleh mode aktif

// Kalau daftar jenis widget tidak terdeteksi otomatis dari widgetdefs.js, isi di sini,
// contoh: [["clock", "Clock"], ["rain", "Rain"]]. Kalau diisi, daftar ini dipakai persis.
const WIDGET_TYPES_OVERRIDE = [];
const KNOWN_WIDGETS = [["rain", "Rain"], ["snow", "Snow"], ["fireflies", "Fireflies"]];

const audio = document.getElementById("audio");
const row = document.getElementById("mode-row");

/*
  Satu mode:
  { id, name, icon,
    filter:  null | { auto, temp, light }      null = filter layar tidak diubah
    look:    null | { scheme?, hueShift?, sat? } null = tanpa penimpa tampilan
    theme:   null | nama tema di theme.js
    music:   null | "play" | "pause"
    widgets: ["rain", ...]                      widget yang ditambahkan otomatis saat mode diklik
    cleanup: true = widget yang ditambahkan mode ini dibuang saat pindah mode }
*/

// ---- mode awal (hanya dibuat sekali; bebas diedit atau dihapus) ----
const STARTERS = [
  { id: "normal", name: "Normal", icon: "08_sun.png", filter: { auto: true, temp: 0, light: 0 }, look: null, theme: null, music: null, widgets: [], cleanup: true },
  { id: "fokus", name: "Focus", icon: "32_target.png", filter: { auto: true, temp: 0, light: -20 }, look: { sat: 45 }, theme: null, music: "pause", widgets: [], cleanup: true },
  { id: "hujan", name: "Rain", icon: "23_rain.png", filter: { auto: false, temp: 15, light: -15 }, look: { scheme: "dark", hueShift: -40, sat: 55 }, theme: null, music: null, widgets: ["rain"], cleanup: true },
  { id: "malam", name: "Night", icon: "21_crescent_moon.png", filter: { auto: false, temp: 50, light: -30 }, look: { scheme: "dark", sat: 65 }, theme: "Neon", music: null, widgets: ["fireflies"], cleanup: true },
  { id: "salju", name: "Snow", icon: "18_snowflake.png", filter: { auto: false, temp: -25, light: 0 }, look: { scheme: "light", sat: 55 }, theme: null, music: null, widgets: ["snow"], cleanup: true },
];

// ---- penyimpanan ----
const num = (v, lo, hi, d) => (Number.isFinite(+v) && v !== null && v !== "" ? Math.min(hi, Math.max(lo, Math.round(+v))) : d);
const rid = () => "m:" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function clean(m) {
  if (!m || typeof m !== "object" || typeof m.name !== "string" || !m.name.trim()) return null;
  const f = m.filter && typeof m.filter === "object"
    ? { auto: !!m.filter.auto, temp: num(m.filter.temp, -100, 100, 0), light: num(m.filter.light, -100, 100, 0) }
    : null;
  let look = null;
  if (m.look && typeof m.look === "object") {
    look = {};
    if (m.look.scheme === "dark" || m.look.scheme === "light") look.scheme = m.look.scheme;
    if (m.look.hueShift != null) look.hueShift = num(m.look.hueShift, -180, 180, 0);
    if (m.look.sat != null) look.sat = num(m.look.sat, 0, 100, 100);
    if (!Object.keys(look).length) look = null;
  }
  return {
    id: typeof m.id === "string" && m.id ? m.id : rid(),
    name: m.name.trim().slice(0, 24),
    icon: normalizeIcon(m.icon, "17_sparkles.png"),
    filter: f,
    look,
    theme: typeof m.theme === "string" && m.theme ? m.theme : null,
    music: m.music === "play" || m.music === "pause" ? m.music : null,
    widgets: Array.isArray(m.widgets) ? [...new Set(m.widgets.filter((x) => typeof x === "string" && x))] : [],
    cleanup: m.cleanup !== false,
  };
}

function loadModes() {
  let raw = null;
  try { raw = localStorage.getItem(LIST_KEY); } catch {}
  let list;
  try { list = raw === null ? null : JSON.parse(raw); } catch { list = null; }
  if (!Array.isArray(list)) list = STARTERS; // pertama kali (atau data rusak): mulai dari mode awal
  const seen = new Set();
  return list.map(clean).filter((m) => m && !seen.has(m.id) && seen.add(m.id));
}
function saveModes() {
  try { localStorage.setItem(LIST_KEY, JSON.stringify(MODES)); } catch {}
  emit("modes:changed");
}

// Array "hidup": modul lain (launcher, terminal) yang meng-import MODES selalu melihat isi terbaru.
export const MODES = loadModes();

export const getMode = (id) => {
  const k = String(id).toLowerCase();
  return MODES.find((x) => x.id === id) ?? MODES.find((x) => x.name.toLowerCase() === k) ?? null;
};

// ---- jenis widget yang bisa dipilih ----
let defs = null;
const defsReady = import("../widgets/widgetdefs.js").then((m) => (defs = m)).catch(() => {});
const pretty = (t) => t.charAt(0).toUpperCase() + t.slice(1).replace(/[-_]/g, " ");

function widgetChoices() {
  if (WIDGET_TYPES_OVERRIDE.length) return new Map(WIDGET_TYPES_OVERRIDE);
  const found = new Map();
  const take = (type, label) => {
    if (typeof type === "string" && type && !found.has(type)) found.set(type, typeof label === "string" && label ? label : pretty(type));
  };
  const lab = (d) => d.name ?? d.label ?? d.title;
  if (defs) {
    for (const v of Object.values(defs)) {
      if (Array.isArray(v)) v.forEach((d) => d && typeof d === "object" && take(d.type ?? d.id, lab(d)));
      else if (v && typeof v === "object")
        for (const [k, d] of Object.entries(v)) if (d && typeof d === "object" && !Array.isArray(d)) take(d.type ?? k, lab(d));
    }
  }
  for (const [t, l] of KNOWN_WIDGETS) take(t, l);
  for (const w of state.widgets ?? []) take(w.type);
  for (const m of MODES) for (const t of m.widgets) take(t);
  return found;
}
const labelOf = (t) => widgetChoices().get(t) ?? pretty(t);

// ---- ringkasan "apa yang berubah" ----
const sgn = (v) => (v > 0 ? "+" : "") + v;
export function describeMode(m) {
  const p = [];
  if (m.filter) p.push(m.filter.auto ? `filter: auto temp, light ${sgn(m.filter.light)}` : `filter: temp ${sgn(m.filter.temp)}, light ${sgn(m.filter.light)}`);
  if (m.look) {
    const l = [m.look.scheme, m.look.hueShift != null && `hue ${sgn(m.look.hueShift)}`, m.look.sat != null && `sat ${m.look.sat}`].filter(Boolean);
    p.push(`look: ${l.join(", ") || "label only"}`);
  }
  if (m.theme) p.push(`theme: ${m.theme}`);
  if (m.music) p.push(`music: ${m.music}`);
  if (m.widgets.length) p.push(`adds ${m.widgets.map(labelOf).join(", ")}`);
  return p.join(" · ") || "No changes";
}

// ---- menjalankan mode ----
const readOwned = () => {
  try {
    const v = JSON.parse(localStorage.getItem(OWNED_KEY));
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
};
const writeOwned = (a) => {
  try { localStorage.setItem(OWNED_KEY, JSON.stringify(a)); } catch {}
};

// buang widget yang dinyalakan mode sebelumnya, kecuali yang juga diminta mode baru
function dropOwned(keepTypes = []) {
  const owned = readOwned();
  const drop = new Set(owned.filter((t) => !keepTypes.includes(t)));
  if (drop.size && state.widgets) {
    const keep = state.widgets.filter((w) => !drop.has(w.type));
    if (keep.length !== state.widgets.length) setState("widgets", keep);
  }
  const left = owned.filter((t) => keepTypes.includes(t));
  writeOwned(left);
  return left;
}

export function applyMode(id) {
  const m = getMode(id);
  if (!m) return false;

  // 1) widget: buang milik mode sebelumnya, tambahkan yang diminta mode ini
  const owned = dropOwned(m.widgets);
  m.widgets.forEach((type, i) => {
    if (state.widgets?.some((w) => w.type === type)) return; // sudah ada (mungkin milik user): jangan digandakan atau dibuang nanti
    try {
      addWidget(type, 0.93, 0.14 + i * 0.1, { quiet: true });
      if (m.cleanup) owned.push(type);
    } catch (err) {
      console.warn("[modes] could not add widget:", type, err);
    }
  });
  writeOwned([...new Set(owned)]);

  // 2) filter layar (null = biarkan seperti sekarang)
  if (m.filter) {
    const f = { ...state.filter, ...m.filter };
    if (f.auto) f.temp = autoTemp();
    setState("filter", f);
  }

  // 3) tema dan musik
  if (m.theme) {
    const i = THEMES.findIndex((t) => t.name === m.theme);
    if (i >= 0) setTheme(i);
  }
  if (m.music === "pause") audio?.pause();
  else if (m.music === "play") audio?.play().catch(() => {});

  setState("mode", m.id);
  emit("toast", { title: "Mode", message: m.name, duration: 2000 });
  // 4) penimpa tampilan (null = tanpa penimpa)
  setState("modeLook", m.look ? { ...m.look, label: m.name } : null);
  return true;
}

// ---- tambah, ubah, hapus ----
export function saveMode(data) {
  const m = clean({ ...data, id: data.id || rid() });
  if (!m) return null;
  const i = MODES.findIndex((x) => x.id === m.id);
  if (i >= 0) MODES[i] = m;
  else MODES.push(m);
  saveModes();
  render();
  if (state.mode === m.id) applyMode(m.id); // mode yang sedang aktif langsung memakai perubahannya
  return m;
}

export function deleteMode(id) {
  const i = MODES.findIndex((x) => x.id === id);
  if (i < 0) return false;
  const wasActive = state.mode === id;
  MODES.splice(i, 1);
  saveModes();
  if (wasActive) {
    dropOwned([]); // widget yang dinyalakan mode ini ikut dibuang
    setState("modeLook", null);
    setState("mode", null);
  }
  render();
  return true;
}

// ---- editor ----
const CSS = `
.mode-ed{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:16px;background:rgba(0,0,0,.55)}
.mode-ed-card{box-sizing:border-box;width:min(460px,100%);max-height:100%;overflow:auto;display:flex;flex-direction:column;gap:14px;padding:18px;border-radius:14px;background:#1c1e26;color:#e8e9ef;font:13px/1.4 system-ui,sans-serif;box-shadow:0 20px 60px rgba(0,0,0,.5);color-scheme:dark}
.mode-ed-card h3{margin:0;font-size:16px}
.mode-ed-sec{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border:1px solid rgba(255,255,255,.12);border-radius:10px}
.mode-ed-sec>.mode-ed-title{font-weight:700;font-size:12px;letter-spacing:.04em;text-transform:uppercase;opacity:.7}
.mode-ed-field{display:flex;flex-direction:column;gap:4px}
.mode-ed-lab{display:flex;justify-content:space-between;gap:8px;font-size:12px;opacity:.85}
.mode-ed-hint{opacity:.6;font-size:11px}
.mode-ed-row{display:flex;gap:10px}
.mode-ed-row>*{flex:1;min-width:0}
.mode-ed-row>.mode-ed-icon{flex:0 0 84px}
.mode-ed input[type=text],.mode-ed select{box-sizing:border-box;width:100%;padding:7px 9px;border-radius:8px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:inherit;font:inherit}
.mode-ed input[type=range]{width:100%;accent-color:var(--accent,#8ab4ff)}
.mode-ed input[type=checkbox]{accent-color:var(--accent,#8ab4ff)}
.mode-ed-check{display:flex;align-items:center;gap:8px;cursor:pointer}
.mode-ed-inner{display:flex;flex-direction:column;gap:8px;padding-left:4px}
.mode-ed-inner[hidden]{display:none}
.mode-ed-widgets{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:6px 10px}
.mode-ed-icons{display:flex;flex-wrap:wrap;gap:5px}
.mode-ed-icons button{display:grid;place-items:center;width:32px;height:32px;padding:5px;border-radius:6px;border:1px solid transparent;background:rgba(255,255,255,.06);cursor:pointer}
.mode-ed-icons button.selected{border-color:var(--accent,#8ab4ff);background:rgba(255,255,255,.16)}
.mode-ed-icons img{width:20px;height:20px;object-fit:contain}
.mode-ed-sum{padding:8px 10px;border-radius:8px;background:rgba(255,255,255,.06);font-size:12px}
.mode-ed-err{min-height:1.2em;color:#ff8a8a;font-size:12px}
.mode-ed-foot{display:flex;flex-wrap:wrap;gap:8px;justify-content:space-between}
.mode-ed-foot>div{display:flex;flex-wrap:wrap;gap:8px}
.mode-ed-btn{padding:7px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.06);color:inherit;font:inherit;cursor:pointer}
.mode-ed-btn.primary{background:var(--accent,#8ab4ff);border-color:transparent;color:#111;font-weight:600}
.mode-ed-btn.danger{color:#ff8a8a}
`;
const styleEl = document.createElement("style");
styleEl.textContent = CSS;
document.head.append(styleEl);

const h = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
function check(label, on) {
  const w = h("label", "mode-ed-check");
  const i = h("input");
  i.type = "checkbox";
  i.checked = !!on;
  w.append(i, h("span", "", label));
  return { w, i };
}
function slider(label, min, max, val, fmt = String) {
  const w = h("label", "mode-ed-field");
  const top = h("span", "mode-ed-lab", label);
  const out = h("output");
  const i = h("input");
  i.type = "range";
  i.min = min;
  i.max = max;
  i.step = 1;
  i.value = val;
  const upd = () => (out.textContent = fmt(+i.value));
  i.addEventListener("input", upd);
  upd();
  top.append(out);
  w.append(top, i);
  return { w, i };
}
function select(opts, val) {
  const s = h("select");
  for (const [v, t] of opts) {
    const o = h("option", "", t);
    o.value = v;
    s.append(o);
  }
  if (val && ![...s.options].some((o) => o.value === val)) {
    const o = h("option", "", `${val} (not found)`);
    o.value = val;
    s.append(o);
  }
  s.value = val ?? "";
  return s;
}
function section(title, ...kids) {
  const s = h("div", "mode-ed-sec");
  s.append(h("div", "mode-ed-title", title), ...kids);
  return s;
}

let ed = null;
function closeEditor() {
  if (!ed) return;
  window.removeEventListener("keydown", ed.onKey, true);
  ed.overlay.remove();
  ed.opener?.focus?.({ preventScroll: true });
  ed = null;
}

export async function openModeEditor(id, preset) {
  await defsReady;
  if (ed) return;
  const src = preset ?? MODES.find((m) => m.id === id) ?? null;
  const d = src ? JSON.parse(JSON.stringify(src)) : { name: "", icon: "17_sparkles.png", filter: null, look: null, theme: null, music: null, widgets: [], cleanup: true };
  const isNew = !d.id;

  // -- bentuk dasar
  const nameI = h("input");
  nameI.type = "text";
  nameI.maxLength = 24;
  nameI.value = d.name;
  nameI.placeholder = "e.g. Study, Reading, Chill";
  const iconI = h("input");
  iconI.type = "hidden";
  iconI.value = normalizeIcon(d.icon, "17_sparkles.png");
  iconI.setAttribute("aria-label", "Icon");
  const nameF = h("label", "mode-ed-field");
  nameF.append(h("span", "mode-ed-lab", "Name"), nameI);
  const iconF = h("label", "mode-ed-field mode-ed-icon");
  const iconChoices = h("div", "mode-ed-icons");
  iconF.append(h("span", "mode-ed-lab", "Icon"), iconI);
  for (const file of [
    "08_sun.png", "32_target.png", "23_rain.png", "21_crescent_moon.png",
    "18_snowflake.png", "17_sparkles.png", "36_books.png", "42_fire.png",
    "27_sprout.png", "30_headphones.png", "31_game_controller.png", "10_coffee.png",
  ]) {
    const b = h("button");
    b.type = "button";
    b.title = file.replace(/^\d+_/, "").replace(".png", "").replaceAll("_", " ");
    b.setAttribute("aria-label", b.title);
    b.setAttribute("aria-pressed", String(iconI.value === file));
    b.append(createIcon(file));
    b.classList.toggle("selected", iconI.value === file);
    b.addEventListener("click", () => {
      iconI.value = file;
      iconChoices.querySelectorAll("button").forEach((button) => {
        const selected = button === b;
        button.classList.toggle("selected", selected);
        button.setAttribute("aria-pressed", String(selected));
      });
      upd();
    });
    iconChoices.append(b);
  }

  // -- filter layar
  const fOn = check("Change the screen filter", !!d.filter);
  const fAuto = check("Color temperature follows the time of day", d.filter?.auto ?? true);
  const tempS = slider("Color temperature (cool ← → warm)", -100, 100, d.filter?.temp ?? 0, sgn);
  const lightS = slider("Brightness", -100, 100, d.filter?.light ?? 0, sgn);
  const fInner = h("div", "mode-ed-inner");
  fInner.append(fAuto.w, tempS.w, lightS.w);
  const syncFilter = () => {
    fInner.hidden = !fOn.i.checked;
    tempS.i.disabled = fAuto.i.checked;
    tempS.w.style.opacity = fAuto.i.checked ? ".45" : "";
  };

  // -- tampilan
  const lOn = check("Change the look (colors)", !!d.look);
  const schemeS = select([["", "Keep current light/dark"], ["dark", "Dark"], ["light", "Light"]], d.look?.scheme ?? "");
  const hueS = slider("Hue shift", -180, 180, d.look?.hueShift ?? 0, sgn);
  const satS = slider("Color saturation", 0, 100, d.look?.sat ?? 60);
  const lInner = h("div", "mode-ed-inner");
  lInner.append(schemeS, hueS.w, satS.w);
  const syncLook = () => (lInner.hidden = !lOn.i.checked);

  // -- tema dan musik
  const themeS = select([["", "Don't change"], ...THEMES.map((t) => [t.name, t.name])], d.theme ?? "");
  const musicS = select([["", "Don't change"], ["play", "Start playing"], ["pause", "Pause"]], d.music ?? "");
  const themeF = h("label", "mode-ed-field");
  themeF.append(h("span", "mode-ed-lab", "Theme"), themeS);
  const musicF = h("label", "mode-ed-field");
  musicF.append(h("span", "mode-ed-lab", "Music"), musicS);
  const tmRow = h("div", "mode-ed-row");
  tmRow.append(themeF, musicF);

  // -- widget otomatis
  const choices = widgetChoices();
  for (const t of d.widgets) if (!choices.has(t)) choices.set(t, pretty(t));
  const boxes = new Map();
  const wGrid = h("div", "mode-ed-widgets");
  for (const [t, l] of choices) {
    const c = check(l, d.widgets.includes(t));
    boxes.set(t, c.i);
    wGrid.append(c.w);
  }
  const cleanC = check("Remove these widgets when I switch to another mode", d.cleanup !== false);
  const wHint = h("small", "mode-ed-hint", "Only widgets this mode added are removed. Ones you placed yourself stay.");

  const sum = h("div", "mode-ed-sum");
  const err = h("div", "mode-ed-err");
  err.setAttribute("role", "alert");

  const collect = () => ({
    id: d.id,
    name: nameI.value.trim().slice(0, 24),
    icon: normalizeIcon(iconI.value, "17_sparkles.png"),
    filter: fOn.i.checked ? { auto: fAuto.i.checked, temp: +tempS.i.value, light: +lightS.i.value } : null,
    look: lOn.i.checked ? { ...(schemeS.value ? { scheme: schemeS.value } : {}), hueShift: +hueS.i.value, sat: +satS.i.value } : null,
    theme: themeS.value || null,
    music: musicS.value || null,
    widgets: [...boxes].filter(([, c]) => c.checked).map(([t]) => t),
    cleanup: cleanC.i.checked,
  });
  function upd() {
    syncFilter();
    syncLook();
    const m = clean({ ...collect(), name: nameI.value.trim() || "x" });
    sum.textContent = "When clicked: " + (m ? describeMode(m) : "—");
  }

  const commit = (apply) => {
    const m = collect();
    if (!m.name) {
      err.textContent = "Give the mode a name.";
      return nameI.focus();
    }
    if (MODES.some((x) => x.id !== m.id && x.name.toLowerCase() === m.name.toLowerCase())) {
      err.textContent = "Another mode already has this name.";
      return nameI.focus();
    }
    const saved = saveMode(m);
    closeEditor();
    if (saved && apply && state.mode !== saved.id) applyMode(saved.id);
    else if (saved) emit("toast", { title: "Mode", message: `Saved “${saved.name}”`, duration: 1800 });
  };

  // -- tombol
  const btn = (label, cls, run) => {
    const b = h("button", "mode-ed-btn " + cls, label);
    b.type = "button";
    b.addEventListener("click", run);
    return b;
  };
  const left = h("div");
  if (!isNew) {
    let armed = 0;
    const del = btn("Delete", "danger", () => {
      if (!armed) {
        armed = setTimeout(() => {
          armed = 0;
          del.textContent = "Delete";
        }, 3000);
        del.textContent = "Click again to delete";
        return;
      }
      clearTimeout(armed);
      const mid = d.id;
      closeEditor();
      deleteMode(mid);
    });
    left.append(del, btn("Duplicate", "", () => {
      const c = collect();
      delete c.id;
      c.name = (c.name + " copy").slice(0, 24);
      closeEditor();
      openModeEditor(null, c);
    }));
  }
  const right = h("div");
  right.append(btn("Cancel", "", closeEditor), btn("Save", "", () => commit(false)), btn(isNew ? "Save & use" : "Save & apply", "primary", () => commit(true)));
  const foot = h("div", "mode-ed-foot");
  foot.append(left, right);

  // -- rakit
  const card = h("div", "mode-ed-card");
  const top = h("div", "mode-ed-row");
  top.append(nameF, iconF);
  card.append(
    h("h3", "", isNew ? "New mode" : "Edit mode"),
    top,
    iconChoices,
    section("Screen filter", fOn.w, fInner),
    section("Look", lOn.w, lInner),
    section("Theme and music", tmRow),
    section("Widgets added automatically", wGrid, cleanC.w, wHint),
    sum,
    err,
    foot,
  );
  const overlay = h("div", "mode-ed");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", isNew ? "New mode" : "Edit mode");
  overlay.append(card);
  // tombol biasa di dalam editor tidak boleh memicu pintasan keyboard global
  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target === nameI) {
      e.preventDefault();
      commit(false);
    }
    e.stopPropagation();
  });
  card.addEventListener("input", upd);
  card.addEventListener("change", upd);
  // klik di luar kartu = Cancel. Tekan dan lepasnya harus sama-sama di latar, supaya menggeser
  // slider atau menyeleksi teks lalu melepas di luar kartu tidak menutup editor tanpa sengaja.
  let downOnBackdrop = false;
  overlay.addEventListener("pointerdown", (e) => (downOnBackdrop = e.target === overlay));
  overlay.addEventListener("click", (e) => {
    if (downOnBackdrop && e.target === overlay) closeEditor();
    downOnBackdrop = false;
  });

  const onKey = (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopImmediatePropagation();
    closeEditor();
  };
  window.addEventListener("keydown", onKey, true);
  ed = { overlay, onKey, opener: document.activeElement };
  document.body.append(overlay);
  upd();
  nameI.focus();
  if (isNew) nameI.select();
}

// ---- tombol di tab Workspaces › Hiburan ----
let editing = false;
function render() {
  if (!row) return;
  const chips = MODES.map((m) => {
    const b = h("button", "mode-chip" + (m.id === state.mode ? " active" : ""));
    b.type = "button";
    b.setAttribute("aria-pressed", String(m.id === state.mode));
    b.append(createIcon(m.icon), document.createTextNode(` ${m.name}${editing ? " ✎" : ""}`));
    b.title = editing ? "Edit this mode" : describeMode(m) + "  (right-click to edit)";
    b.addEventListener("click", () => (editing ? openModeEditor(m.id) : applyMode(m.id)));
    b.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openModeEditor(m.id);
    });
    return b;
  });
  const add = h("button", "mode-chip", "＋ New");
  add.type = "button";
  add.title = "Create a new mode";
  add.addEventListener("click", () => openModeEditor());
  const extra = [add];
  if (MODES.length) {
    const tog = h("button", "mode-chip" + (editing ? " active" : ""), editing ? "✓ Done" : "✎ Edit");
    tog.type = "button";
    tog.setAttribute("aria-pressed", String(editing));
    tog.title = "Click a mode to edit it instead of applying it";
    tog.addEventListener("click", () => {
      editing = !editing;
      render();
    });
    extra.push(tog);
  }
  row.replaceChildren(...chips, ...extra);
}

// ---- pulihkan mode aktif saat halaman dibuka ----
try {
  const saved = localStorage.getItem(KEY);
  if (MODES.some((m) => m.id === saved)) state.mode = saved; // hanya penanda; efeknya sudah tersimpan sendiri
  else if (saved) localStorage.removeItem(KEY); // mode-nya sudah dihapus
} catch {}

const current = MODES.find((m) => m.id === state.mode);
if (current?.look) setState("modeLook", { ...current.look, label: current.name });

on("state:mode", (id) => {
  try { id ? localStorage.setItem(KEY, id) : localStorage.removeItem(KEY); } catch {}
  render();
});
render();