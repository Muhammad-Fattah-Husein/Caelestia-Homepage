import { state, setState, on } from "../core/state.js";
import { THEMES, setTheme } from "../system/theme.js";
import { WORKSPACES } from "./workspaces.js";
import { powerOff, reset } from "../system/power.js";
import { MODES, applyMode } from "../ux/modes.js";
import { openLibrary } from "../core/features.js";
import { searchUrl } from "../core/prefs.js";
import { smartItems } from "../system/smart.js";
import { cancelTimers } from "../widgets/timer.js";
import { toggleGrid } from "../widgets/widgets.js";
import { fuzzyMatch, rankFuzzy } from "../system/fuzzy.js";
import { newEvent } from "../calendar/calendar.js";
import { toggleSound, toggleHaptics } from "../ux/feedback.js";
import { openPanel } from "./panel.js";
import { openFilter, toggleAutoTemp } from "../appearance/filter.js";
import { toggleHelp } from "../system/keys.js";
import { manager } from "../system/pluginhost.js";        // launcher.js
import { openWallPicker } from "../ux/wallpicker.js";
import { nextVisible, themeMatches } from "../system/huefilter.js";

const MAX = 8;
const HISTORY_KEY = "searches";
const HISTORY_MAX = 20;
const SHORT = 4;   // ketikan satu kata sependek ini: shortcut terbaik naik di atas "Cari di web"

const root = document.getElementById("launcher");
const input = document.getElementById("lc-input");
const list = document.getElementById("lc-list");
const themesEl = document.getElementById("lc-themes");
const audio = document.getElementById("audio");
let results = [],
  sel = 0,
  selTheme = 0,
  inPicker = false;

const PICKER = /^\s*>\s*(wallpapers?|theme)\s+$/i;
const isCmd = (raw) => raw.trimStart().startsWith(">");
const go = (url) => {
  location.href = url;
}; // tab yang sama, bukan tab baru
const click = (id) => document.getElementById(id).click();

// ---- riwayat pencarian (hanya tersimpan di browser ini) ----
function loadHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY));
    return Array.isArray(raw)
      ? raw.filter((x) => typeof x === "string").slice(0, HISTORY_MAX)
      : [];
  } catch {
    return [];
  }
}
function saveHistory(items) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
  } catch {}
}
function webSearch(q) {
  q = q.slice(0, 200);
  saveHistory(
    [
      q,
      ...loadHistory().filter((x) => x.toLowerCase() !== q.toLowerCase()),
    ].slice(0, HISTORY_MAX),
  );
  go(searchUrl(q));
}

// ---- mode perintah: diawali ">" ----
function commands() {
  const widgetsIndex = WORKSPACES.findIndex((w) => w.type === "widgets");
  const cmds = [
    {
  name: "wallpapers",
  hint: "Change wallpaper and theme",
  run: openWallPicker,
},
    {
      name: "terminal",
      hint: "Open terminal",
      run: () => setState("terminal", true),
    },
    ...["dashboard", "media", "performance", "workspaces"].map((tab) => ({
      name: `panel ${tab}`,
      hint: "Open panel",
      run() {
        openPanel({ pin: true, focus: true, tab })
      },
    })),
    {
      name: "widget",
      hint: "Open widget list",
      run() {
        openPanel({ pin: true, focus: true, tab })
      },
    },
    ...state.shortcuts.map((s) => ({
      name: `open ${s.name.toLowerCase()}`,
      hint: s.url,
      run: () => go(s.url),
    })),
    {
      name: "play",
      hint: "Play music",
      run: () => audio.play().catch(() => {}),
    },
    { name: "pause", hint: "Pause music", run: () => audio.pause() },
    { name: "next", hint: "Next track", run: () => click("btn-next") },
    { name: "prev", hint: "Previous track", run: () => click("btn-prev") },
    {
      name: "history clear",
      hint: "Clear search history",
      run: () => saveHistory([]),
    },
    { name: "off", hint: "Turn off the page", run: powerOff },
  { name: "reset", hint: "Restore defaults (run twice)", run: () => reset() },
    ...MODES.map(m => ({ name: `mode ${m.name.toLowerCase()}`, hint: `${m.name} mode`, run: () => applyMode(m.id) })),
{ name: "temperature auto", hint: "Toggle automatic color temperature", run: () => toggleAutoTemp() },
{ name: "music", hint: "Open music library", run: () => openLibrary() },
{
  name: "settings",
  hint: "Open settings",
  run: () => setState("prefsOpen", true),
},
{ name: "timer cancel", hint: "Cancel all timers", run: cancelTimers },
{ name: "grid", hint: "Toggle snap grid", run: () => toggleGrid() },
  { name: "calendar", hint: "Open calendar", run() { openPanel({ pin: true, focus: true, tab: "calendar" }); } },
  { name: "new event", hint: "Add an event or reminder", run: () => newEvent() },
  { name: "manage wallpapers", hint: "Add, rename, or delete wallpapers", run: () => openLibrary("wall") },
// di dalam array cmds:
{ name: "sound", hint: "Toggle sound effects", run: () => toggleSound() },
{ name: "haptics", hint: "Toggle vibration", run: () => toggleHaptics() },
{ name: "filter", hint: "Adjust screen brightness and temperature", run: () => openFilter({ pin: true, focus: true }) },
{ name: "shortcuts", hint: "Show keyboard shortcuts", run: () => toggleHelp() },
...manager.list().filter((r) => r.manifest).map((r) => ({
  name: `plugin reload ${r.id}`, hint: "Reload plugin code", run: () => manager.reload(r.id),
})),
  ];
  return cmds.map((c) => ({ ...c, label: ">" + c.name, fill: ">" + c.name + (c.keepOpen ? " " : "")}));
}

