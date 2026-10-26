import { zone, state, setState, on, emit, uid } from "./state.js";

const KEY = "events";
const FIRED_KEY = "evfired";
const MAX = 300;
const LOOKBACK = 12 * 3600_000;   // pengingat yang terlewat selama halaman tertutup masih dibunyikan sampai 12 jam
const ALLDAY_HOUR = 8;            // acara seharian: pengingat dihitung dari pukul 08.00

export const REPEAT_OPTS = [["none", "Does not repeat"], ["weekly", "Weekly"], ["monthly", "Monthly"], ["yearly", "Yearly"]];
export const REMIND_OPTS = [
  [-1, "No reminder"], [0, "At time of event"], [5, "5 minutes before"], [15, "15 minutes before"],
  [30, "30 minutes before"], [60, "1 hour before"], [1440, "1 day before"],
];
const REPEATS = REPEAT_OPTS.map(([v]) => v);
const REMINDS = REMIND_OPTS.map(([v]) => v);
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// ---------- tanggal (bulan 0-11, seperti Date) ----------
export const pad2 = (n) => String(n).padStart(2, "0");
export const ymd = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`;
export const isDate = (s) =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !Number.isNaN(Date.parse(s + "T00:00:00Z")) && new Date(s + "T00:00:00Z").toISOString().startsWith(s);   // menolak 30 Februari
export const daysInMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export function todayParts() {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "numeric", day: "numeric" })
      .formatToParts(new Date()).map((x) => [x.type, x.value]),
  );
  return { y: +p.year, m: +p.month - 1, d: +p.day };
}

function shiftDay(y, m, d, n) {
  const t = new Date(Date.UTC(y, m, d + n));
  return [t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()];
}

// waktu dinding di zona -> epoch (ms), tanpa pustaka
const zfmt = new Intl.DateTimeFormat("en-US", {
  timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
  hour: "numeric", minute: "numeric", second: "numeric",
});
function offsetAt(ts) {
  const p = Object.fromEntries(zfmt.formatToParts(new Date(ts)).map((x) => [x.type, +x.value]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - ts;
}
export function zonedEpoch(y, m, d, hh = 0, mm = 0) {
  const guess = Date.UTC(y, m, d, hh, mm);
  const ts = guess - offsetAt(guess);
  return guess - offsetAt(ts);   // dikoreksi sekali lagi di sekitar pergantian offset
}

// ---------- acara ----------
export function occursOn(ev, y, m, d) {
  const [ey, em, ed] = ev.date.split("-").map(Number);
  const t = Date.UTC(y, m, d), t0 = Date.UTC(ey, em - 1, ed);
  if (t < t0) return false;
  switch (ev.repeat) {
    case "weekly": return ((t - t0) / 86400000) % 7 === 0;
    case "monthly": return d === Math.min(ed, daysInMonth(y, m));   // tanggal 31 jatuh di akhir bulan yang pendek
    case "yearly": return m === em - 1 && d === (em === 2 && ed === 29 && !isLeap(y) ? 28 : ed);
    default: return t === t0;
  }
}

export function eventsOn(y, m, d) {
  return state.events
    .filter((e) => occursOn(e, y, m, d))
    .sort((a, b) => (a.time || "").localeCompare(b.time || "") || a.title.localeCompare(b.title));   // seharian dulu
}

function loadEvents() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (Array.isArray(raw)) {
      return raw.slice(0, MAX).flatMap((e) => {
        if (!e || typeof e.id !== "string" || typeof e.title !== "string" || !isDate(e.date)) return [];
        const title = e.title.trim().slice(0, 60);
        if (!title) return [];
        return [{
          id: e.id, title, date: e.date,
          time: TIME_RE.test(e.time) ? e.time : "",
          repeat: REPEATS.includes(e.repeat) ? e.repeat : "none",
          remind: REMINDS.includes(e.remind) ? e.remind : -1,
        }];
      });
    }
  } catch {}
  return [];
}
const saveEvents = () => { try { localStorage.setItem(KEY, JSON.stringify(state.events)); } catch {} };

state.events = loadEvents();

export function addEvent(data) {
  if (state.events.length >= MAX) {
    emit("toast", { title: "Calendar", message: `Maximum ${MAX} events`, type: "warn" });
    return null;
  }
  const ev = { id: uid(), ...data };
  setState("events", [...state.events, ev]);
  return ev;
}
export const updateEvent = (id, patch) =>
  setState("events", state.events.map((e) => (e.id === id ? { ...e, ...patch } : e)));
export const removeEvent = (id) =>
  setState("events", state.events.filter((e) => e.id !== id));

// ---------- pengingat ----------
export const notifyStatus = () => (typeof Notification === "undefined" ? "unsupported" : Notification.permission);
export async function enableSystemNotifications() {
  if (notifyStatus() === "unsupported") return "unsupported";
  const r = await Notification.requestPermission();
  emit("notify:changed", r);
  return r;
}

function loadFired() {
  try {
    const raw = JSON.parse(localStorage.getItem(FIRED_KEY));
    if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
  } catch {}
  return {};
}
const fired = loadFired();   // "idAcara@waktuMulai" -> kapan dibunyikan; mencegah bunyi dua kali setelah refresh
const saveFired = () => { try { localStorage.setItem(FIRED_KEY, JSON.stringify(fired)); } catch {} };

function notify(ev, dayOff, late) {
  const dayWord = dayOff === 1 ? "tomorrow" : dayOff === -1 ? "yesterday" : "today";
  const when = dayWord + (ev.time ? ` at ${ev.time}` : "");
  emit("toast", { title: late ? "Reminder (missed)" : "Reminder", message: `${ev.title} · ${when}`, duration: 0 });   // 0 = remains until dismissed
  try {
    if (notifyStatus() === "granted") new Notification(`Reminder: ${ev.title}`, { body: when, tag: ev.id });
  } catch {}   // sebagian browser HP tidak mengizinkan Notification dari halaman biasa
}

export function checkReminders() {
  if (state.off || !state.events.length) return;
  const now = Date.now();
  const t = todayParts();
  let changed = false;
  for (const off of [-1, 0, 1]) {   // tanggal acara: kemarin, hari ini, besok (pengingat "1 hari sebelum" jatuh sehari lebih awal)
    const [y, m, d] = shiftDay(t.y, t.m, t.d, off);
    for (const ev of state.events) {
      if (ev.remind < 0 || !occursOn(ev, y, m, d)) continue;
      const [hh, mi] = ev.time ? ev.time.split(":").map(Number) : [ALLDAY_HOUR, 0];
      const start = zonedEpoch(y, m, d, hh, mi);
      const due = start - ev.remind * 60_000;
      const key = `${ev.id}@${start}`;
      if (due > now || now - due > LOOKBACK || fired[key]) continue;
      fired[key] = now;
      changed = true;
      notify(ev, off, now - due > 120_000);
    }
  }
  for (const k of Object.keys(fired)) {
    if (now - fired[k] > 3 * 86400_000) { delete fired[k]; changed = true; }
  }
  if (changed) saveFired();
}

on("state:events", () => { saveEvents(); checkReminders(); });
on("power:on", checkReminders);
document.addEventListener("visibilitychange", () => { if (!document.hidden) checkReminders(); });
setInterval(checkReminders, 30_000);
setTimeout(checkReminders, 1500);   // tunggu semua modul (termasuk toast.js) siap