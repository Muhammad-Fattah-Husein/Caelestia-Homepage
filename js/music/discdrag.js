import { holdToPlace } from "../ux/place.js";

const cover = document.getElementById("cover");

holdToPlace(cover, "disc", {
  ghost() {
    const g = document.createElement("div");   // salinan disc yang mengikuti kursor
    g.className = "disc disc-ghost";
    g.style.backgroundImage = cover.style.backgroundImage;
    return g;
  },
  onHold() {
    cover.classList.add("dup");
    cover.addEventListener("animationend", () => cover.classList.remove("dup"), { once: true });
  },
});