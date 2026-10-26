// Efek petir EQ: garis cahaya yang mengalir seperti air, menyambung semua pegangan slider.
const PAD_X = 8; // ruang ekstra kiri/kanan kanvas (px), samakan dengan CSS .eq-bolt
const PAD_Y = 16; // ruang ekstra atas/bawah (px), samakan dengan CSS .eq-bolt

const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const lighten = (c, k) => c.map((v) => v + (255 - v) * k);
const clamp01 = (v) => Math.min(1, Math.max(0, v));

// gelombang yang merambat ke kanan: tiga sinus dengan panjang dan kecepatan berbeda
const wave = (x, t) =>
  Math.sin(x * 0.085 - t * 2.6) * 0.55 +
  Math.sin(x * 0.16 - t * 4.1 + 1.7) * 0.3 +
  Math.sin(x * 0.04 - t * 1.3 + 4.2) * 0.35;

// kurva Catmull-Rom: halus dan melewati setiap titik
const catmull = (p0, p1, p2, p3, u) => {
  const u2 = u * u;
  const u3 = u2 * u;
  return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
};

export function attachBolt({ bands, sliders }) {
  const canvas = document.createElement("canvas");
  canvas.className = "eq-bolt";
  canvas.setAttribute("aria-hidden", "true");
  bands.prepend(canvas); // di belakang slider, jadi pegangan tetap tampil di atas garis
  const ctx = canvas.getContext("2d");
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  const thumbs = sliders.map((s) => s.querySelector(".eq-thumb"));

  let gains = null; // nilai dB terakhir (hanya untuk mendeteksi perubahan)
  let w = 0;
  let hgt = 0;
  let rgb = [200, 210, 140]; // diganti warna tema oleh readColor()
  let dragging = false;
  let active = -1; // band yang sedang disentuh / terakhir berubah
  let surgeUntil = 0; // sampai kapan aliran "menyala terang"
  let energy = 0.35; // 0.35 = tenang, 1 = deras (dihaluskan, tidak melompat)
  const orb = { x: 0, y: 0, a: 0 }; // cahaya di pegangan aktif
  let raf = 0;
  let last = 0;
  let tick = 0;
  let visible = false;
    const SWEEP = 1.0; // detik: lama petir merambat dari kiri ke kanan
  let reveal = 1; // 0 = belum muncul, 1 = sudah sampai ujung kanan
  let revealStart = 0;

  function readColor() {
    const s = getComputedStyle(canvas).color;
    const n = (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    if (n.length === 3) rgb = n.map((v) => (s.startsWith("color(") ? v * 255 : v));
  }

    const ease = (p) => 0.5 - 0.5 * Math.cos(Math.PI * p);

  // potong garis di x = fx (ujung petir yang sedang tumbuh)
  function upTo(pts, fx) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      if (pts[i][0] <= fx) {
        out.push(pts[i]);
      } else {
        if (i && pts[i - 1][0] < fx) {
          const [xa, ya] = pts[i - 1];
          const [xb, yb] = pts[i];
          out.push([fx, ya + ((yb - ya) * (fx - xa)) / (xb - xa)]);
        }
        break;
      }
    }
    return out;
  }

  // petir muncul lagi dari awal (kiri) lalu merambat ke ujung kanan
  function replay() {
    if (still.matches) return;
    reveal = 0;
    revealStart = performance.now();
    run();
  }

  function layout() {
    const dpr = window.devicePixelRatio || 1;
    w = bands.clientWidth + PAD_X * 2;
    hgt = bands.clientHeight + PAD_Y * 2;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(hgt * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    readColor();
    draw(performance.now(), 0);
  }

  // posisi pegangan yang sebenarnya, dibaca dari layar tiap frame,
  // jadi garis selalu menempel, juga saat pegangan meluncur (transisi CSS)
  function anchors() {
    const cr = canvas.getBoundingClientRect();
    if (!cr.width) return null;
    return thumbs.map((t) => {
      const r = t.getBoundingClientRect();
      return [r.left + r.width / 2 - cr.left, r.top + r.height / 2 - cr.top];
    });
  }

  // kurva halus lewat semua pegangan + gelombang mengalir di atasnya
  function curve(P, amp, t) {
    const n = P.length;
    const pts = [];
    for (let i = 0; i < n - 1; i++) {
      const [x0, y0] = P[i];
      const [x1, y1] = P[i + 1];
      const ya = P[Math.max(0, i - 1)][1];
      const yd = P[Math.min(n - 1, i + 2)][1];
      const steps = Math.max(6, Math.round((x1 - x0) / 4));
      for (let s = 0; s < steps; s++) {
        const u = s / steps;
        const x = x0 + (x1 - x0) * u;
        const k = Math.sin(Math.PI * u); // 0 di pegangan: garis selalu lewat tepat di pegangan
        pts.push([x, catmull(ya, y0, y1, yd, u) + amp * k * wave(x, t)]);
      }
    }
    pts.push(P[n - 1]);
    return pts;
  }

  function stroke(pts, width, style, blur = 0) {
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) ctx[i ? "lineTo" : "moveTo"](pts[i][0], pts[i][1]);
    ctx.lineWidth = width;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = style;
    ctx.shadowBlur = blur;
    ctx.shadowColor = rgba(rgb, 0.9);
    ctx.stroke();
  }

  function draw(now, dt) {
    ctx.clearRect(0, 0, w, hgt);
    const P = gains && anchors();
    if (!P) return;
    const t = now / 1000;
    const calm = still.matches; // "kurangi gerakan": garis diam
    const light = lighten(rgb, 0.45);

        // ujung petir yang sedang tumbuh dari kiri ke kanan
    const fx = P[0][0] + (P[P.length - 1][0] - P[0][0]) * ease(reveal);

    // cahaya di pegangan aktif: bergeser dan memudar halus
    if (active >= 0 && P[active]) {
      if (orb.a < 0.02) {
        orb.x = P[active][0];
        orb.y = P[active][1];
      } else {
        const k = dt ? 1 - Math.exp(-dt * 20) : 1;
        orb.x += (P[active][0] - orb.x) * k;
        orb.y += (P[active][1] - orb.y) * k;
      }
    }
    if (orb.a > 0.01) {
      const r = 26 + 3 * Math.sin(t * 7);
      const gr = ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, r);
      gr.addColorStop(0, rgba(light, 0.6 * orb.a));
      gr.addColorStop(0.45, rgba(rgb, 0.22 * orb.a));
      gr.addColorStop(1, rgba(rgb, 0));
      ctx.shadowBlur = 0;
      ctx.fillStyle = gr;
      ctx.fillRect(orb.x - r, orb.y - r, r * 2, r * 2);
    }

    const amp = calm ? 0 : 2 + 5 * energy;
        const main = upTo(curve(P, amp, t), fx);

    // lapisan cahaya lembut: makin tebal makin samar
    stroke(main, 9, rgba(rgb, 0.1));
    stroke(main, 4.5, rgba(rgb, 0.2));
    // riak tipis yang mengalir sedikit berbeda fase
        if (!calm) stroke(upTo(curve(P, amp * 1.5, t + 1.6), fx), 1, rgba(light, 0.35));
    // inti terang dengan kilau yang mengalir ke kanan
    const base = rgba(light, 0.55);
    const peak = rgba(light, 1);
    const p = calm ? -1 : (t / 3.2) % 1.5 - 0.25;
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, base);
    g.addColorStop(clamp01(p - 0.2), base);
    g.addColorStop(clamp01(p), peak);
    g.addColorStop(clamp01(p + 0.2), base);
    g.addColorStop(1, base);
    stroke(main, 1.6, g, 8 + 6 * energy);

        // kepala petir: cahaya terang di ujung yang sedang merambat
    if (reveal < 1 && main.length) {
      const [hx, hy] = main[main.length - 1];
      const a = Math.min(1, (1 - reveal) * 6); // memudar di ujung perjalanan
      const r = 20;
      const hg = ctx.createRadialGradient(hx, hy, 0, hx, hy, r);
      hg.addColorStop(0, rgba(light, 0.9 * a));
      hg.addColorStop(0.4, rgba(rgb, 0.3 * a));
      hg.addColorStop(1, rgba(rgb, 0));
      ctx.shadowBlur = 0;
      ctx.fillStyle = hg;
      ctx.fillRect(hx - r, hy - r, r * 2, r * 2);
    }

    ctx.shadowBlur = 0;
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
        if (reveal < 1) reveal = Math.min(1, (now - revealStart) / (SWEEP * 1000));
    const hot = dragging || now < surgeUntil || reveal < 1;
    // semua perubahan dihaluskan dengan easing, tidak ada yang melompat
    energy += ((dragging ? 1 : hot ? 0.8 : 0.35) - energy) * (1 - Math.exp(-dt * 5));
    orb.a += ((hot && active >= 0 ? 1 : 0) - orb.a) * (1 - Math.exp(-dt * 8));
    if (++tick % 60 === 0) readColor(); // ikuti pergantian tema
    draw(now, dt);
  }

  // animasi hanya jalan saat EQ benar-benar terlihat
  function run() {
    const should = visible && !document.hidden && !still.matches && gains;
    if (should && !raf) {
      last = performance.now();
      raf = requestAnimationFrame(loop);
    } else if (!should && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }

  // dipanggil eq.js setiap nilai berubah
  function set(g) {
    if (gains) {
      const changed = g.map((v, i) => (v !== gains[i] ? i : -1)).filter((i) => i >= 0);
      if (changed.length) {
        active = changed.length === 1 ? changed[0] : -1; // preset mengubah banyak band: tanpa cahaya tunggal
        surgeUntil = performance.now() + 700;
      }
    }
    gains = g.slice();
    if (!raf) draw(performance.now(), 0);
    run();
  }

  // deteksi slider yang disentuh (event dari slider naik ke bands)
  const idx = (e) => sliders.indexOf(e.target.closest?.(".eq-vs"));
  bands.addEventListener("pointerdown", (e) => {
    const i = idx(e);
    if (i >= 0) {
      dragging = true;
      active = i;
    }
  });
  bands.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const i = idx(e);
    if (i >= 0) active = i;
  });
    const end = () => {
    if (dragging) replay(); // slider dilepas: petir muncul lagi dari awal
    dragging = false;
    surgeUntil = performance.now() + 500;
  };
  bands.addEventListener("pointerup", end);
  bands.addEventListener("pointercancel", end);

  new ResizeObserver(layout).observe(bands);
    new IntersectionObserver(([e]) => {
    const was = visible;
    visible = e.isIntersecting;
    if (visible && !was) replay(); // panel EQ baru terbuka
    run();
  }).observe(bands);
  document.addEventListener("visibilitychange", run);
  still.addEventListener("change", () => {
    run();
    draw(performance.now(), 0);
  });

    return { set, replay };
}