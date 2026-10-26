import { state, setState, on, emit } from "../core/state.js";
import { DEFAULTS, SEARCH_ENGINES, FONTS, setPrefs, validTemplate } from "../core/prefs.js";
import { schemeInfo, lightStatus } from "../appearance/palette.js";
import { exportBackup, readBackup, applyBackup, resetAll } from "../core/backup.js";

// h("div", { class: "x" }, anak...); "value" harus ditulis paling akhir di atribut
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (["value", "checked", "hidden", "disabled"].includes(k)) e[k] = v;
    else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
  }
  e.append(...kids);
  return e;
}

const row = (label, control, hint) =>
  h("div", { class: "pr-row" },
    h("div", { class: "pr-label" }, label, ...(hint ? [h("small", {}, hint)] : [])),
    control);

function select(options, value, onChange, label) {
  const s = h("select", { "aria-label": label }, ...options.map(([v, t]) => h("option", { value: v }, t)));
  s.value = value;
  s.addEventListener("change", () => onChange(s.value));
  return s;
}

async function toAvatar(file) {
  if (!file.type.startsWith("image/")) throw new Error("File is not an image");
  if (file.size > 8 * 1024 * 1024) throw new Error("Image is too large (8 MB maximum)");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, fail) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => fail(new Error("Could not read image"));
      i.src = url;
    });
    const S = 128;
    const c = document.createElement("canvas");
    c.width = c.height = S;
    const g = c.getContext("2d");
    g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--surface").trim() || "#1e1e2e";
    g.fillRect(0, 0, S, S);   // latar untuk gambar transparan
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    g.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, S, S);
    return c.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

let prevEl = null;
function syncPrev() {
  if (!prevEl) return;
  const { avatar, name } = state.prefs;
  prevEl.style.backgroundImage = avatar ? `url("${avatar}")` : "none";
  prevEl.textContent = avatar ? "" : (Array.from(name)[0]?.toUpperCase() ?? "?");
}
on("state:prefs", syncPrev);

function paneProfile() {
  prevEl = h("div", { class: "pf-prev" });

  const pick = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/gif", hidden: true });
  const choose = h("button", { class: "pr-btn", type: "button" }, "Choose photo…");
  const clear = h("button", { class: "pr-btn", type: "button" }, "Remove photo");
  choose.addEventListener("click", () => pick.click());
  clear.addEventListener("click", () => setPrefs({ avatar: null }));
  pick.addEventListener("change", async () => {
    const f = pick.files[0];
    pick.value = "";
    if (!f) return;
    try { setPrefs({ avatar: await toAvatar(f) }); }
    catch (err) { emit("toast", { title: "Photo", message: err.message, type: "error" }); }
  });

  const name = h("input", { type: "text", maxlength: 24, "aria-label": "Name", value: state.prefs.name });
  const tag = h("input", { type: "text", maxlength: 40, "aria-label": "Tagline", value: state.prefs.tagline });
  name.addEventListener("input", () => setPrefs({ name: name.value }));
  tag.addEventListener("input", () => setPrefs({ tagline: tag.value }));

  syncPrev();
  return h("div", { class: "prefs-pane", "data-pane": "profil" },
    h("h2", { class: "pr-h" }, "Profile"),
    row("Photo", h("div", { class: "pr-avatar" }, prevEl, choose, clear, pick),
      "Cropped to a square and resized, then stored in this browser"),
    row("Name", name),
    row("Tagline", tag, "Second line on the profile card"));
}

function range(label, key, max, hint) {
  const out = h("output", {}, `${state.prefs[key]}px`);
  const input = h("input", { type: "range", min: 0, max, step: 1, "aria-label": label, value: state.prefs[key] });
  input.addEventListener("input", () => {
    out.textContent = `${input.value}px`;
    setPrefs({ [key]: Number(input.value) });
  });
  return row(label, h("div", { class: "pr-range" }, input, out), hint);
}

