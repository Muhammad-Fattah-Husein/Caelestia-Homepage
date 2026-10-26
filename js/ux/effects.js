import { state, on } from "../core/state.js";
import { motionReduced } from "../core/prefs.js";

const canvas = document.getElementById("fx");
const g = canvas.getContext("2d");
const readColor = () =>
  getComputedStyle(document.documentElement).getPropertyValue("--primary").trim() || "#cba6f7";
let color = readColor();
const rand = (a, b) => a + Math.random() * (b - a);

// cahaya kunang-kunang digambar sekali ke kanvas kecil, lalu dipakai ulang (jauh lebih ringan daripada shadowBlur)
const glow = (() => {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d");
  const grad = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,244,160,1)");
  grad.addColorStop(0.25, "rgba(255,230,120,.5)");
  grad.addColorStop(1, "rgba(255,230,120,0)");
  x.fillStyle = grad;
  x.fillRect(0, 0, 64, 64);
  return c;
})();

// nama kunci = jenis widget di widgetdefs.js
const EFFECTS = {
  rain: {
    count: () => Math.min(180, Math.floor(innerWidth / 8)),
    make: () => ({ x: rand(0, innerWidth), y: rand(0, innerHeight), len: rand(10, 24), v: rand(540, 1080) }),
    step(p, dt) {
      p.y += p.v * dt;
      p.x -= p.v * 0.15 * dt;
      if (p.y > innerHeight) { p.y = -p.len; p.x = rand(0, innerWidth); }
    },
    draw(ps) {
      g.globalAlpha = 0.4;
      g.strokeStyle = color;
      g.lineWidth = 1.2;
      g.beginPath();
      for (const p of ps) { g.moveTo(p.x, p.y); g.lineTo(p.x - p.len * 0.15, p.y + p.len); }
      g.stroke();
    },
  },
  snow: {
    count: () => Math.min(140, Math.floor(innerWidth / 10)),
    make: () => ({ x: rand(0, innerWidth), y: rand(0, innerHeight), r: rand(1, 3.2), v: rand(30, 80), ph: rand(0, 6.28), amp: rand(10, 30) }),
    step(p, dt, t) {
      p.y += p.v * dt;
      p.x += Math.sin(t + p.ph) * p.amp * dt;
      if (p.y > innerHeight + 5) { p.y = -5; p.x = rand(0, innerWidth); }
    },
    draw(ps) {
      g.globalAlpha = 0.8;
      g.fillStyle = "#fff";
      g.beginPath();
      for (const p of ps) { g.moveTo(p.x + p.r, p.y); g.arc(p.x, p.y, p.r, 0, Math.PI * 2); }
      g.fill();
    },
  },
  fireflies: {
    count: () => Math.min(40, Math.floor(innerWidth / 40)),
    make: () => ({ x: rand(0, innerWidth), y: rand(0, innerHeight), a: rand(0, 6.28), s: rand(8, 22), size: rand(14, 34), ph: rand(0, 6.28), sp: rand(0.8, 1.8) }),
    step(p, dt) {
      p.a += rand(-1.2, 1.2) * dt;
      p.x += Math.cos(p.a) * p.s * dt;
      p.y += Math.sin(p.a) * p.s * dt;
      if (p.x < -20) p.x = innerWidth + 20; else if (p.x > innerWidth + 20) p.x = -20;
      if (p.y < -20) p.y = innerHeight + 20; else if (p.y > innerHeight + 20) p.y = -20;
    },
    draw(ps, t) {
      for (const p of ps) {
        g.globalAlpha = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * p.sp + p.ph));   // berkedip pelan
        g.drawImage(glow, p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
    },
  },
};

let confetti = [];
on("confetti", ({ x, y }) => {
  if (motionReduced()|| state.off) return;
  for (let i = 0; i < 70; i++) {
    const a = rand(-Math.PI * 0.95, -Math.PI * 0.05);   // menyembur ke atas
    const v = rand(250, 620);
    confetti.push({
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      w: rand(5, 9), h: rand(3, 6), rot: rand(0, 6.28), vr: rand(-8, 8),
      hue: rand(0, 360), life: rand(1.6, 2.6), age: 0,
    });
  }
  kick();
});

let raf = 0, last = 0;
const sets = {};
const activeNames = () =>
  state.off || motionReduced()? [] : Object.keys(EFFECTS).filter((k) => state.widgets.some((w) => w.type === k));

function frame(now) {
  raf = 0;
  const t = now / 1000;
  const dt = Math.min(0.05, last ? t - last : 0.016);
  last = t;
  g.clearRect(0, 0, canvas.width, canvas.height);

  const active = activeNames();
  for (const k of Object.keys(sets)) if (!active.includes(k)) delete sets[k];
  for (const k of active) {
    const fx = EFFECTS[k];
    const ps = (sets[k] ||= []);
    const n = fx.count();
    while (ps.length < n) ps.push(fx.make());
    ps.length = Math.min(ps.length, n);
    for (const p of ps) fx.step(p, dt, t);
    g.save();
    fx.draw(ps, t);
    g.restore();
  }

  if (confetti.length) {
    confetti = confetti.filter((p) => (p.age += dt) < p.life);
    for (const p of confetti) {
      p.vy += 900 * dt;
      p.vx *= 1 - 1.2 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      g.save();
      g.globalAlpha = Math.min(1, (p.life - p.age) * 2);
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      g.fillStyle = `hsl(${p.hue} 85% 62%)`;
      g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      g.restore();
    }
  }

  if (active.length || confetti.length) raf = requestAnimationFrame(frame);
  else last = 0;
}

function kick() { if (!raf) raf = requestAnimationFrame(frame); }

function resize() {
  canvas.width = innerWidth;
  canvas.height = innerHeight;
  for (const k of Object.keys(sets)) delete sets[k];   // sebar ulang partikel sesuai ukuran baru
}

["state:widgets", "state:off"].forEach((ev) => on(ev, kick));
on("theme:changed", () => { color = readColor(); });
on("motion:changed", kick);
addEventListener("resize", resize);
resize();
kick();