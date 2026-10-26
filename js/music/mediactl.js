import { on } from "../core/state.js";
import {
  isShuffle, toggleShuffle, getRepeat, cycleRepeat, getVolume, setVolume,
  currentTrack, nextTrack, prevTrack,
} from "./audio.js";

const $ = (id) => document.getElementById(id);
const audio = $("audio");

// ---- kontrol tambahan di tab Media: acak, ulang, volume ----
const shuffleBtn = $("btn-shuffle");
const repeatBtn = $("btn-repeat");
const vol = $("vol");

const PATH = {
  shuffle:
    '<path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/>',
  repeat: '<path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>',
  repeatOne:
    '<path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/><path d="M13 15V9h-1l-2 1v1h1.5v4H13z"/>',
  vol: '<path d="M4 9v6h4l5 5V4L8 9H4z"/><path d="M16.5 12a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/>',
  mute: '<path d="M4 9v6h4l5 5V4L8 9H4z"/><path d="M19.5 6.5l-13 13M6.5 6.5l13 13"/>',
};
const svg = (name) => `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${PATH[name]}</svg>`;

const REPEAT_LABEL = { off: "Repeat: off", all: "Repeat: all tracks", one: "Repeat: one track" };

function syncShuffle() {
  if (!shuffleBtn) return;
  shuffleBtn.classList.toggle("on", isShuffle());
  shuffleBtn.setAttribute("aria-pressed", String(isShuffle()));
}
function syncRepeat() {
  if (!repeatBtn) return;
  const m = getRepeat();
  repeatBtn.classList.toggle("on", m !== "off");
  repeatBtn.innerHTML = svg(m === "one" ? "repeatOne" : "repeat");
  repeatBtn.title = REPEAT_LABEL[m];
  repeatBtn.setAttribute("aria-label", REPEAT_LABEL[m]);
}
function syncVol() {
  if (!vol) return;
  vol.value = Math.round(getVolume() * 100);
  vol.style.setProperty("--p", vol.value + "%");
}

if (shuffleBtn) {
  shuffleBtn.innerHTML = svg("shuffle");
  shuffleBtn.addEventListener("click", () => toggleShuffle());
}
repeatBtn?.addEventListener("click", () => cycleRepeat());
vol?.addEventListener("input", () => setVolume(vol.value / 100));
on("audio:shuffle", syncShuffle);
on("audio:repeat", syncRepeat);
on("audio:volume", syncVol);
syncShuffle();
syncRepeat();
syncVol();

// ---- tombol media di keyboard, layar kunci, dan notifikasi sistem (Media Session) ----
const ms = navigator.mediaSession;

if (ms) {
  const abs = (u) => {
    try {
      return new URL(u, location.href).href;
    } catch {
      return null;
    }
  };

  const setMeta = (t) => {
    if (!t) {
      ms.metadata = null;
      return;
    }
    const src = t.cover ? abs(t.cover) : null;
    ms.metadata = new MediaMetadata({
      title: t.title,
      artist: t.artist || "",
      album: document.title || "Homepage",
      artwork: src ? [{ src, sizes: "512x512" }] : [],
    });
  };
  const setState = () => {
    ms.playbackState = currentTrack() ? (audio.paused ? "paused" : "playing") : "none";
  };
  const setPos = () => {
    const d = audio.duration;
    if (!ms.setPositionState || !Number.isFinite(d) || d <= 0) return;
    try {
      ms.setPositionState({
        duration: d,
        playbackRate: audio.playbackRate || 1,
        position: Math.min(Math.max(0, audio.currentTime), d),
      });
    } catch {}
  };

  const actions = {
    play: () => audio.play().catch(() => {}),
    pause: () => audio.pause(),
    previoustrack: () => prevTrack(),
    nexttrack: () => nextTrack(),
    seekto: (d) => {
      if (d.seekTime != null && Number.isFinite(audio.duration)) audio.currentTime = Math.min(d.seekTime, audio.duration);
    },
    seekbackward: (d) => {
      audio.currentTime = Math.max(0, audio.currentTime - (d.seekOffset || 10));
    },
    seekforward: (d) => {
      audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + (d.seekOffset || 10));
    },
    stop: () => {
      audio.pause();
      audio.currentTime = 0;
    },
  };
  for (const [name, fn] of Object.entries(actions)) {
    try {
      ms.setActionHandler(name, fn); // tidak semua browser mengenal semua aksi
    } catch {}
  }

  on("audio:track", (t) => {
    setMeta(t);
    setState();
  });
  for (const ev of ["play", "pause"])
    audio.addEventListener(ev, () => {
      setState();
      setPos();
    });
  for (const ev of ["loadedmetadata", "seeked", "ratechange"]) audio.addEventListener(ev, setPos);
  let lastPos = 0;
  audio.addEventListener("timeupdate", () => {
    if (performance.now() - lastPos > 5000) {
      lastPos = performance.now();
      setPos();
    }
  });

  setMeta(currentTrack());
  setState();
}