import { state, setState, on, closeOthers } from "../core/state.js";
import { openPanel } from "./panel.js";
import { openFilter } from "../appearance/filter.js";
import { openLibrary } from "../core/features.js";
import { createIcon } from "../core/icons.js";

// Tombol bulat + menu akses cepat untuk layar sentuh.
// HP: kiri bawah, menumpang di bar bawah. Tablet: kanan bawah, bar kiri tidak berubah.
// Tampil atau tidaknya diatur CSS (css/phone.css); di desktop dengan mouse tombol ini tersembunyi.
const ITEMS = [
  ["45_folders.png", "Panel", () => openPanel({ pin: true })],
  ["39_search.png", "Launcher", () => setState("launcher", true)],
  ["01_keyboard.png", "Terminal", () => setState("terminal", true)],
  ["20_last_quarter_moon.png", "Temperature & brightness", () => openFilter({ pin: true })],
  ["30_headphones.png", "Music", () => openLibrary()],
  ["12_settings.png", "Settings", () => setState("prefsOpen", true)],
];

const fab = document.createElement("button");
fab.id = "fab";
fab.type = "button";
fab.setAttribute("aria-label", "Quick access menu");
fab.setAttribute("aria-haspopup", "menu");
fab.setAttribute("aria-expanded", "false");
fab.setAttribute("aria-controls", "fab-menu");
fab.textContent = "＋";

const menu = document.createElement("div");
menu.id = "fab-menu";
menu.setAttribute("role", "menu");
menu.inert = true;

for (const [icon, label, run] of ITEMS) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "fab-item";
  b.setAttribute("role", "menuitem");
  const i = document.createElement("span");
  i.className = "fab-ico";
  i.append(createIcon(icon));
  b.append(i, label);
  b.addEventListener("click", () => {
    close();
    run();
  });
  menu.append(b);
}

document.body.append(menu, fab);

function open(byKeyboard = false) {
  menu.inert = false;
  menu.classList.add("open");
  fab.classList.add("open");
  fab.setAttribute("aria-expanded", "true");
  if (byKeyboard) menu.querySelector(".fab-item")?.focus();
}
function close(restore = false) {
  menu.inert = true;
  menu.classList.remove("open");
  fab.classList.remove("open");
  fab.setAttribute("aria-expanded", "false");
  if (restore) fab.focus();
}

fab.addEventListener("click", (e) => {
  if (menu.classList.contains("open")) return close();
  closeOthers("fab");            // tutup panel, terminal, launcher, musik, dll. dulu
  open(e.detail === 0);
});

document.addEventListener("pointerdown", (e) => {
  if (menu.classList.contains("open") && !e.target.closest("#fab, #fab-menu")) close();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && menu.classList.contains("open")) close(true);
});
on("state:off", (off) => off && close());
on("overlay:open", (k) => { if (k !== "fab") close(); });   // menu FAB sendiri jangan ikut tertutup