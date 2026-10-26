import { state, setState, emit } from "../core/state.js";
import { openPanel, togglePanel } from "../ui/panel.js";
import { toggleFilter, nudge } from "../appearance/filter.js";

// =====================================================================
// Pintasan keyboard satu tombol. Aturan umum: tidak aktif saat mengetik di kolom isian,
// saat ada dialog, saat halaman dimatikan, atau bersama Ctrl/Alt/Cmd.
// Bisa dimatikan (pedoman aksesibilitas untuk pintasan satu tombol) lewat bantuan "?".
// =====================================================================
const KEY = "keys";
const TABS = ["dashboard", "media", "performance", "workspaces", "calendar"];
const STEP = 10;

let enabled = true;
try {
  const raw = JSON.parse(localStorage.getItem(KEY));
  if (raw && raw.single === false) enabled = false;
} catch {}

export const singleKeysEnabled = () => enabled;
export function setSingleKeys(on) {
  enabled = Boolean(on);
  try { localStorage.setItem(KEY, JSON.stringify({ single: enabled })); } catch {}
  if (box) box.checked = enabled;
  emit("toast", { title: "Single-key shortcuts", message: enabled ? "On" : "Off", duration: 1800 });
}

const ROWS = [
  ["p", "Open or close the top panel"],
  ["1 – 5", "Dashboard, Media, Performance, Workspaces, Calendar"],
  ["f", "Open or close brightness and temperature controls"],
  ["[   ]", "Dim / brighten the screen"],
  ["Shift + [   ]", "Cooler / warmer color temperature"],
  ["/  or  Ctrl + K", "Launcher"],
  ["`", "Terminal"],
  ["Esc", "Close the current overlay"],
  ["?", "Show this help"],
];

// ---- jendela bantuan ----
let help, box, closeBtn, helpLast;

function buildHelp() {
  help = document.createElement("div");
  help.className = "modal";
  help.inert = true;

  const card = document.createElement("div");
  card.className = "modal-box keys-box";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-label", "Keyboard shortcuts");

  const h = document.createElement("h2");
  h.textContent = "Keyboard shortcuts";
  const list = document.createElement("dl");
  list.className = "keys-list";
  for (const [k, text] of ROWS) {
    const dt = document.createElement("dt");
    const kbd = document.createElement("kbd");
    kbd.textContent = k;
    dt.append(kbd);
    const dd = document.createElement("dd");
    dd.textContent = text;
    list.append(dt, dd);
  }

  const label = document.createElement("label");
  label.className = "keys-opt";
  box = document.createElement("input");
  box.type = "checkbox";
  box.checked = enabled;
  box.addEventListener("change", () => setSingleKeys(box.checked));
  label.append(box, " Enable single-key shortcuts (p, f, 1–5, [ ])");

  const actions = document.createElement("div");
  actions.className = "modal-actions";
  closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.textContent = "Close";
  closeBtn.addEventListener("click", closeHelp);
  actions.append(closeBtn);

  card.append(h, list, label, actions);
  help.append(card);
  document.body.append(help);

  help.addEventListener("pointerdown", (e) => { if (e.target === help) closeHelp(); });
  help.addEventListener("keydown", (e) => {
    if (e.key === "Escape" || e.key === "?") {
      e.stopPropagation();   // hanya menutup bantuan, bukan panel di belakangnya
      e.preventDefault();
      closeHelp();
    } else if (e.key === "Tab") {   // fokus berputar di antara dua kontrol
      const first = box, last = closeBtn;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
}

export function openHelp() {
  if (!help) buildHelp();
  helpLast = document.activeElement;
  box.checked = enabled;
  help.inert = false;
  help.classList.add("open");
  setState("modal", true);   // panel di belakangnya tidak menutup sendiri
  closeBtn.focus();
}
export function closeHelp() {
  if (!help) return;
  help.classList.remove("open");
  help.inert = true;
  setState("modal", false);
  if (helpLast?.isConnected) helpLast.focus();
}
export const toggleHelp = () => (help?.classList.contains("open") ? closeHelp() : openHelp());

// ---- pemrosesan tombol ----
document.addEventListener("keydown", (e) => {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || state.off || state.modal) return;
  const el = document.activeElement;
  if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;

  if (e.key === "?") {   // selalu aktif, supaya pintasan yang dimatikan bisa dinyalakan lagi
    e.preventDefault();
    return toggleHelp();
  }
  if (!enabled) return;

  // kurung siku dibaca dari posisi tombol, jadi tetap benar di tata letak keyboard lain
  if (e.code === "BracketLeft" || e.code === "BracketRight") {
    e.preventDefault();
    const sign = e.code === "BracketRight" ? 1 : -1;
    nudge(e.shiftKey ? "temp" : "light", sign * STEP);
    return;
  }
  if (e.repeat || e.shiftKey) return;

  if (e.key === "p") { e.preventDefault(); togglePanel({ focus: true }); }
  else if (e.key === "f") { e.preventDefault(); toggleFilter({ focus: true }); }
  else if (/^[1-5]$/.test(e.key)) {
    e.preventDefault();
    openPanel({ pin: true, focus: true, tab: TABS[Number(e.key) - 1] });
  }
});