import { state, setState, on, closeOthers } from "../core/state.js";

const panel = document.getElementById("panel");
const edge = document.getElementById("edge");
const logo = document.getElementById("bar-logo");
const tabsNav = document.querySelector(".tabs");
const tabs = [...document.querySelectorAll(".tab")];
const views = [...document.querySelectorAll(".view")];
let closeTimer;
let pinned = false;         // dibuka dengan sengaja (klik, ketuk, keyboard): tidak menutup sendiri saat kursor pergi
let pinnedByModal = false;  // dipin sementara karena ada dialog yang dibuka dari dalam panel
let opener = null;          // elemen yang fokusnya dikembalikan saat panel ditutup lewat keyboard

// panel tidak boleh menutup selagi: modal terbuka, sedang menyeret, atau sedang mengetik di dalamnya
const busy = () => {
  const el = document.activeElement;
  const typing = panel.contains(el) && /^(INPUT|TEXTAREA)$/.test(el.tagName);
  return state.modal || state.drag || typing;
};

// pin = true: dibuka dengan sengaja. false: hanya karena kursor singgah di tepi atas (menutup sendiri)
export function openPanel({ pin = false, focus = false, tab } = {}) {
  clearTimeout(closeTimer);
  if (tab) setState("activeTab", tab);
  if (pin) pinned = true;
  if (focus && !state.panelOpen) opener = document.activeElement;
  setState("panelOpen", true);
  if (focus) (panel.querySelector(".tab.active") ?? tabs[0])?.focus({ preventScroll: true });
  if (pin) { pinned = true; closeOthers("panelOpen"); }
}

export function closePanel({ restore = false } = {}) {
  clearTimeout(closeTimer);
  pinned = false;
  pinnedByModal = false;
  setState("panelOpen", false);
  if (restore && opener?.isConnected) opener.focus({ preventScroll: true });
  opener = null;
}

export const togglePanel = (opts = {}) =>
  state.panelOpen ? closePanel({ restore: true }) : openPanel({ pin: true, ...opts });

function scheduleClose() {
  clearTimeout(closeTimer);
  if (pinned) return;
  closeTimer = setTimeout(() => { if (!busy()) setState("panelOpen", false); }, 300);
}

// ---- hover (mouse) ----
edge.addEventListener("mouseenter", () => openPanel());
edge.addEventListener("mouseleave", scheduleClose);
panel.addEventListener("mouseenter", () => {
  clearTimeout(closeTimer);
  if (!state.panelOpen) openPanel();
});
panel.addEventListener("mouseleave", scheduleClose);
panel.addEventListener("focusout", (e) => {
  if (e.relatedTarget && panel.contains(e.relatedTarget)) return;   // fokus hanya pindah di dalam panel
  if (!pinned && !panel.matches(":hover")) scheduleClose();
});
on("state:drag", (d) => { if (!d && !pinned && !panel.matches(":hover")) scheduleClose(); });

// dialog dibuka dari dalam panel: panel bertahan, lalu menutup sendiri sebentar setelah dialog selesai
on("state:modal", (m) => {
  if (m && state.panelOpen && !pinned) { pinned = true; pinnedByModal = true; }
  else if (!m && pinnedByModal) {
    pinnedByModal = false;
    pinned = false;
    if (!panel.matches(":hover")) {
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => { if (!busy() && !pinned) setState("panelOpen", false); }, 1500);   // waktu untuk lanjut menambah
    }
  }
});

on("state:panelOpen", (isOpen) => {
  panel.classList.toggle("open", isOpen);
  panel.inert = !isOpen;
  logo.setAttribute("aria-expanded", String(isOpen));
  if (!isOpen) { pinned = false; pinnedByModal = false; }
});

// ---- tab: ARIA, tab bergantian dengan panah ----
tabsNav.setAttribute("role", "tablist");
tabs.forEach((t) => t.setAttribute("role", "tab"));
views.forEach((v) => v.setAttribute("role", "tabpanel"));

function markTabs(name) {
  tabs.forEach((t) => {
    const active = t.dataset.tab === name;
    t.classList.toggle("active", active);
    t.setAttribute("aria-selected", String(active));
    t.tabIndex = active ? 0 : -1;   // hanya tab aktif yang masuk urutan Tab; yang lain dijangkau dengan panah
  });
  views.forEach((v) => v.classList.toggle("active", v.dataset.view === name));
}
on("state:activeTab", markTabs);
markTabs(state.activeTab);

tabs.forEach((tab) => tab.addEventListener("click", () => setState("activeTab", tab.dataset.tab)));
tabsNav.addEventListener("keydown", (e) => {
  const i = tabs.indexOf(document.activeElement);
  if (i < 0) return;
  const to = { ArrowRight: (i + 1) % tabs.length, ArrowLeft: (i - 1 + tabs.length) % tabs.length, Home: 0, End: tabs.length - 1 }[e.key];
  if (to === undefined) return;
  e.preventDefault();
  setState("activeTab", tabs[to].dataset.tab);
  tabs[to].focus();
});

// ---- tombol logo di bar kiri: klik, ketuk, atau Enter/Spasi ----
logo.setAttribute("aria-controls", "panel");
logo.setAttribute("aria-expanded", "false");
logo.addEventListener("click", (e) => togglePanel({ focus: e.detail === 0 }));   // detail 0 = lewat keyboard: fokus ikut masuk

// tutup lewat klik di luar atau Esc
document.addEventListener("pointerdown", (e) => {
  if (state.panelOpen && !state.modal && !panel.contains(e.target) && !e.target.closest("#edge, #bar-logo, #fab, #fab-menu"))
    closePanel();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && state.panelOpen) closePanel({ restore: true });
});