import { state, on, emit, uid } from "../core/state.js";

const KEY = "timers";
const MAX = 5;                       // timer aktif bersamaan
const BASE_TITLE = document.title;

export function human(s) {
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), d = s % 60;
  return [h && `${h} hr`, m && `${m} min`, (d || !(h || m)) && `${d} sec`].filter(Boolean).join(" ");
}

export function fmtClock(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), d = s % 60;
  const mm = String(m).padStart(2, "0"), ss = String(d).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (Array.isArray(raw)) {
      return raw.slice(0, MAX).flatMap((t) =>
        Number.isFinite(t?.endAt) && typeof t.id === "string"
          ? [{ id: t.id, endAt: t.endAt, secs: Number(t.secs) || 0, label: String(t.label ?? "").slice(0, 30) }]
          : []);
    }
  } catch {}
  return [];
}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(timers)); } catch {} };

let timers = load();
export const activeCount = () => timers.length;
export const listTimers = () =>
  timers.map((x) => ({ label: x.label, secs: x.secs, left: Math.max(0, Math.ceil((x.endAt - Date.now()) / 1000)) }));

// ---- detak: Worker tidak ikut diperlambat browser saat tab di latar belakang ----
let worker = null, fallbackId = 0, ticking = false;
try {
  const src = `let id; onmessage = e => { clearInterval(id); if (e.data === "start") id = setInterval(() => postMessage(0), 1000); };`;
  worker = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
  worker.onmessage = () => step();
} catch { worker = null; }
const startTick = () => (worker ? worker.postMessage("start") : (fallbackId = setInterval(step, 1000)));
const stopTick = () => (worker ? worker.postMessage("stop") : clearInterval(fallbackId));

function beep() {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.25, 0.5].forEach((t) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.value = 880;
      g.gain.value = 0.15;
      o.connect(g);
      g.connect(ac.destination);
      o.start(ac.currentTime + t);
      o.stop(ac.currentTime + t + 0.15);
    });
    setTimeout(() => ac.close(), 1200);
  } catch {}   // diblokir browser kalau belum ada interaksi: toast tetap muncul
}

function paint() {
  if (state.off || !timers.length) { document.title = BASE_TITLE; return; }
  const next = Math.min(...timers.map((t) => t.endAt));
  const left = Math.max(0, Math.ceil((next - Date.now()) / 1000));
  document.title = `Timer ${fmtClock(left)} · ${BASE_TITLE}`;
}

function run() {
  if (timers.length && !ticking) { ticking = true; startTick(); }
  else if (!timers.length && ticking) { ticking = false; stopTick(); }
  paint();
}

function step() {
  if (state.off) return;   // saat dimatikan: ditunda, dibunyikan begitu dinyalakan lagi
  const now = Date.now();
  const due = timers.filter((t) => t.endAt <= now);
  if (due.length) {
    timers = timers.filter((t) => t.endAt > now);
    save();
    for (const t of due) {
      emit("toast", { title: "Timer complete", message: t.label || human(t.secs), duration: 0 });   // 0 = remains until dismissed
    }
    beep();
  }
  run();
}

export function startTimer(secs, label = "") {
  if (timers.length >= MAX) {
    emit("toast", { title: "Timer", message: `Maximum ${MAX} active timers`, type: "warn" });
    return;
  }
  timers.push({ id: uid(), endAt: Date.now() + secs * 1000, secs, label });
  save();
  run();
  emit("toast", { title: "Timer started", message: human(secs) + (label ? ` · ${label}` : ""), duration: 2500 });
}

export function cancelTimers() {
  const n = timers.length;
  timers = [];
  save();
  run();
  emit("toast", { title: "Timer", message: n ? `${n} timers cancelled` : "No active timers", duration: 2000 });
}

on("power:on", step);
document.addEventListener("visibilitychange", () => { if (!document.hidden) step(); });
run();
step();   // timer yang habis saat halaman tertutup langsung dibunyikan