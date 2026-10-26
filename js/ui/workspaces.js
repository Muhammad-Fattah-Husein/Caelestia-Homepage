import { state, setState, on } from "../core/state.js";

export const WORKSPACES = [
  { name: "Work", type: "shortcuts" },
  { name: "Notes", type: "notes" },
  { name: "Widgets", type: "widgets" },
];

const listEl = document.getElementById("ws-list");
const panes = document.querySelectorAll(".ws-pane");

function renderList() {
  listEl.replaceChildren(...WORKSPACES.map((w, i) => {
    const btn = document.createElement("button");
    btn.className = "ws-btn" + (i === state.workspace ? " active" : "");
    const num = document.createElement("span");
    num.className = "num";
    num.textContent = i + 1;
    btn.append(num, w.name);
    btn.addEventListener("click", () => setState("workspace", i));
    return btn;
  }));
}

function renderPane() {
  const type = WORKSPACES[state.workspace].type;
  panes.forEach(p => p.classList.toggle("active", p.dataset.pane === type));
}

try {
  const saved = Number(localStorage.getItem("workspace"));
  if (Number.isInteger(saved) && saved >= 0 && saved < WORKSPACES.length) state.workspace = saved;
} catch {}

on("state:workspace", i => {
  renderList();
  renderPane();
  try { localStorage.setItem("workspace", i); } catch {}
});

renderList();
renderPane();