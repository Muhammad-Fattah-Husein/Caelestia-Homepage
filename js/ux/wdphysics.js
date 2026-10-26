import { Spring, PRESETS } from "./spring.js";
import { motionReduced } from "../core/prefs.js";

// Satu pengendali per widget. Posisi "resmi" widget tetap di left/top; gerakan pegas hanya
// menambah selisih lewat properti translate, rotate, dan scale (tidak mengganggu transform bawaan).
const live = new Set();   // pengendali yang masih bergerak
let raf = 0, last = 0;

function frame(now) {
  raf = 0;
  const dt = Math.min(0.032, last ? (now - last) / 1000 : 0.016);
  last = now;
  for (const b of live) if (b.update(dt)) live.delete(b);
  if (live.size) raf = requestAnimationFrame(frame);
  else last = 0;
}
function kick(b) {
  live.add(b);
  if (!raf) raf = requestAnimationFrame(frame);
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export function physics(el) {
  const x = new Spring(0, PRESETS.follow);
  const y = new Spring(0, PRESETS.follow);
  const rot = new Spring(0, PRESETS.tilt);
  const sc = new Spring(1, PRESETS.lift);
  let dragging = false;

  function apply(rest) {
    if (rest) {   // diam di posisi akhir: lepaskan semua gaya supaya tidak membebani render
      el.style.translate = el.style.rotate = el.style.scale = "";
      return;
    }
    el.style.translate = `${x.value.toFixed(2)}px ${y.value.toFixed(2)}px`;
    el.style.rotate = `${rot.value.toFixed(2)}deg`;
    el.style.scale = sc.value.toFixed(3);
  }

  const b = {
    // widget diangkat: sedikit membesar
    grab() {
      dragging = true;
      x.config(PRESETS.follow);
      y.config(PRESETS.follow);
      if (!motionReduced()) { sc.to(1.06); kick(b); }
    },
    // tujuan baru: selisih (piksel) dari posisi resmi
    follow(tx, ty) {
      if (motionReduced()) { x.snap(tx); y.snap(ty); apply(false); return; }
      x.to(tx);
      y.to(ty);
      kick(b);
    },
    offset: () => ({ x: x.value, y: y.value }),
    // dilepas: posisi resmi sudah pindah ke tujuan, jadi sisa selisih diluncurkan ke 0
    release(off) {
      dragging = false;
      if (motionReduced()) { x.snap(0); y.snap(0); rot.snap(0); sc.snap(1); apply(true); return; }
      x.config(PRESETS.settle);
      y.config(PRESETS.settle);
      x.value = off.x;   // kecepatan dipertahankan: momentum terbawa
      y.value = off.y;
      x.to(0);
      y.to(0);
      sc.to(1);
      rot.to(0);
      kick(b);
    },
    // widget baru: muncul membesar dengan sedikit pantulan
    pop() {
      if (motionReduced()) return;
      sc.snap(0.7);
      sc.to(1);
      el.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 160 });
      kick(b);
    },
    update(dt) {
      x.step(dt);
      y.step(dt);
      rot.to(dragging ? clamp(x.v * 0.012, -10, 10) : 0);   // miring mengikuti kecepatan mendatar
      rot.step(dt);
      sc.step(dt);
      const done = !dragging && x.settled && y.settled && rot.settled && sc.settled;
      if (done) {
        x.snap(0); y.snap(0); rot.snap(0); sc.snap(1);
        apply(true);
        return true;
      }
      apply(false);
      return false;
    },
  };
  return b;
}