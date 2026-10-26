import { state, on } from "../core/state.js";
import { isPlaying, getSpectrum, sampleRate } from "../music/audio.js";
import { readBands, logBars } from "../music/bands.js";

const canvas = document.getElementById("wave");
const g = canvas.getContext("2d");
const layer = document.getElementById("wd-layer");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const readColor = () =>
  getComputedStyle(document.documentElement)
    .getPropertyValue("--primary")
    .trim() || "#cba6f7";
const readHue = () => {
  const m = /hsl\(\s*([\d.]+)/.exec(readColor());
  return m ? Number(m[1]) : 270;
};
const rand = (a, b) => a + Math.random() * (b - a);

let color = readColor();
let baseHue = readHue();
let levels = new Float32Array(0);
let peaks = new Float32Array(0);
let vals = new Float32Array(0);
let sparks = [];
let ceiling = 0.5; // pelacak amplitudo untuk penyesuaian otomatis
let raf = 0,
  clearTimer,
  lastT = 0;

const wanted = () =>
  !state.off &&
  ((state.panelOpen && state.activeTab === "media") ||
    state.widgets.some((w) => w.type === "disc"));
const needsLoop = () =>
  wanted() &&
  (isPlaying() ||
    levels.some((v) => v > 0.01) ||
    peaks.some((v) => v > 0.04) ||
    sparks.length > 0);

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return dpr;
}

