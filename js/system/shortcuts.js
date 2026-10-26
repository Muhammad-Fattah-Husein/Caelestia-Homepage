import { state, setState, on, emit, uid } from "../core/state.js";

const KEY = "shortcuts";
const MAX = 30;
const DEFAULTS = [
  { id: "d1", name: "GitHub", url: "https://github.com/" },
  { id: "d2", name: "Gmail",  url: "https://mail.google.com/" },
  { id: "d3", name: "Notion", url: "https://www.notion.so/" },
];

const grid = document.getElementById("sc-grid");
const modal = document.getElementById("sc-modal");
const form = document.getElementById("sc-form");
const titleEl = document.getElementById("sc-title");
const nameIn = document.getElementById("sc-name");
const urlIn = document.getElementById("sc-url");
const errEl = document.getElementById("sc-error");
let editingId = null;
let lastFocus = null;

function normalizeUrl(raw) {
  let s = raw.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;   // "javascript:x" jadi "https://javascript:x" yang gagal di bawah
  try {
    const u = new URL(s);
    if (!/^https?:$/.test(u.protocol)) return null;
    if (!u.hostname.includes(".") && u.hostname !== "localhost") return null;
    return u.href;
  } catch { return null; }
}

function defaultName(url) {
  const label = new URL(url).hostname.replace(/^www\./, "").split(".")[0];
  return label ? label[0].toUpperCase() + label.slice(1) : "Website";
}
const initial = name => Array.from(name.trim())[0]?.toUpperCase() ?? "?";
const hue = name => {
  let h = 0;
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
};

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (Array.isArray(raw)) {
      return raw.flatMap(s => {
        const url = typeof s?.url === "string" ? normalizeUrl(s.url) : null;
        if (!url || typeof s.name !== "string" || typeof s.id !== "string") return [];
        return [{ id: s.id, name: s.name.slice(0, 30), url }];
      });
    }
  } catch {}
  return DEFAULTS.map(s => ({ ...s }));
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state.shortcuts)); } catch {}
}

state.shortcuts = load();

function render() {
  const tiles = state.shortcuts.map(s => {
    const item = document.createElement("div");
    item.className = "sc-item";
    item.dataset.id = s.id;

    const a = document.createElement("a");
    a.className = "sc-tile";
    a.href = s.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    const ico = document.createElement("span");
    ico.className = "sc-ico";
    ico.textContent = initial(s.name);
    ico.style.background = `hsl(${hue(s.name)} 55% 42%)`;
    const name = document.createElement("span");
    name.className = "sc-name";
    name.textContent = s.name;
    a.append(ico, name);

    const more = document.createElement("button");
    more.className = "sc-more";
    more.setAttribute("aria-label", `Options for ${s.name}`);
    more.textContent = "⋮";

    const menu = document.createElement("div");
    menu.className = "sc-menu";
    for (const [act, label] of [["edit", "Edit"], ["remove", "Delete"]]) {
      const b = document.createElement("button");
      b.dataset.act = act;
      b.textContent = label;
      menu.append(b);
    }

    item.append(a, more, menu);
    return item;
  });

  const add = document.createElement("button");
  add.className = "sc-tile sc-add";
  add.dataset.act = "add";
  const plus = document.createElement("span");
  plus.className = "sc-ico";
  plus.textContent = "+";
  const label = document.createElement("span");
  label.className = "sc-name";
  label.textContent = "Add shortcut";
  add.append(plus, label);

  grid.replaceChildren(...tiles, add);
}

function closeMenus() {
  grid.querySelectorAll(".sc-item.menu-open").forEach(i => i.classList.remove("menu-open"));
}

grid.addEventListener("click", e => {
  const more = e.target.closest(".sc-more");
  if (more) {
    const item = more.closest(".sc-item");
    const wasOpen = item.classList.contains("menu-open");
    closeMenus();
    item.classList.toggle("menu-open", !wasOpen);
    return;
  }
  const btn = e.target.closest("[data-act]");
  if (!btn) return;                       // klik di tautan biasa: biarkan browser membukanya
  const id = btn.closest(".sc-item")?.dataset.id;
  closeMenus();
  if (btn.dataset.act === "add") openModal();
  else if (btn.dataset.act === "edit") openModal(id);
  else if (btn.dataset.act === "remove") removeShortcut(id);
});

document.addEventListener("pointerdown", e => {
  if (!e.target.closest(".sc-menu, .sc-more")) closeMenus();
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape") closeMenus();
});

function removeShortcut(id) {
  const s = state.shortcuts.find(x => x.id === id);
  if (!s) return;
  setState("shortcuts", state.shortcuts.filter(x => x.id !== id));
  emit("toast", { title: "Shortcut removed", message: s.name, duration: 2500 });
}

function openModal(id = null) {
  if (!id && state.shortcuts.length >= MAX) {
    emit("toast", { title: "Limit reached", message: `Maximum ${MAX} shortcuts`, type: "warn" });
    return;
  }
  const s = id ? state.shortcuts.find(x => x.id === id) : null;
  editingId = s ? s.id : null;
  titleEl.textContent = s ? "Edit shortcut" : "Add shortcut";
  nameIn.value = s?.name ?? "";
  urlIn.value = s?.url ?? "";
  errEl.textContent = "";
  lastFocus = document.activeElement;
  modal.inert = false;
  modal.classList.add("open");
  setState("modal", true);
  nameIn.focus();
}

function closeModal() {
  modal.classList.remove("open");
  modal.inert = true;
  setState("modal", false);
  if (lastFocus?.isConnected) lastFocus.focus();   // kembalikan fokus ke asalnya
}

form.addEventListener("submit", e => {
  e.preventDefault();
  const url = normalizeUrl(urlIn.value);
  if (!url) {
    errEl.textContent = "Invalid URL. Example: github.com";
    urlIn.focus();
    return;
  }
  const name = nameIn.value.trim() || defaultName(url);
  const list = state.shortcuts.slice();
  const i = editingId ? list.findIndex(s => s.id === editingId) : -1;
  if (i >= 0) list[i] = { ...list[i], name, url };
  else list.push({ id: uid(), name, url });
  setState("shortcuts", list);
  closeModal();
});

document.getElementById("sc-cancel").addEventListener("click", closeModal);
modal.addEventListener("pointerdown", e => { if (e.target === modal) closeModal(); });
modal.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    e.stopPropagation();   // Esc hanya menutup modal, bukan panel di belakangnya
    closeModal();
  } else if (e.key === "Tab") {
    const f = [...modal.querySelectorAll("input, button")];
    const first = f[0], last = f.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});

on("state:shortcuts", () => { render(); save(); });
render();