function paneLook() {
  let draftBarPosition = window.BarPosition.getSelected();
  const positions = [
    ["left", "Left"],
    ["right", "Right"],
    ["top", "Top"],
    ["bottom", "Bottom"],
  ];
  const applyBarPosition = h("button", { class: "pr-btn primary", type: "button", disabled: true }, "Apply");
  const picker = h("div", {
    class: "bar-picker",
    role: "group",
    "aria-label": "Bar position",
  }, ...positions.map(([position, label]) => {
    const button = h("button", {
      class: draftBarPosition === position ? "active" : "",
      type: "button",
      "data-bar-choice": position,
      "aria-pressed": draftBarPosition === position ? "true" : "false",
    }, label);
    button.addEventListener("click", () => {
      draftBarPosition = position;
      picker.querySelectorAll("[data-bar-choice]").forEach((choice) => {
        const active = choice.dataset.barChoice === draftBarPosition;
        choice.classList.toggle("active", active);
        choice.setAttribute("aria-pressed", String(active));
      });
      applyBarPosition.disabled = draftBarPosition === window.BarPosition.getSelected();
    });
    return button;
  }));
  applyBarPosition.addEventListener("click", () => {
    window.BarPosition.set(draftBarPosition);
    applyBarPosition.disabled = true;
  });

  const motion = select(
    [["auto", "Follow system"], ["on", "Always on"], ["off", "Off"]],
    state.prefs.motion, (v) => setPrefs({ motion: v }), "Motion effects");

  const lite = h("input", { type: "checkbox", class: "pr-switch", role: "switch", "aria-label": "Low-power mode", checked: state.prefs.lite });
  lite.addEventListener("change", () => setPrefs({ lite: lite.checked }));

  const reset = h("button", { class: "pr-btn", type: "button" }, "Restore default appearance");
  reset.addEventListener("click", () => {
    const { frame, radius, fillet, motion, lite } = DEFAULTS;
    setPrefs({ frame, radius, fillet, motion, lite });
    mountPanes();
  });

  return h("div", { class: "prefs-pane", "data-pane": "tampilan" },
    h("h2", { class: "pr-h" }, "Appearance"),
    row("Bar position", h("div", { class: "pr-stack" }, picker, applyBarPosition),
      "Choose an edge and select Apply. On phones, the bar stays at the bottom."),
    range("Frame thickness", "frame", 24, "0 = no frame"),
    range("Wallpaper window corners", "radius", 40),
    range("Panel curvature", "fillet", 40, "How panels meet the frame or bar"),
    row("Motion effects", motion, "Transitions, rain, snow, fireflies, and confetti"),
    row("Low-power mode", lite, "Disable blur and other demanding effects"),
    h("div", { class: "pr-foot" }, reset));
}

function paneSearch() {
  const err = h("div", { class: "pr-err", role: "alert" });
  const custom = h("input", {
    type: "text", maxlength: 200, placeholder: "https://…?q={q}",
    "aria-label": "Custom search URL", value: state.prefs.searchCustom,
  });
  const customRow = row("Custom URL", h("div", { class: "pr-stack" }, custom, err),
    "Put {q} where the search query should go");
  customRow.style.display = state.prefs.search === "custom" ? "" : "none";

  const engine = select(
    [...Object.entries(SEARCH_ENGINES).map(([k, e]) => [k, e.name]), ["custom", "Custom…"]],
    state.prefs.search,
    (v) => {
      customRow.style.display = v === "custom" ? "" : "none";
      err.textContent = "";
      if (v !== "custom") setPrefs({ search: v });
      else if (validTemplate(custom.value.trim())) setPrefs({ search: "custom", searchCustom: custom.value.trim() });
      else custom.focus();
    },
    "Search engine");

  custom.addEventListener("change", () => {
    const v = custom.value.trim();
    if (validTemplate(v)) { err.textContent = ""; setPrefs({ search: "custom", searchCustom: v }); }
    else err.textContent = "URL must start with http:// or https:// and include {q}";
  });

  return h("div", { class: "prefs-pane", "data-pane": "pencarian" },
    h("h2", { class: "pr-h" }, "Search"),
    row("Search engine", engine, "Used by the “Search the web” option in the launcher"),
    customRow);
}