function commandItems(raw) {
  const q = raw.trimStart().slice(1).trim();
  const all = commands();
  if (!q) return all.slice(0, MAX);
  return all
    .map((c, i) => ({ c, i, m: fuzzyMatch(q, c.name, c.hint) }))
    .filter((x) => x.m)
    .sort((a, b) => b.m.score - a.m.score || a.i - b.i)   // skor sama: urutan daftar
    .slice(0, MAX)
    .map((x) => ({ ...x.c, hl: x.m.idx.map((n) => n + 1) }));   // +1 karena label diawali ">"
}

// teks dengan huruf yang cocok dibungkus <mark>
function marked(text, hl = []) {
  const span = document.createElement("span");
  const set = new Set(hl);
  let buf = "", hot = false;
  const flush = () => {
    if (!buf) return;
    if (hot) { const m = document.createElement("mark"); m.textContent = buf; span.append(m); }
    else span.append(buf);
    buf = "";
  };
  for (let i = 0; i < text.length; i++) {
    const h = set.has(i);
    if (h !== hot) { flush(); hot = h; }
    buf += text[i];
  }
  flush();
  return span;
}

// ---- mode pencarian: tanpa ">" ----
function webItems(raw) {
  const q = raw.trim();
  const ql = q.toLowerCase();
  const smart = smartItems(q);
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
  const toItem = (s, hl) => ({ label: s.name, hint: "Shortcut", fill: s.name, hl, run: () => go(s.url) });
  const past = loadHistory().map((h) => ({ label: h, hint: "Riwayat", fill: h, run: () => webSearch(h) }));
  if (!ql) return [...state.shortcuts.slice(0, 4).map((s) => toItem(s)), ...past.slice(0, 4)];

  const ranked = rankFuzzy(q, state.shortcuts, (s) => s.name, (s) => host(s.url));
  const lower = (r) => r.item.name.toLowerCase();
  let head = ranked.filter((r) => lower(r) === ql || lower(r).startsWith(ql)).slice(0, 3);
  if (!head.length && ranked.length && !/\s/.test(q) && q.length <= SHORT) head = [ranked[0]];
  const tail = ranked.filter((r) => !head.includes(r));
  const seen = past.filter((p) => p.label.toLowerCase().includes(ql) && p.label.toLowerCase() !== ql);
  const web = { label: `Search the web: ${q}`, hint: "Web", run: () => webSearch(q) };
  return [...smart, ...head.map((r) => toItem(r.item, r.hl)), web, ...tail.map((r) => toItem(r.item, r.hl)), ...seen].slice(0, MAX);
}

// ---- strip pilihan tema ----
function renderThemes() {
  themesEl.replaceChildren(
    ...THEMES.map((t, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "lc-theme";
      btn.style.setProperty("--i", i); // urutan untuk animasi muncul bergantian
      btn.tabIndex = -1; // fokus tetap di kotak input
      btn.setAttribute("role", "option");

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

      const name = document.createElement("span");
      name.textContent = t.name;
      btn.append(img, name);

      btn.addEventListener("pointerenter", () => {
        selTheme = i;
        markThemes("none");
      });
      btn.addEventListener("click", () => chooseTheme(i));
      return btn;
    }),
  );

    const add = document.createElement("button");
  add.type = "button";
  add.className = "lc-theme lc-add";
  add.tabIndex = -1;
  add.style.setProperty("--i", THEMES.length);
  const box = document.createElement("span");
  box.className = "lc-add-box";
  box.textContent = "＋";
  const addName = document.createElement("span");
  addName.textContent = "Manage";
  add.append(box, addName);
  add.addEventListener("click", () => {
    setState("launcher", false);
    openLibrary("wall");
  });
  themesEl.append(add);
}

function centerTheme(smooth) {
  const el = themesEl.children[selTheme];
  if (!el) return;
  const left = el.offsetLeft + el.offsetWidth / 2 - themesEl.clientWidth / 2;
  themesEl.scrollTo({ left, behavior: smooth ? "smooth" : "auto" });
}

