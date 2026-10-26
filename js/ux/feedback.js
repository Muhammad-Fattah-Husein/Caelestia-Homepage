import { state, on, emit } from "../core/state.js";

// =====================================================================
// Pengaturan (tersimpan di browser)
// =====================================================================
const KEY = "fx";
function load() {
  const d = { sound: false, haptics: true, volume: 0.5 };   // suara mati sampai kamu menyalakannya (>suara)
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (raw && typeof raw === "object") {
      if (typeof raw.sound === "boolean") d.sound = raw.sound;
      if (typeof raw.haptics === "boolean") d.haptics = raw.haptics;
      if (Number.isFinite(raw.volume)) d.volume = Math.min(1, Math.max(0, raw.volume));
    }
  } catch {}
  return d;
}
const fx = load();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(fx)); } catch {} };

export const getFx = () => ({ ...fx });
export function setFx(patch) {
  if (typeof patch.sound === "boolean") fx.sound = patch.sound;
  if (typeof patch.haptics === "boolean") fx.haptics = patch.haptics;
  if (Number.isFinite(patch.volume)) fx.volume = Math.min(1, Math.max(0, patch.volume));
  save();
  emit("fx:changed", getFx());
}

// =====================================================================
// Getaran (hanya jalan di perangkat yang mendukung, mis. Chrome di Android)
// =====================================================================
const BUZZ = {
  tick: 8, snap: 6, pick: 12, drop: 18,
  remove: [12, 40, 12], success: [10, 30, 10, 30, 20], warn: [30, 60, 30],
};
let lastBuzz = 0;
export function haptic(kind = "tick") {
  if (!fx.haptics || state.off || typeof navigator === "undefined" || !navigator.vibrate) return;
  const now = Date.now();
  if (now - lastBuzz < 25) return;   // jangan menumpuk saat banyak kejadian beruntun
  lastBuzz = now;
  try { navigator.vibrate(BUZZ[kind] ?? BUZZ.tick); } catch {}
}

// =====================================================================
// Suara efek: disintesis dengan Web Audio, tanpa berkas. Terpisah dari audio.js
// (itu terikat pada pemutar musik), jadi musik dan efek tidak saling mengganggu.
// =====================================================================
let ctx = null, master = null, noiseBuf = null;

function ensure() {
  if (!ctx) {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();   // mencegah memekik kalau banyak bunyi bersamaan
    master.connect(comp);
    comp.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  master.gain.value = fx.volume;
  return true;
}

function tone(t0, { f = 440, to, type = "sine", dur = 0.1, gain = 0.1, attack = 0.004, jitter = 0 }) {
  const k = 1 + (Math.random() - 0.5) * jitter;   // sedikit variasi nada supaya tidak membosankan
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f * k, t0);
  if (to) o.frequency.exponentialRampToValueAtTime(to * k, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g);
  g.connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function noise(t0, { dur = 0.08, gain = 0.08, freq = 800, to, type = "lowpass" }) {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.4), ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuf;
  f.type = type;
  f.frequency.setValueAtTime(freq, t0);
  if (to) f.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  s.connect(f);
  f.connect(g);
  g.connect(master);
  s.start(t0);
  s.stop(t0 + dur + 0.02);
}