function showImport(box, b) {
  const items = b.sections.map((s) => {
    const cb = h("input", { type: "checkbox", checked: true });
    const label = h("label", { class: "pr-check" }, cb,
      h("span", {}, h("b", {}, s.label), h("small", {}, s.summary)));
    return { id: s.id, cb, label };
  });
  const safety = h("input", { type: "checkbox", checked: true });
  const go = h("button", { class: "pr-btn primary", type: "button" }, "Apply and reload");
  const cancel = h("button", { class: "pr-btn", type: "button" }, "Cancel");

  cancel.addEventListener("click", () => box.replaceChildren());
  go.addEventListener("click", () => {
    const chosen = items.filter((i) => i.cb.checked).map((i) => i.id);
    if (!chosen.length) {
      emit("toast", { message: "Select at least one section", type: "warn", duration: 2500 });
      return;
    }
    go.disabled = cancel.disabled = true;
    if (safety.checked) {
      exportBackup("before-import");
      setTimeout(() => applyBackup(b, chosen), 700);   // beri waktu unduhan dimulai sebelum memuat ulang
    } else applyBackup(b, chosen);
  });

  box.replaceChildren(
    h("div", { class: "pr-sub" }, `Backup created ${b.when}. Only checked sections will be replaced.`),
    ...items.map((i) => i.label),
    h("label", { class: "pr-check" }, safety, h("span", {}, "Unduh cadangan kondisi sekarang dulu")),
    h("div", { class: "pr-actions" }, go, cancel),
  );
}

function paneData() {
  const result = h("div", { class: "pr-import" });
  const fileIn = h("input", { type: "file", accept: "application/json,.json", hidden: true });

  const exp = h("button", { class: "pr-btn", type: "button" }, "Download backup");
  exp.addEventListener("click", () => {
    exportBackup();
    emit("toast", { title: "Backup", message: "Backup file downloaded", duration: 2500 });
  });

  const imp = h("button", { class: "pr-btn", type: "button" }, "Choose file…");
  imp.addEventListener("click", () => fileIn.click());
  fileIn.addEventListener("change", async () => {
    const f = fileIn.files[0];
    fileIn.value = "";
    if (!f) return;
    try { showImport(result, await readBackup(f)); }
    catch (err) { result.replaceChildren(h("div", { class: "pr-err" }, err.message)); }
  });

  const reset = h("button", { class: "pr-btn danger", type: "button" }, "Reset everything");
  let timer;
  reset.addEventListener("click", () => {
    if (!reset.classList.contains("armed")) {   // klik pertama hanya menyiapkan
      reset.classList.add("armed");
      reset.textContent = "Click again to delete everything";
      timer = setTimeout(() => {
        reset.classList.remove("armed");
        reset.textContent = "Reset everything";
      }, 3000);
      return;
    }
    clearTimeout(timer);
    resetAll();
  });

  return h("div", { class: "prefs-pane", "data-pane": "data" },
    h("h2", { class: "pr-h" }, "Data"),
    row("Export", exp, "Shortcuts, notes, widgets, themes, and settings in one file. Notes are preserved as-is."),
    row("Import", h("div", {}, imp, fileIn), "Choose which sections to apply before anything is changed"),
    result,
    row("Reset", reset, "Deletes all data for this page from this browser"));
}

let infoEl = null;
const SCHEME_NAME = { dark: "dark", light: "light" };
const SENSOR_TEXT = {
  waiting: "Waiting for sensor reading…",
  active: "Sensor active.",
  unsupported: "This browser does not support the light sensor (Chrome and Edge require an experimental flag).",
  error: "Could not read the sensor.",
};

