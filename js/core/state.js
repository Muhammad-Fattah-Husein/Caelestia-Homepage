const listeners = {};
export const LOCALE = "en-US";
const FORCE_ZONE = null; // contoh: "Asia/Jakarta"; null = otomatis dari perangkat
export const zone =
  FORCE_ZONE ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export const state = {
  activeTab: "dashboard",
  panelOpen: false,
  workspace: 0,
  theme: 0,
  themePicker: false,
  launcher: false,
  terminal: false,
  menu: false,
  powerMenu: false,
  off: false,
  filter: { temp: 0, light: 0, auto: false },
  mode: null,
  shortcuts: [],
  modal: false,
  drag: false,
  widgets: [],
  prefs: null, prefsOpen: false,   // prefs diisi oleh prefs.js
  modeLook: null,   // penimpa tampilan dari suasana aktif, atau null
};

const OVERLAYS = ["panelOpen", "themePicker", "launcher", "terminal", "menu", "powerMenu", "social", "prefsOpen"];

const EXCLUSIVE = ["panelOpen", "themePicker", "launcher", "terminal", "menu", "powerMenu"];
const SOFT = ["panelOpen", "menu"];   // juga dibuka hover atau "mengintip": mereka memanggil closeOthers sendiri, hanya saat dibuka dengan sengaja

export function on(event, fn) {
  (listeners[event] ||= []).push(fn);
}

export function emit(event, data) {
  [...(listeners[event] || [])].forEach((fn) => {
    try {
      fn(data);
    } catch (err) {
      console.error(`Listener for "${event}" failed:`, err);
    }
  });
}

export function off(event, fn) {
  const list = listeners[event];
  const i = list ? list.indexOf(fn) : -1;
  if (i >= 0) list.splice(i, 1);
}

export function closeOthers(except) {
  for (const k of EXCLUSIVE) if (k !== except && state[k]) setState(k, false);
  emit("overlay:open", except);   // untuk yang bukan state: jendela musik, menu FAB
}

export function setState(key, value) {
  if (state[key] === value) return;
  if (value === true && OVERLAYS.includes(key) &&
      (state.off || (state.prefsOpen && key !== "prefsOpen"))) return;
  if (value === true && EXCLUSIVE.includes(key) && !SOFT.includes(key)) closeOthers(key);   // ← baru
  state[key] = value;
  emit("state:" + key, value);
}