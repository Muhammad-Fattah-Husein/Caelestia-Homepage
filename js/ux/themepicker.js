import { state, setState, on } from "../core/state.js";
import { THEMES, setTheme } from "../system/theme.js";
import { openLibrary } from "../core/features.js";

const picker = document.getElementById("theme-picker");
const grid = document.getElementById("tp-grid");
const trigger = document.getElementById("bar-title");
let built = false;

function markActive() {
  grid.querySelectorAll(".tp-item").forEach((el, i) => {
    el.classList.toggle("active", i === state.theme);
    el.setAttribute("aria-pressed", String(i === state.theme));
  });
}

function build() {
  if (built) return;
  built = true;
  grid.replaceChildren(
    ...THEMES.map((t, i) => {
      const btn = document.createElement("button");
      btn.className = "tp-item";
      btn.setAttribute("aria-label", `Theme ${t.name}`);

      const img = document.createElement("img");
      img.src = t.thumb ?? t.src;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.addEventListener("error", () => {
        if (t.thumb && img.getAttribute("src") === t.thumb)
          img.src = t.src; // thumb tidak ada: coba gambar asli
        else img.remove(); // keduanya gagal: sisakan kotak berwarna
      });

      const name = document.createElement("span");
      name.className = "tp-name";
      name.textContent = t.name;

      btn.append(img, name);
      btn.addEventListener("click", () => setTheme(i));
      return btn;
    }),
  );
    const add = document.createElement("button");
  add.type = "button";
  add.className = "tp-item tp-add";
  add.textContent = "＋ Manage";
  add.setAttribute("aria-label", "Manage wallpapers");
  add.addEventListener("click", () => {
    setState("themePicker", false);
    openLibrary("wall");
  });
  grid.append(add);
  markActive();
}

on("state:themePicker", (open) => {
  if (open) build();
  picker.classList.toggle("open", open);
  picker.inert = !open;
  trigger.setAttribute("aria-expanded", String(open));
});
on("state:theme", markActive);

const syncTitle = () => { trigger.textContent = THEMES[state.theme].name; };
on("state:theme", syncTitle);
syncTitle();

on("themes:changed", () => {
  built = false; // daftar tema berubah: bangun ulang
  if (state.themePicker) build();
  syncTitle();
});

trigger.addEventListener("click", () => {
  if (matchMedia("(pointer: fine)").matches) return; // laptop: hanya label, ganti tema lewat >wallpapers
  setState("themePicker", !state.themePicker);
});

document.addEventListener("pointerdown", (e) => {
  if (
    state.themePicker &&
    !picker.contains(e.target) &&
    !trigger.contains(e.target)
  )
    setState("themePicker", false);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") setState("themePicker", false);
});