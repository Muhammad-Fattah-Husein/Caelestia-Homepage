import { on, off } from "../core/state.js";
import {
  currentTrack,
  isShuffle,
  toggleShuffle,
  getVolume,
  setVolume,
} from "./audio.js";
   import { inset } from "../ui/layout.js";

const audio = document.getElementById("audio");

const CARD_W = 340; // lebar kartu
const CARD_H = 130; // perkiraan tinggi kartu
const DISC_R = 61; // jari-jari disc saat membesar (84px × 1.45 / 2)
   const EDGE = {
     get left() { return inset().left; }, get right() { return inset().right; },
     get top() { return inset().top; }, get bottom() { return inset().bottom; },
   }; // bar kiri + bingkai jendela

const ICON = {
  play: '<path d="M8 5v14l11-7z"/>',
  pause: '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>',
  vol: '<path d="M4 9v6h4l5 5V4L8 9H4z"/><path d="M16.5 12a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/>',
  mute: '<path d="M4 9v6h4l5 5V4L8 9H4z"/><path d="M19.5 6.5l-13 13M6.5 6.5l13 13"/>',
  prev: '<path d="M11 6L2 12l9 6V6z"/><path d="M22 6l-9 6 9 6V6z"/>',
  next: '<path d="M13 6l9 6-9 6V6z"/><path d="M2 6l9 6-9 6V6z"/>',
  shuffle:
    '<path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/>',
};
const svg = (name) =>
  `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${ICON[name]}</svg>`;

let current = null; // { widget, card, ac, volTimer }

function build() {
  const el = document.createElement("div");
  el.className = "dp";
  el.setAttribute("data-nodrag", ""); // klik di kartu tidak dianggap menggeser widget
  el.innerHTML = `
    <div class="dp-top">
      <div class="dp-meta">
        <p class="dp-title"></p>
        <p class="dp-artist"></p>
      </div>
      <div class="dp-side">
        <button class="dp-btn dp-shuffle" type="button" aria-label="Shuffle">${svg("shuffle")}</button>
        <div class="dp-vol">
          <button class="dp-btn dp-mute" type="button" aria-label="Volume">${svg("vol")}</button>
          <div class="dp-vol-box">
            <input class="dp-range dp-volume" type="range" min="0" max="100" step="1" aria-label="Volume" />
          </div>
        </div>
      </div>
    </div>
    <input class="dp-range dp-seek" type="range" min="0" max="100" step="0.1" value="0" aria-label="Track position" />
    <div class="dp-ctrl">
      <button class="dp-btn dp-prev" type="button" aria-label="Prev">${svg("prev")}</button>
      <button class="dp-btn dp-play" type="button" aria-label="Play">${svg("play")}</button>
      <button class="dp-btn dp-next" type="button" aria-label="Next">${svg("next")}</button>
    </div>`;
  return el;
}

// teks dihapus lalu diketik ulang saat lagu berganti
function typeText(el, text) {
  const tok = (el._tok = Symbol());
  const old = el.dataset.text ?? "";
  el.dataset.text = text;
  let i = old.length,
    j = 0;
  const tick = () => {
    if (el._tok !== tok) return; // ada lagu yang lebih baru
    if (i > 0) {
      i--;
      el.textContent = old.slice(0, i) + "|";
      setTimeout(tick, 18);
    } else if (j < text.length) {
      j++;
      el.textContent = text.slice(0, j) + "|";
      setTimeout(tick, 26);
    } else el.textContent = text;
  };
  tick();
}

// pilih sisi yang lega: kanan dulu, lalu kiri, kalau sempit keduanya muncul di bawah atau atas
function place() {
  const { widget, card } = current;
  const r = widget.getBoundingClientRect();
  const cx = r.left + r.width / 2,
    cy = r.top + r.height / 2;
  const right = innerWidth - EDGE.right,
    top = EDGE.top,
    bottom = innerHeight - EDGE.bottom;
  const reach = DISC_R * 0.5 + 8;
  const roomR = right - cx - reach,
    roomL = cx - EDGE.left - reach;
  const MIN_W = 250;

  let side,
    w = CARD_W,
    k = 1.45,
    shift = 0,
    vshift = 0;
  if (roomR >= CARD_W) side = "right";
  else if (roomL >= CARD_W) side = "left";
  else if (Math.max(roomR, roomL) >= MIN_W) {
    side = roomR >= roomL ? "right" : "left";
    w = Math.max(roomR, roomL); // kartu menyempit mengikuti ruang yang ada
  } else {
    side = cy + 52 + CARD_H <= bottom ? "below" : "above";
    k = 1;
    w = Math.min(CARD_W, right - EDGE.left);
    const l = cx - w / 2;
    shift =
      l < EDGE.left
        ? EDGE.left - l
        : cx + w / 2 > right
          ? right - (cx + w / 2)
          : 0;
  }
  if (side === "left" || side === "right") {
    if (cy - CARD_H / 2 < top) vshift = top - (cy - CARD_H / 2);
    else if (cy + CARD_H / 2 > bottom) vshift = bottom - (cy + CARD_H / 2);
  }

  card.dataset.side = side;
  card.style.setProperty("--w", w + "px");
  card.style.setProperty("--shift", shift + "px");
  card.style.setProperty("--vshift", vshift + "px");
  widget.style.setProperty("--k", k); // disc membesar mengikuti tinggi kartu
}