function draw(now) {
  raf = 0;
  const dpr = resize();
  const W = canvas.width,
    H = canvas.height;
  const dt = Math.min(0.05, lastT ? (now - lastT) / 1000 : 0.016);
  lastT = now;

  const half = Math.max(12, Math.min(48, Math.floor(canvas.clientWidth / 40)));
  if (levels.length !== half) {
    levels = new Float32Array(half);
    peaks = new Float32Array(half);
    vals = new Float32Array(half);
  }

  const spec = isPlaying() ? getSpectrum() : null;
  const sr = sampleRate();
  const b = readBands(spec, sr, now);
  logBars(spec, sr, vals);

  // penyesuaian otomatis: lagu pelan tetap hidup, lagu keras tidak mentok
  let top = 0;
  for (let i = 0; i < half; i++) top = Math.max(top, vals[i]);
  ceiling = Math.max(0.35, ceiling * (1 - dt * 0.2), top);
  const gain = 0.95 / ceiling;
  const act = Math.min(1, b.level * 1.6 + b.beat); // 0 saat hening: semua lapisan ikut padam

  const gap = 3 * dpr;
  const slots = half * 2;
  const barW = (W - gap * (slots - 1)) / slots;
  const step = barW + gap;
  const cx = W / 2;
  const hMax = H * 0.95;
  const heights = new Float32Array(half);

  g.globalCompositeOperation = "source-over";
  g.globalAlpha = 1;
  g.clearRect(0, 0, W, H);

  // 1) batang simetris dari tengah (bass di tengah, treble di tepi), gradasi warna ke samping
  const hg = g.createLinearGradient(0, 0, W, 0);
  hg.addColorStop(0, `hsl(${(baseHue + 70) % 360}, 85%, 66%)`);
  hg.addColorStop(0.5, `hsl(${baseHue}, 90%, 72%)`);
  hg.addColorStop(1, `hsl(${(baseHue + 70) % 360}, 85%, 66%)`);
  g.fillStyle = hg;

  for (let j = 0; j < half; j++) {
    const target = Math.min(1, vals[j] * gain);
    levels[j] =
      target > levels[j]
        ? levels[j] + (target - levels[j]) * 0.65
        : Math.max(0, levels[j] - dt * 1.5); // naik cepat, turun pelan
    peaks[j] = Math.max(levels[j], peaks[j] - dt * 0.45); // penanda puncak yang jatuh pelan
    heights[j] = Math.min(hMax, levels[j] * hMax * (1 + b.beat * 0.12));
    if (levels[j] < 0.01) continue;
    const bh = Math.max(3 * dpr, heights[j]);
    for (const dir of [-1, 1]) {
      const x = cx + dir * (j + 0.5) * step - barW / 2;
      g.beginPath();
      if (g.roundRect(x, H - bh, barW, bh, barW / 2));
      else g.rect(x, H - bh, barW, bh);
      g.fill();
    }
  }

  // memudar ke atas: bagian bawah pekat, ujung atas tipis
  g.globalCompositeOperation = "destination-in";
  const vg = g.createLinearGradient(0, H, 0, 0);
  vg.addColorStop(0, "rgba(0,0,0,0.9)");
  vg.addColorStop(1, "rgba(0,0,0,0.25)");
  g.fillStyle = vg;
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = "source-over";

  // 2) cahaya dari dasar layar yang menyala saat dentuman
  const glow = g.createLinearGradient(0, H, 0, H * 0.35);
  glow.addColorStop(
    0,
    `hsla(${baseHue}, 90%, 70%, ${(0.08 + b.bass * 0.18 + b.beat * 0.3) * act})`,
  );
  glow.addColorStop(1, `hsla(${baseHue}, 90%, 70%, 0)`);
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);

  // 3) penanda puncak
  g.fillStyle = `hsl(${baseHue}, 95%, 85%)`;
  g.globalAlpha = 0.9;
  for (let j = 0; j < half; j++) {
    if (peaks[j] < 0.04) continue;
    const y =
      H - Math.min(hMax, peaks[j] * hMax * (1 + b.beat * 0.12)) - 7 * dpr;
    for (const dir of [-1, 1]) {
      const x = cx + dir * (j + 0.5) * step - barW / 2;
      g.beginPath();
      if (g.roundRect) g.roundRect(x, y, barW, 3 * dpr, 1.5 * dpr);
      else g.rect(x, y, barW, 3 * dpr);
      g.fill();
    }
  }
  g.globalAlpha = 1;

  // 4) garis lengkung yang menghubungkan ujung batang
  const pts = [];
  for (let j = half - 1; j >= 0; j--)
    pts.push([cx - (j + 0.5) * step, H - Math.max(0, heights[j])]);
  for (let j = 0; j < half; j++)
    pts.push([cx + (j + 0.5) * step, H - Math.max(0, heights[j])]);
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) {
    g.quadraticCurveTo(
      pts[i][0],
      pts[i][1],
      (pts[i][0] + pts[i + 1][0]) / 2,
      (pts[i][1] + pts[i + 1][1]) / 2,
    );
  }
  g.lineTo(pts.at(-1)[0], pts.at(-1)[1]);
  g.lineWidth = 2 * dpr;
  g.strokeStyle = `hsla(${baseHue}, 95%, 80%, ${0.55 * act})`;
  g.stroke();

  // 5) percikan yang melompat dari ujung batang bass saat dentuman
  if (b.kick && !still.matches) {
    const n = 4 + Math.floor(b.bass * 8);
    for (let i = 0; i < n && sparks.length < 90; i++) {
      const j = Math.floor(rand(0, Math.min(half, 10)));
      const dir = Math.random() < 0.5 ? -1 : 1;
      sparks.push({
        x: cx + dir * (j + 0.5) * step,
        y: H - heights[j],
        vx: rand(-60, 60) * dpr,
        vy: -rand(120, 320) * dpr,
        life: 1,
        size: rand(1.5, 3.2) * dpr,
      });
    }
  }
  sparks = sparks.filter((p) => {
    p.life -= dt * 1.1;
    p.vy += 260 * dpr * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    return p.life > 0 && p.y < H;
  });
  g.fillStyle = `hsl(${(baseHue + 30) % 360}, 95%, 85%)`;
  for (const p of sparks) {
    g.globalAlpha = Math.max(0, p.life);
    g.beginPath();
    g.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;

  // disc widget ikut berdenyut lewat variabel CSS (lihat components.css)
  layer.style.setProperty("--bass", still.matches ? 0 : b.bass.toFixed(3));
  layer.style.setProperty("--beat", still.matches ? 0 : b.beat.toFixed(3));

  if (needsLoop())
    raf = requestAnimationFrame(draw); // lanjut hanya kalau masih perlu
  else {
    layer.style.setProperty("--bass", 0);
    layer.style.setProperty("--beat", 0);
  }
}

function kick() {
  if (!raf && needsLoop()) raf = requestAnimationFrame(draw);
}

function sync() {
  const show = wanted();
  canvas.classList.toggle("on", show);
  kick();
  clearTimeout(clearTimer);
  if (!show) {
    clearTimer = setTimeout(() => {
      // setelah memudar, bersihkan kanvasnya
      levels.fill(0);
      peaks.fill(0);
      sparks = [];
      g.clearRect(0, 0, canvas.width, canvas.height);
    }, 500);
  }
}

[
  "state:panelOpen",
  "state:activeTab",
  "state:widgets",
  "state:off",
  "audio:play",
  "audio:ready",
].forEach((ev) => on(ev, sync));
on("theme:changed", () => { color = readColor(); baseHue = readHue(); });

sync();