function syncInfo() {
  if (!infoEl) return;
  const { scheme, why, mode, override } = schemeInfo();
  const p = state.prefs;
  const extra = p.scheme === "auto" && p.autoSource === "light" ? " " + (SENSOR_TEXT[lightStatus()] ?? "") : "";
  const names = { scheme: "color mode", sat: "saturation", hueShift: "hue shift" };
  const note = override.length
    ? ` The “${mode}” mode is overriding ${override.map((k) => names[k]).join(", ")}; choose Normal mode to use your settings.`
    : "";
  infoEl.textContent = `Current: ${SCHEME_NAME[scheme]} (${why}).${extra}${note}`;
}
on("palette:changed", syncInfo);

function slider(label, key, min, max, unit, hint) {
  const out = h("output", {}, `${state.prefs[key]}${unit}`);
  const input = h("input", { type: "range", min, max, step: 1, "aria-label": label, value: state.prefs[key] });
  input.addEventListener("input", () => {
    out.textContent = `${input.value}${unit}`;
    setPrefs({ [key]: Number(input.value) });
  });
  return row(label, h("div", { class: "pr-range" }, input, out), hint);
}

function paneTheme() {
  const p = state.prefs;

  const mode = select([["dark", "Dark"], ["light", "Light"], ["auto", "Automatic"]], p.scheme,
    (v) => { setPrefs({ scheme: v }); syncAuto(); }, "Color mode");
  const source = select(
    [["system", "Follow operating system"], ["sun", "Sunrise and sunset"], ["light", "Light sensor (experimental)"]],
    p.autoSource, (v) => setPrefs({ autoSource: v }), "Automatic source");
  const sourceRow = row("Automatic source", source, "Sunrise and sunset use the same location as the weather");
  infoEl = h("div", { class: "pr-info" });
  const infoRow = h("div", { class: "pr-info-row" }, infoEl);
  const syncAuto = () => {
    const auto = state.prefs.scheme === "auto";
    sourceRow.style.display = auto ? "" : "none";
    infoRow.style.display = auto ? "" : "none";
    syncInfo();
  };

  const follow = h("input", { type: "checkbox", class: "pr-switch", role: "switch", "aria-label": "Follow wallpaper colors", checked: p.hueFollow });
  const hueLabel = h("span", {}, "");
  const hueOut = h("output", {}, "");
  const hueIn = h("input", { type: "range", step: 1, "aria-label": "Hue" });
  const syncHue = () => {
    const q = state.prefs;
    hueIn.min = q.hueFollow ? -180 : 0;
    hueIn.max = q.hueFollow ? 180 : 359;
    hueIn.value = q.hueFollow ? q.hueShift : q.hue;
    hueIn.classList.toggle("pr-hue", !q.hueFollow);   // jalur pelangi hanya masuk akal untuk hue mutlak
    hueLabel.textContent = q.hueFollow ? "Hue shift" : "Hue";
    hueOut.textContent = q.hueFollow ? `${q.hueShift > 0 ? "+" : ""}${q.hueShift}°` : `${q.hue}°`;
  };
  follow.addEventListener("change", () => { setPrefs({ hueFollow: follow.checked }); syncHue(); });
  hueIn.addEventListener("input", () => {
    const v = Number(hueIn.value);
    setPrefs(state.prefs.hueFollow ? { hueShift: v } : { hue: v });
    syncHue();
  });

    const font = select(Object.entries(FONTS).map(([k, f]) => [k, f.name]), p.font,
    (v) => setPrefs({ font: v }), "Font");

  const swatches = h("div", { class: "pr-swatches", "aria-hidden": "true" },
    ...["--primary", "--bg", "--surface", "--surface-2", "--on-surface"].map((v) =>
      h("span", { class: "pr-chip", title: v, style: `background: var(${v})` })));

  const reset = h("button", { class: "pr-btn", type: "button" }, "Restore default theme");
  reset.addEventListener("click", () => {
    const d = DEFAULTS;
    setPrefs({ scheme: d.scheme, autoSource: d.autoSource, hueFollow: d.hueFollow, hue: d.hue,
               hueShift: d.hueShift, sat: d.sat, font: d.font, fontScale: d.fontScale });
    mountPanes();
  });

  syncAuto();
  syncHue();
  return h("div", { class: "prefs-pane", "data-pane": "tema" },
    h("h2", { class: "pr-h" }, "Theme"),
    row("Color mode", mode, "Dark, light, or automatic"),
    sourceRow,
    infoRow,
    row("Follow wallpaper", follow, "Base color is sampled from the wallpaper; use the slider below to shift it"),
    row(hueLabel, h("div", { class: "pr-range" }, hueIn, hueOut)),
    slider("Saturation", "sat", 0, 100, "%", "0 = grayscale, 80 = default"),
    swatches,
    row("Font", font, "Downloaded from Google Fonts when selected (your IP address is sent to Google). “System default” does not require a download."),
    slider("Font size", "fontScale", 85, 130, "%"),
    h("div", { class: "pr-sample" }, "Sample text: team meeting tomorrow at 9:40 AM. The quick brown fox jumps over the lazy dog."),
    h("div", { class: "pr-foot" }, reset));
}

