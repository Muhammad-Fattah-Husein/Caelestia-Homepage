import { DEFS } from "../widgets/widgetdefs.js";
import { addWidget } from "../widgets/widgets.js";
import { holdToPlace } from "../ux/place.js";
import { on } from "../core/state.js";
import { preloadPlugin } from "./pluginhost.js";  // catalog.js
import { createIcon } from "../core/icons.js";

const root = document.getElementById("wd-catalog");

function renderCatalog() {
  root.replaceChildren();
  for (const [type, def] of Object.entries(DEFS)) {
  if (!def.listed) continue;   // disc tidak tampil di daftar

  const tile = document.createElement("div");
  tile.className = "wd-tile";
  tile.tabIndex = 0;
  tile.setAttribute("role", "button");
  tile.setAttribute("aria-label", `${def.name}: press Enter to add`);

  const ico = document.createElement("span");
  ico.className = "wd-ico";
  ico.append(createIcon(def.icon));
  const name = document.createElement("span");
  name.className = "wd-name";
  name.textContent = def.name;
  const desc = document.createElement("span");
  desc.className = "wd-desc";
  desc.textContent = def.desc;
  tile.append(ico, name, desc);

  holdToPlace(tile, type, {
    onHold: () => preloadPlugin(type),
    ghost() {
      const g = document.createElement("div");
      g.className = "wd-ghost";
      g.append(createIcon(def.icon));
      return g;
    },
  });
  tile.addEventListener("keydown", (e) => {   // cadangan untuk keyboard
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      addWidget(type, 0.5, 0.5);
    }
  });
  root.append(tile);
 }
}

renderCatalog();
on("plugins:changed", renderCatalog);