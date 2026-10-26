import { on } from "../core/state.js";
import { currentTrack, isPlaying } from "./audio.js";

const card = document.querySelector(".mini");
const cover = document.getElementById("mini-cover");
const titleEl = document.getElementById("mini-title");
const artistEl = document.getElementById("mini-artist");

function showTrack(t) {
  titleEl.textContent = t?.title ?? "No track selected";
  artistEl.textContent = t?.artist ?? "";
  cover.style.backgroundImage = t?.cover ? `url("${t.cover}")` : "none";
}

const togglePlay = () => document.getElementById("btn-play").click();
cover.addEventListener("click", togglePlay);
cover.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    togglePlay();
  }
});

on("audio:track", showTrack);
on("audio:play", (p) => card.classList.toggle("playing", p));

showTrack(currentTrack());               // lagu yang sudah termuat sebelum modul ini jalan
card.classList.toggle("playing", isPlaying());