function markThemes(scroll = "smooth") {
  // "smooth" | "instant" | "none"
  [...themesEl.children].forEach((el, i) => {
    el.classList.toggle("sel", i === selTheme);
    el.setAttribute("aria-selected", String(i === selTheme));
  });
  if (scroll !== "none") centerTheme(scroll === "smooth");
}

function chooseTheme(i) {
  if (!Number.isInteger(i) || i < 0 || i >= THEMES.length || !themeMatches(THEMES[i])) return;
  setState("launcher", false);
  setTheme(i);
}

themesEl.addEventListener(
  "wheel",
  (e) => {
    // roda mouse menggeser strip ke samping
    if (!e.deltaY) return;
    e.preventDefault();
    themesEl.scrollLeft += e.deltaY;
  },
  { passive: false },
);

new ResizeObserver(() => {
  if (inPicker) centerTheme(false); // saat launcher melebar, pilihan tetap di tengah
}).observe(themesEl);

on("themes:changed", () => {
  themesEl.replaceChildren(); // daftar berubah: gambar ulang saat strip dibuka lagi
  if (inPicker) {
    selTheme = Math.min(selTheme, THEMES.length - 1);
    renderThemes();
    markThemes("none");
  }
});

on("huefilter:changed", () => {
  if (!inPicker) return;
  if (!themeMatches(THEMES[selTheme])) selTheme = nextVisible(THEMES, selTheme, 1);
  markThemes("instant");
});

function highlight() {
  [...list.children].forEach((li, i) => li.classList.toggle("sel", i === sel));
  list.children[sel]?.scrollIntoView({ block: "nearest" });
}

function refresh() {
  const raw = input.value;
  const picker = PICKER.test(raw);
  if (picker) {   // mengetik ">wallpapers " (pakai spasi) juga langsung membuka carousel
  setState("launcher", false);
  openWallPicker();
  return;
}
  root.classList.toggle("themes", picker);
  root.dataset.mode = picker ? "themes" : isCmd(raw) ? "cmd" : "web";

  if (picker) {
    if (!inPicker) {
      inPicker = true;
      selTheme = state.theme; // mulai dari tema yang sedang aktif
      if (!themeMatches(THEMES[selTheme])) selTheme = nextVisible(THEMES, selTheme, 1);
      if (!themesEl.children.length) renderThemes();
      markThemes("instant");
    } else markThemes("none");
    return;
  }
  inPicker = false;

  results = isCmd(raw) ? commandItems(raw) : webItems(raw);
  list.replaceChildren(
    ...results.map((r, i) => {
      const li = document.createElement("li");
      li.className = "lc-item";
      li.setAttribute("role", "option");
      const label = marked(r.label, r.hl);
      const hint = document.createElement("span");
      hint.className = "hint";
      hint.textContent = r.hint;
      li.append(label, hint);
      li.addEventListener("pointerenter", () => {
        sel = i;
        highlight();
      });
      li.addEventListener("click", () => choose(i));
      return li;
    }),
  );
  highlight();
}

function choose(i) {
  const r = results[i];
  if (!r) return;
  if (r.keepOpen) {
    r.run();
    return;
  } // mis. wallpapers: launcher tetap terbuka
  setState("launcher", false); // tutup dulu, baru jalankan
  r.run();
}

input.addEventListener("input", () => {
  sel = 0;
  refresh();
});
input.addEventListener("keydown", (e) => {
  if (inPicker) {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      selTheme = nextVisible(THEMES, selTheme, e.key === "ArrowRight" ? 1 : -1);
      markThemes();
    } else if (e.key === "Enter") {
      e.preventDefault();
      chooseTheme(selTheme);
    }
    return; // Backspace dan huruf lain mengubah teks, jadi keluar dari mode tema
  }

  if (e.key === "Enter") return choose(sel);
  if (e.key === "Tab" && results[sel]?.fill != null) {
    // Tab = lengkapi otomatis
    e.preventDefault();
    input.value = results[sel].fill;
    sel = 0;
    refresh();
    return;
  }
  if (!results.length) return;
  if (e.key === "ArrowDown") sel = (sel + 1) % results.length;
  else if (e.key === "ArrowUp")
    sel = (sel - 1 + results.length) % results.length;
  else return;
  e.preventDefault();
  highlight();
});

on("state:launcher", (open) => {
  root.classList.toggle("open", open);
  root.inert = !open;
  if (open) {
    input.value = "";
    sel = 0;
    refresh();
    input.focus();
  } else {
  input.blur();
  setTimeout(() => { // kembali ke mode biasa setelah launcher selesai memudar
    if (!state.launcher) { input.value = ""; refresh(); }
  }, 350);
}
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") setState("launcher", false);
});

document.addEventListener("pointerdown", (e) => {
  if (
    state.launcher &&
    !root.contains(e.target) &&
    !e.target.closest("#btn-launcher, #fab, #fab-menu")
  )
    setState("launcher", false);
});