const TABS = [
  ["profil", "Profile", paneProfile],
  ["tampilan", "Appearance", paneLook],
  ["tema", "Theme", paneTheme],
  ["pencarian", "Search", paneSearch],
  ["data", "Data", paneData],
];
let current = "profil";

const gear = document.getElementById("btn-settings");
const nav = h("nav", { class: "prefs-nav" }, h("div", { class: "prefs-title" }, "Settings"));
const body = h("div", { class: "prefs-body" });
const closeBtn = h("button", { class: "prefs-close", type: "button", "aria-label": "Close settings" }, "✕");
const win = h("div", { class: "prefs-win", role: "dialog", "aria-modal": "true", "aria-label": "Settings" });
const root = h("div", { class: "prefs", inert: true }, win);
win.append(nav, body, closeBtn);
document.body.append(root);

const tabBtns = TABS.map(([id, label]) => {
  const b = h("button", { class: "prefs-tab", type: "button", "data-tab": id }, label);
  b.addEventListener("click", () => show(id));
  nav.append(b);
  return b;
});

function show(id) {
  current = id;
  tabBtns.forEach((b) => b.classList.toggle("active", b.dataset.tab === id));
  body.querySelectorAll(".prefs-pane").forEach((p) => p.classList.toggle("active", p.dataset.pane === id));
}
function mountPanes() {
  body.replaceChildren(...TABS.map(([, , build]) => build()));
  show(current);
}
mountPanes();

const OTHERS = ["panelOpen", "themePicker", "launcher", "terminal", "menu", "powerMenu", "social"];
let last = null;

on("state:prefsOpen", (open) => {
  root.classList.toggle("open", open);
  root.inert = !open;
  gear.classList.toggle("active", open);
  if (open) {
    OTHERS.forEach((k) => setState(k, false));   // tutup yang lain supaya tidak bertumpuk
    emit("overlay:open", "prefsOpen");
    last = document.activeElement;
    tabBtns.find((b) => b.dataset.tab === current)?.focus();
  } else if (last?.isConnected) last.focus();
});

closeBtn.addEventListener("click", () => setState("prefsOpen", false));
root.addEventListener("pointerdown", (e) => { if (e.target === root) setState("prefsOpen", false); });

root.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.stopPropagation();
    setState("prefsOpen", false);
    return;
  }
  if (e.key !== "Tab") return;
  const f = [...root.querySelectorAll("button, input, select")]
    .filter((el) => !el.disabled && el.type !== "file" && el.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], end = f.at(-1);
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); end.focus(); }
  else if (!e.shiftKey && document.activeElement === end) { e.preventDefault(); first.focus(); }
});