function openDiscPlayer(widget) {
  closeDiscPlayer();
  const card = build();
  widget.append(card); // anak widget: ikut bergeser saat widget diseret
  const ac = new AbortController();
  const { signal } = ac;
  current = { widget, card, ac, volTimer: 0 };

  const q = (s) => card.querySelector(s);
  const titleEl = q(".dp-title"),
    artistEl = q(".dp-artist");
  const playIcon = q(".dp-play"),
    shuffleBtn = q(".dp-shuffle");
  const volWrap = q(".dp-vol"),
    muteBtn = q(".dp-mute"),
    vol = q(".dp-volume"),
    seek = q(".dp-seek");
  let seeking = false;

  // ---- teks lagu ----
  const showTrack = (t) => {
    typeText(titleEl, t?.title ?? "No track selected");
    typeText(artistEl, t?.artist ?? "");
  };
  const onTrack = (t) => showTrack(t);
  on("audio:track", onTrack);
  showTrack(currentTrack());

  // ---- putar / jeda ----
  const syncPlay = () => {
    playIcon.innerHTML = svg(audio.paused ? "play" : "pause");
  };
  audio.addEventListener("play", syncPlay, { signal });
  audio.addEventListener("pause", syncPlay, { signal });
  syncPlay();
  q(".dp-play").addEventListener("click", () =>
    document.getElementById("btn-play").click(),
  );
  q(".dp-prev").addEventListener("click", () =>
    document.getElementById("btn-prev").click(),
  );
  q(".dp-next").addEventListener("click", () =>
    document.getElementById("btn-next").click(),
  );

  // ---- posisi lagu ----
  const syncSeek = () => {
    if (seeking || !audio.duration) return;
    const pct = (audio.currentTime / audio.duration) * 100;
    seek.value = pct;
    seek.style.setProperty("--p", pct + "%");
  };
  audio.addEventListener("timeupdate", syncSeek, { signal });
  audio.addEventListener("loadedmetadata", syncSeek, { signal });
  seek.addEventListener(
    "pointerdown",
    () => {
      seeking = true;
    },
    { signal },
  );
  const endSeek = () => {
    seeking = false;
  };
  window.addEventListener("pointerup", endSeek, { signal });
  window.addEventListener("pointercancel", endSeek, { signal });
  seek.addEventListener("input", () => {
    if (audio.duration) audio.currentTime = (seek.value / 100) * audio.duration;
    seek.style.setProperty("--p", seek.value + "%");
  });
  syncSeek();

  // ---- acak ----
  shuffleBtn.classList.toggle("active", isShuffle());
  shuffleBtn.addEventListener("click", () =>
    shuffleBtn.classList.toggle("active", toggleShuffle()),
  );

  // ---- volume: tombol mengembang jadi slider ----
  const syncVol = () => {
    const v = getVolume();
    vol.value = Math.round(v * 100);
    vol.style.setProperty("--p", vol.value + "%");
    muteBtn.innerHTML = svg(v <= 0 ? "mute" : "vol");
  };
  const armVolClose = () => {
    clearTimeout(current?.volTimer);
    if (current)
      current.volTimer = setTimeout(
        () => volWrap.classList.remove("open"),
        1400,
      );
  };
  muteBtn.addEventListener("click", () => {
    const opening = !volWrap.classList.contains("open");
    volWrap.classList.toggle("open", opening);
    if (opening) {
      shuffleBtn.classList.remove("bounce");
      void shuffleBtn.offsetWidth; // mulai ulang animasi
      shuffleBtn.classList.add("bounce");
      armVolClose();
    }
  });
  vol.addEventListener("input", () => {
    setVolume(vol.value / 100);
    syncVol();
    armVolClose();
  });
  syncVol();

  // ---- penempatan, penutupan ----
  const replace = () => {
    if (!current) return;
    if (!widget.isConnected) return closeDiscPlayer();
    place();
  };
  on("state:widgets", replace); // didaftarkan saat dibuka: pasti berjalan sesudah render widgets.js
  current.replace = replace;
  current.onTrack = onTrack;
  window.addEventListener("resize", place, { signal });
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (!card.contains(e.target) && !widget.contains(e.target))
        closeDiscPlayer();
    },
    { signal },
  );
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape") closeDiscPlayer();
    },
    { signal },
  );

  place();
  widget.classList.add("dp-open");
  void card.offsetWidth; // paksa gaya awal terhitung dulu supaya transisi jalan
  card.classList.add("open");
}

export function closeDiscPlayer(widget) {
  if (!current || (widget && current.widget !== widget)) return;
  const { widget: w, card, ac, replace, onTrack, volTimer } = current;
  current = null;
  ac.abort();
  off("state:widgets", replace);
  off("audio:track", onTrack);
  clearTimeout(volTimer);
  card.classList.remove("open");
  w.style.removeProperty("--k");
  setTimeout(() => {
    card.remove();
    if (current?.widget !== w) w.classList.remove("dp-open");
  }, 320);
}

export function toggleDiscPlayer(widget) {
  if (current?.widget === widget) closeDiscPlayer();
  else openDiscPlayer(widget);
}