const SOUNDS = {
  click:     (t) => tone(t, { f: 1700, to: 1100, dur: 0.045, gain: 0.07, jitter: 0.08 }),
  snap:      (t) => tone(t, { f: 2400, to: 2000, dur: 0.02, gain: 0.04, jitter: 0.05 }),
  pick:      (t) => tone(t, { f: 420, to: 760, type: "triangle", dur: 0.1, gain: 0.12 }),
  drop:      (t) => { tone(t, { f: 200, to: 70, dur: 0.16, gain: 0.25 }); noise(t, { dur: 0.05, gain: 0.07, freq: 500 }); },
  remove:    (t) => { tone(t, { f: 520, to: 140, type: "sawtooth", dur: 0.16, gain: 0.05 }); noise(t, { dur: 0.12, gain: 0.05, freq: 1800, to: 300 }); },
  open:      (t) => tone(t, { f: 560, to: 880, dur: 0.09, gain: 0.07 }),
  close:     (t) => tone(t, { f: 880, to: 560, dur: 0.09, gain: 0.06 }),
  warn:      (t) => { tone(t, { f: 440, type: "triangle", dur: 0.12, gain: 0.1 }); tone(t + 0.14, { f: 330, type: "triangle", dur: 0.16, gain: 0.1 }); },
  error:     (t) => { tone(t, { f: 220, type: "square", dur: 0.12, gain: 0.05 }); tone(t + 0.14, { f: 165, type: "square", dur: 0.18, gain: 0.05 }); },
  success:   (t) => { tone(t, { f: 880, dur: 0.12, gain: 0.08 }); tone(t + 0.1, { f: 1320, dur: 0.16, gain: 0.08 }); },
  powerdown: (t) => tone(t, { f: 440, to: 60, dur: 0.5, gain: 0.12 }),
  powerup:   (t) => tone(t, { f: 120, to: 520, dur: 0.35, gain: 0.1 }),
};
const COOLDOWN = { snap: 35, click: 30 };   // ms; bunyi yang sama tidak dihidupkan terlalu rapat
const lastAt = {};

export function sfx(name) {
  if (!fx.sound || !SOUNDS[name]) return;
  if (state.off && name !== "powerdown") return;
  const now = Date.now();
  if (now - (lastAt[name] ?? 0) < (COOLDOWN[name] ?? 60)) return;
  lastAt[name] = now;
  if (!ensure()) return;
  try { SOUNDS[name](ctx.currentTime + 0.001); } catch (err) { console.warn("Failed to play sound effect:", err); }
}

// =====================================================================
// Tombol untuk launcher
// =====================================================================
export function toggleSound() {
  setFx({ sound: !fx.sound });
  emit("toast", { title: "Sound effects", message: fx.sound ? "On" : "Off", duration: 1800 });
  if (fx.sound) sfx("pick");   // contoh bunyinya (peralihan dari klik adalah interaksi pengguna)
}
export function toggleHaptics() {
  if (typeof navigator === "undefined" || !navigator.vibrate) {
    emit("toast", { title: "Haptics", message: "This device does not support vibration", type: "warn" });
    return;
  }
  setFx({ haptics: !fx.haptics });
  emit("toast", { title: "Haptics", message: fx.haptics ? "On" : "Off", duration: 1800 });
  if (fx.haptics) haptic("pick");
}

// =====================================================================
// Pemasangan otomatis: klik, panel, daya, notifikasi
// =====================================================================
const NO_CLICK = ".wd-remove, .wd-resize, .wd-tile, [data-nosound]";   // punya bunyi sendiri atau sengaja dibisukan
const CLICKABLE = "button, [role=button], a, summary, label, .tab, .lc-item, .cb-day, .mode-chip";
document.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || e.isTrusted === false) return;
  const t = e.target.closest?.(CLICKABLE);
  if (!t || t.matches(":disabled") || t.closest(NO_CLICK)) return;
  sfx("click");
  haptic("tick");
}, true);

const cool = {};
for (const key of ["panelOpen", "themePicker", "launcher", "terminal", "menu", "powerMenu", "prefsOpen"]) {
  on("state:" + key, (open) => {
    const now = Date.now();
    if (now - (cool[key] ?? 0) < 350) return;   // panel yang dibuka lewat hover bisa berkedip; satu bunyi saja
    cool[key] = now;
    sfx(open ? "open" : "close");
  });
}
on("state:off", (off) => sfx(off ? "powerdown" : "powerup"));
on("toast", (t) => {
  if (t?.type === "error") { sfx("error"); haptic("warn"); }
  else if (t?.type === "warn") { sfx("warn"); haptic("warn"); }
});