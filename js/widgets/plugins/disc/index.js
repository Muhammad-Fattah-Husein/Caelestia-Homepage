import { on } from "../../../core/state.js";
import { currentTrack } from "../../../music/audio.js";
import { toggleDiscPlayer, closeDiscPlayer } from "../../../music/discplayer.js";

const setCover = (disc, track) => {
  disc.style.backgroundImage = track?.cover ? `url("${track.cover}")` : "none";
};
on("audio:track", (track) => {
  document.querySelectorAll("#wd-layer .wd-disc .disc").forEach((disc) => setCover(disc, track));
});

export default function mount(body) {
  const disc = document.createElement("div");
  disc.className = "disc";
  setCover(disc, currentTrack());
  body.append(disc);
  const widget = body.closest(".wd-widget");
  return { onTap: () => toggleDiscPlayer(widget), cleanup: () => closeDiscPlayer(widget) };
}
