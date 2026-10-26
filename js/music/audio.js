import { state, on, emit } from "../core/state.js";
import { createIcon } from "../core/icons.js";
import { readBands, logBars } from "./bands.js";
import { getTrack, tracks as libraryTracks, addPlay, setDuration, loadLibrary } from "../library/library.js";

// pengaturan pemutar yang diingat antar kunjungan
const pref = (k, d) => {
  try {
    const v = JSON.parse(localStorage.getItem(k));
    return v ?? d;
  } catch {
    return d;
  }
};
const savePref = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};

let queue = []; // id lagu dalam urutan putar (data lagunya diambil dari library.js)
let index = -1; // posisi lagu yang sedang aktif di antrean
let counted = false; // lagu ini sudah dihitung sebagai satu kali putar
let resumeAt = 0; // detik tempat melanjutkan lagu yang dipulihkan
let lastSave = 0;
let shown = null; // info lagu yang sedang tampil, untuk mendeteksi perubahan judul atau cover

const $ = (id) => document.getElementById(id);
const audio = $("audio"),
  playBtn = $("btn-play"),
  seek = $("seek");
let dragging = false;

const fmt = (s) =>
  isFinite(s)
    ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`
    : "0:00";

function showTrack(t) {
  shown = t ? { id: t.id, title: t.title, artist: t.artist, cover: t.cover } : null;
  $("track-title").textContent = t ? t.title : "No track selected";
  $("track-artist").textContent = t ? t.artist : "";
  $("cover").style.backgroundImage = t?.cover ? `url("${t.cover}")` : "none";
  emit("audio:track", t);
}

function load(i, autoplay = false) {
  if (!queue.length) {
    // antrean kosong: hentikan dan kosongkan tampilan
    index = -1;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    seek.value = 0;
    $("t-cur").textContent = "0:00";
    $("t-dur").textContent = "0:00";
    showTrack(null);
    emit("audio:queue");
    saveLast();
    return;
  }
  index = ((i % queue.length) + queue.length) % queue.length; // muter balik di ujung daftar
  const t = getTrack(queue[index]);
  if (!t) {
    // lagu sudah dihapus dari perpustakaan: buang, lanjut ke berikutnya
    queue.splice(index, 1);
    return load(index, autoplay);
  }
  counted = false;
  resumeAt = 0;
  heard.add(queue[index]);
  audio.src = t.src;
  seek.value = 0;
  $("t-cur").textContent = "0:00";
  showTrack(t);
  emit("audio:queue");
  saveLast();
  if (autoplay) {
    emit("toast", {
      title: "Now playing",
      message: `${t.title}${t.artist ? " · " + t.artist : ""}`,
      duration: 3000,
    });
    audio.play().catch(() => {});
  }
}

playBtn.addEventListener("click", () =>
  audio.paused ? audio.play().catch(console.warn) : audio.pause(),
);
let shuffle = pref("lib:shuffle", false) === true;
let repeat = ["off", "all", "one"].includes(pref("lib:repeat", "all")) ? pref("lib:repeat", "all") : "all"; // off | all | one
const trail = []; // riwayat lagu untuk tombol prev saat mode acak
const heard = new Set(); // lagu yang sudah diputar pada putaran acak ini

// indeks lagu berikutnya, atau -1 kalau antrean sudah habis dan tidak diulang
function nextIndex(auto) {
  if (!queue.length) return -1;
  if (shuffle && queue.length > 1) {
    const all = queue.map((_, i) => i).filter((i) => i !== index);
    let pool = all.filter((i) => !heard.has(queue[i]));
    if (!pool.length) {
      if (auto && repeat === "off") return -1; // semua sudah terputar sekali
      heard.clear();
      heard.add(queue[index]);
      pool = all;
    }
    return pool[Math.floor(Math.random() * pool.length)];
  }
  if (index + 1 < queue.length) return index + 1;
  return auto && repeat === "off" ? -1 : 0; // tombol next di ujung antrean kembali ke awal
}
function goNext(auto = false) {
  if (!queue.length) return;
  const n = nextIndex(auto);
  if (n < 0) {
    audio.pause();
    audio.currentTime = 0; // antrean selesai
    return;
  }
  if (shuffle) {
    trail.push(index);
    if (trail.length > 50) trail.shift();
  }
  load(n, true);
}
function goPrev() {
  if (!queue.length) return;
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }
  if (shuffle && trail.length) load(trail.pop(), true);
  else load(index - 1, true);
}
$("btn-next").addEventListener("click", () => goNext(false));
$("btn-prev").addEventListener("click", goPrev);

export const isShuffle = () => shuffle;
export function setShuffle(v) {
  shuffle = !!v;
  trail.length = 0;
  heard.clear();
  if (queue[index]) heard.add(queue[index]);
  savePref("lib:shuffle", shuffle);
  emit("audio:shuffle", shuffle);
  return shuffle;
}
export const toggleShuffle = () => setShuffle(!shuffle);

export const getRepeat = () => repeat;
export function setRepeat(mode) {
  if (!["off", "all", "one"].includes(mode)) return repeat;
  repeat = mode;
  savePref("lib:repeat", repeat);
  emit("audio:repeat", repeat);
  return repeat;
}
export const cycleRepeat = () => setRepeat({ off: "all", all: "one", one: "off" }[repeat]);

let volume = Math.min(1, Math.max(0, Number(pref("lib:vol", 1)) || 0));
if (!Number.isFinite(volume)) volume = 1;
audio.volume = volume;
let gainNode = null;
export const getVolume = () => volume;
export function setVolume(v) {
  volume = Math.min(1, Math.max(0, Number(v) || 0));
  if (gainNode) gainNode.gain.value = volume;
  else audio.volume = volume;
  savePref("lib:vol", volume);
  emit("audio:volume", volume);
}

// ---- antrean ----
const valid = (id) => !!getTrack(id);
export const getQueue = () => queue.slice();
export const queueIndex = () => index;

export function playTracks(ids, start = 0) {
  const startId = ids[start];
  queue = ids.filter(valid);
  trail.length = 0;
  heard.clear();
  load(Math.max(0, queue.indexOf(startId)), true);
}
export function enqueue(ids) {
  ids = ids.filter(valid);
  if (!ids.length) return;
  if (!queue.length) return playTracks(ids, 0);
  queue.push(...ids);
  emit("audio:queue");
}
export function playNext(ids) {
  ids = ids.filter(valid);
  if (!ids.length) return;
  if (!queue.length) return playTracks(ids, 0);
  queue.splice(index + 1, 0, ...ids);
  emit("audio:queue");
}
export function jumpTo(i) {
  if (i >= 0 && i < queue.length) load(i, true);
}
export function removeFromQueue(i) {
  if (i < 0 || i >= queue.length) return;
  if (i === index) {
    const wasPlaying = !audio.paused;
    queue.splice(i, 1);
    load(Math.min(i, queue.length - 1), wasPlaying);
  } else {
    queue.splice(i, 1);
    if (i < index) index--;
    emit("audio:queue");
  }
}
export function clearQueue() {
  const cur = queue[index];
  queue = cur ? [cur] : [];
  index = cur ? 0 : -1;
  emit("audio:queue");
}
export function moveInQueue(from, to) {
  if (from === to || from < 0 || to < 0 || from >= queue.length || to >= queue.length) return;
  const [x] = queue.splice(from, 1);
  queue.splice(to, 0, x);
  if (index === from) index = to;
  else if (from < index && to >= index) index--;
  else if (from > index && to <= index) index++;
  emit("audio:queue");
}

// perpustakaan berubah: buang lagu yang hilang, perbarui info lagu yang sedang aktif
on("library:changed", () => {
  if (index < 0 || !queue.length) return;
  const curId = queue[index];
  const keep = queue.filter(valid);
  if (keep.length !== queue.length) {
    const wasPlaying = !audio.paused;
    queue = keep;
    const at = queue.indexOf(curId);
    if (at >= 0) {
      index = at;
      emit("audio:queue");
    } else load(Math.min(Math.max(index, 0), queue.length - 1), wasPlaying); // lagu yang diputar dihapus
  }
  const t = getTrack(queue[index]);
  if (t && (!shown || shown.id !== t.id || shown.title !== t.title || shown.artist !== t.artist || shown.cover !== t.cover))
    showTrack(t);
});

audio.addEventListener("play", () => {
  playBtn.replaceChildren(createIcon("06_pause.png"));
  playBtn.setAttribute("aria-label", "Pause");
  emit("audio:play", true);
  saveLast();
});
audio.addEventListener("pause", () => {
  playBtn.replaceChildren(createIcon("07_play.png"));
  playBtn.setAttribute("aria-label", "Play");
  emit("audio:play", false);
  saveLast();
});
audio.addEventListener("ended", () => {
  if (repeat === "one") {
    audio.currentTime = 0;
    audio.play().catch(() => {});
  } else goNext(true);
});
audio.addEventListener("loadedmetadata", () => {
  $("t-dur").textContent = fmt(audio.duration);
  if (queue[index]) setDuration(queue[index], audio.duration);
  if (resumeAt > 0 && audio.duration > resumeAt + 2) audio.currentTime = resumeAt;
  resumeAt = 0;
});
audio.addEventListener("timeupdate", () => {
  $("t-cur").textContent = fmt(audio.currentTime);
  if (!dragging && audio.duration)
    seek.value = (audio.currentTime / audio.duration) * 100;
  if (!counted && queue[index]) {
    // dihitung sebagai satu kali putar setelah didengarkan beberapa detik
    const need = isFinite(audio.duration) ? Math.min(20, audio.duration * 0.5) : 20;
    if (audio.currentTime >= need) {
      counted = true;
      addPlay(queue[index]);
    }
  }
  if (performance.now() - lastSave > 5000) saveLast();
});

seek.addEventListener("pointerdown", () => {
  dragging = true;
});
seek.addEventListener("pointerup", () => {
  dragging = false;
});
seek.addEventListener("input", () => {
  if (audio.duration) audio.currentTime = (seek.value / 100) * audio.duration;
});
audio.addEventListener("error", () => {
  if (!audio.getAttribute("src")) return;
  emit("toast", {
    title: "Music",
    message: `Could not load "${getTrack(queue[index])?.title ?? "track"}"`,
    type: "error",
  });
});

function autoplay() {
  audio.play().catch(() => {
    // diblokir browser: mulai di interaksi pertama
    const ac = new AbortController();
    const start = () => {
      ac.abort();
      audio.play().catch(() => {});
    };
    for (const ev of ["click", "keydown"])
      window.addEventListener(ev, start, { signal: ac.signal });
  });
}

// ---- ingat lagu terakhir ----
function saveLast() {
  lastSave = performance.now();
  if (index < 0 || !queue[index]) {
    try {
      localStorage.removeItem("lib:last");
    } catch {}
    return;
  }
  const lib = libraryTracks();
  const isAll = queue.length === lib.length && queue.every((id, i) => id === lib[i].id);
  savePref("lib:last", {
    id: queue[index],
    t: Math.floor(audio.currentTime) || 0,
    playing: !audio.paused,
    ...(isAll ? { all: true } : { queue: queue.slice(0, 500) }),
  });
}
window.addEventListener("pagehide", saveLast);

// daftar lagu siap: pulihkan antrean dan lagu terakhir, lalu coba putar otomatis seperti sebelumnya
on("library:ready", () => {
  if (queue.length) return;
  const saved = pref("lib:last", null);
  const everything = libraryTracks().map((t) => t.id);
  queue = saved && Array.isArray(saved.queue) ? saved.queue.filter(valid) : [];
  if (!queue.length) queue = everything;
  if (!queue.length) return;
  const at = saved?.id ? Math.max(0, queue.indexOf(saved.id)) : 0;
  const same = saved && queue[at] === saved.id;
  load(at, false); // tanpa memutar dulu
  resumeAt = same && saved.t > 3 ? saved.t : 0;
  if (!saved || saved.playing !== false) autoplay(); // dulu memutar: coba lanjutkan, kalau jeda biarkan jeda
});
loadLibrary();

let ctx, analyser, data;

// ---- equalizer ----
export const EQ_BANDS = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]; // Hz
export const EQ_PRESETS = {
  //         31  63 125 250 500  1k  2k  4k  8k 16k
  Flat:    [ 0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
  Bass:    [ 6,  5,  4,  2,  0,  0,  0,  0,  0,  0],
  Treble:  [ 0,  0,  0,  0,  0,  1,  2,  4,  5,  6],
  Vocal:   [-3, -2, -1,  1,  3,  4,  3,  2,  0, -1],
  Pop:     [-2,  1,  3,  4,  3,  0, -1, -1,  1,  2],
  Rock:    [ 5,  4,  2,  0, -1, -1,  2,  4,  5,  6],
  Jazz:    [ 3,  2,  1,  2, -2, -2,  0,  1,  2,  3],
  Classic: [ 3,  3,  2,  1,  0,  0, -1, -1,  1,  2],
};

const clampDb = (v) => Math.min(12, Math.max(-12, Math.round(Number(v) || 0)));
let eqGains = (() => {
  const g = pref("eq:gains", null);
  return Array.isArray(g) && g.length === EQ_BANDS.length ? g.map(clampDb) : EQ_PRESETS.Flat.slice();
})();
let eqOn = true; // tombol aktif/mati sudah tidak ada; "Flat" = tanpa efek
let eqPre = null; // pengurang volume otomatis supaya boost tidak membuat suara pecah
let eqNodes = [];

function buildEq(source) {
  eqPre = ctx.createGain();
  eqNodes = EQ_BANDS.map((f) => {
    const n = ctx.createBiquadFilter();
    n.type = "peaking";
    n.frequency.value = f;
    n.Q.value = 1.4; // band berjarak satu oktaf
    return n;
  });
  let prev = source; // source → preamp → 8 filter → analyser
  for (const n of [eqPre, ...eqNodes, analyser]) {
    prev.connect(n);
    prev = n;
  }
  applyEq();
}

function applyEq() {
  if (!ctx) return; // belum tersambung: nilainya dipakai saat setupAnalyser jalan
  const t = ctx.currentTime;
  const g = eqOn ? eqGains : eqGains.map(() => 0); // "mati" = semua band 0 dB
  const boost = Math.max(0, ...g);
  eqNodes.forEach((n, i) => n.gain.setTargetAtTime(g[i], t, 0.02)); // halus, tanpa bunyi "klik"
  eqPre.gain.setTargetAtTime(10 ** (-boost / 20), t, 0.02);
}

function commitEq() {
  eqOn = true; // menggeser slider atau memilih preset otomatis menyalakan EQ
  savePref("eq:on", true);
  savePref("eq:gains", eqGains);
  applyEq();
  emit("audio:eq");
}

export const getEq = () => ({ on: eqOn, gains: eqGains.slice() });
export function setEqBand(i, db) {
  if (i < 0 || i >= EQ_BANDS.length) return;
  eqGains[i] = clampDb(db);
  commitEq();
}
export function setEqGains(arr) {
  if (!Array.isArray(arr) || arr.length !== EQ_BANDS.length) return;
  eqGains = arr.map(clampDb);
  commitEq();
}
export function setEqOn(v) {
  eqOn = !!v;
  savePref("eq:on", eqOn);
  applyEq();
  emit("audio:eq");
}

function setupAnalyser() {
  if (ctx) return; // createMediaElementSource hanya boleh dipanggil sekali per elemen
  ctx = new AudioContext();
  const source = ctx.createMediaElementSource(audio);
  analyser = ctx.createAnalyser();
  analyser.fftSize = 1024; // resolusi lebih halus, terutama untuk bass
  analyser.smoothingTimeConstant = 0.72; // sedikit lebih responsif
  gainNode = ctx.createGain(); // volume dipindah ke sini supaya visual tidak ikut mengecil
  gainNode.gain.value = volume;
  audio.volume = 1;
    buildEq(source);
  analyser.connect(gainNode);
  gainNode.connect(ctx.destination); // tanpa ini suaranya hilang
  data = new Uint8Array(analyser.frequencyBinCount);
  emit("audio:ready");
}

const canvas = $("viz"),
  g = canvas.getContext("2d");
const coverEl = $("cover");
const HALF = 34; // 68 batang, simetris kiri-kanan, bass di bawah
const vals = new Float32Array(HALF);
const lv = new Float32Array(HALF);
const pk = new Float32Array(HALF);
let raf = 0,
  alive = 0, // sisa energi visual: loop berhenti setelah padam
  lastT = 0,
  ceiling = 0.5; // pelacak amplitudo untuk penyesuaian otomatis

const readHue = () => {
  const m = /hsl\(\s*([\d.]+)/.exec(
    getComputedStyle(document.documentElement).getPropertyValue("--primary"),
  );
  return m ? Number(m[1]) : 270;
};
let hue = readHue();
on("theme:changed", () => {
  hue = readHue();
});

const shouldRun = () =>
  analyser &&
  state.panelOpen &&
  state.activeTab === "media" &&
  (!audio.paused || alive > 0.02);
function kick() {
  if (!raf && shouldRun()) raf = requestAnimationFrame(draw);
}

function draw(now) {
  raf = 0;
  const dt = Math.min(0.05, lastT ? (now - lastT) / 1000 : 0.016);
  lastT = now;

  const spec = audio.paused ? null : getSpectrum();
  const sr = sampleRate();
  const b = readBands(spec, sr, now);
  logBars(spec, sr, vals);

  // penyesuaian otomatis: lagu pelan tetap hidup, lagu keras tidak mentok
  let top = 0;
  for (const v of vals) top = Math.max(top, v);
  ceiling = Math.max(0.35, ceiling * (1 - dt * 0.2), top);
  const gain = 0.95 / ceiling;

  const W = canvas.width,
    c = W / 2;
  const r1 = 106 + b.beat * 3;
  g.clearRect(0, 0, W, W);
  g.lineCap = "round";
  g.lineWidth = 4;
  g.shadowColor = `hsl(${hue}, 90%, 65%)`;
  g.shadowBlur = b.beat > 0.15 ? 6 + b.beat * 20 : 0; // bersinar saat ada dentuman

  let energy = b.level;
  for (let j = 0; j < HALF; j++) {
    const target = Math.min(1, vals[j] * gain);
    lv[j] = target > lv[j] ? lv[j] + (target - lv[j]) * 0.6 : Math.max(0, lv[j] - dt * 1.4);
    pk[j] = Math.max(lv[j], pk[j] - dt * 0.5); // penanda puncak yang jatuh pelan
    energy += lv[j] + pk[j];
    if (lv[j] < 0.01 && pk[j] < 0.04) continue;

    const t = j / (HALF - 1); // 0 = bass (bawah), 1 = treble (atas)
    const len = 3 + lv[j] * (30 + b.beat * 14);
    const capR = r1 + 4 + pk[j] * (30 + b.beat * 14);
    const col = (hue + t * 70) % 360; // warna bergeser sepanjang lingkaran
    for (const dir of [1, -1]) {
      const a = Math.PI / 2 + dir * (0.03 + t * 0.94 * Math.PI);
      const cos = Math.cos(a),
        sin = Math.sin(a);
      g.strokeStyle = `hsl(${col}, 85%, ${58 + lv[j] * 22}%)`;
      g.beginPath();
      g.moveTo(c + cos * r1, c + sin * r1);
      g.lineTo(c + cos * (r1 + len), c + sin * (r1 + len));
      g.stroke();
      if (pk[j] > 0.04) {
        g.fillStyle = `hsl(${col}, 95%, 85%)`;
        g.beginPath();
        g.arc(c + cos * capR, c + sin * capR, 2, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  // cincin tipis yang berdenyut mengikuti bass
  g.shadowBlur = 0;
  g.lineWidth = 1.5 + b.bass * 3;
  g.strokeStyle = `hsla(${hue}, 90%, 70%, ${Math.min(1, b.level * 1.5) * 0.35 + b.beat * 0.4})`;
  g.beginPath();
  g.arc(c, c, r1 - 2.5, 0, Math.PI * 2);
  g.stroke();

  coverEl.style.scale = String(1 + b.bass * 0.035 + b.beat * 0.035); // cover ikut berdenyut
  alive = energy;
  kick(); // jadwalkan frame berikutnya hanya kalau masih perlu
  if (!raf) coverEl.style.scale = "";
}

function connectAnalyser() {
  setupAnalyser();
  ctx.resume();
  kick();
}

audio.addEventListener("play", () => {
  if (navigator.userActivation?.hasBeenActive) connectAnalyser();
});

// kalau autoplay lolos tanpa interaksi, sambungkan visualizer di klik pertama
window.addEventListener(
  "click",
  () => {
    if (!audio.paused) connectAnalyser();
  },
  { once: true },
);
on("state:panelOpen", kick);
on("state:activeTab", kick);

export const isPlaying = () => !audio.paused;
export const nextTrack = () => goNext(false);
export const prevTrack = goPrev;
export const currentTrack = () => getTrack(queue[index]) ?? null;
export const sampleRate = () => ctx?.sampleRate ?? 44100;

let spectrum;
export function getSpectrum() {
  if (!analyser) return null;                 // belum tersambung (menunggu interaksi pertama)
  spectrum ??= new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(spectrum);
  return spectrum;
}
