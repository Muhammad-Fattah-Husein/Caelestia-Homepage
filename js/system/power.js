import { state, setState, on, emit } from "../core/state.js";
import { resetAll } from "../core/backup.js";

const root = document.documentElement;
const menu = document.getElementById("power-menu");
const trigger = document.getElementById("btn-power");
const btnOn = document.getElementById("btn-on");
const resetBtn = menu.querySelector('[data-act="reset"]');
const audio = document.getElementById("audio");

// semua kunci localStorage milik halaman ini; tambahkan kunci widget di sini nanti
let armTimer;

// ---- menu ----
trigger.addEventListener("click", () => setState("powerMenu", !state.powerMenu));

on("state:powerMenu", open => {
  menu.classList.toggle("open", open);
  menu.inert = !open;
  trigger.classList.toggle("active", open);
  trigger.setAttribute("aria-expanded", String(open));
  if (!open) disarm();
});

document.addEventListener("pointerdown", e => {
  if (state.powerMenu && !menu.contains(e.target) && !e.target.closest("#btn-power"))
    setState("powerMenu", false);
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape") setState("powerMenu", false);
});

// ---- matikan / nyalakan ----
export function powerOff() {
  lockClose();
  PANELS.forEach(k => setState(k, false));
  audio.pause();
  root.classList.add("off");
  setState("off", true);
  requestAnimationFrame(() => btnOn.focus());
}

function powerOn() {
  root.classList.remove("off");
  setState("off", false);
  emit("power:on");   // modul yang berhenti berjalan melanjutkan dan menyegarkan diri
}

btnOn.addEventListener("click", powerOn);

// ---- kunci (layar kunci: jam besar + tanggal di atas halaman yang diburamkan) ----
const PANELS = ["panelOpen", "themePicker", "launcher", "terminal", "menu", "powerMenu", "prefsOpen"];
const fmtTime = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", hour12: false });
const fmtDate = new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
let lockEl, lockClock, lockOpenedAt = 0;

function buildLock() {
  lockEl = document.createElement("div");
  lockEl.id = "lock-screen";
  lockEl.tabIndex = -1;
  lockEl.setAttribute("aria-label", "Layar terkunci");
  lockEl.inert = true;

  const center = document.createElement("div");
  center.className = "lock-center";
  const time = Object.assign(document.createElement("div"), { className: "lock-time" });
  const date = Object.assign(document.createElement("div"), { className: "lock-date" });
  center.append(time, date);

  const card = Object.assign(document.createElement("div"), { className: "lock-card" });   // kosong dulu; isi nanti
  const hint = Object.assign(document.createElement("div"), { className: "lock-hint", textContent: "Klik atau tekan tombol apa saja" });

  lockEl.append(center, card, hint);
  document.body.append(lockEl);
  lockEl._time = time; lockEl._date = date;
}

function tickLock() {
  const d = new Date();
  lockEl._time.textContent = fmtTime.format(d).replace(".", ":");
  lockEl._date.textContent = fmtDate.format(d);
}

function onLockInput(e) {
  if (Date.now() - lockOpenedAt < 400 || e.repeat) return;   // abaikan input yang baru saja membuka kunci
  e.preventDefault();
  e.stopPropagation();
  setState("locked", false);
}

export function lockOpen() {
  if (state.off || state.locked) return;
  PANELS.forEach(k => setState(k, false));
  setState("locked", true);
}
function lockClose() { if (state.locked) setState("locked", false); }

on("state:locked", locked => {
  if (!lockEl) buildLock();
  lockEl.inert = !locked;
  lockEl.classList.toggle("show", locked);
  root.classList.toggle("locked", locked);
  clearInterval(lockClock);
  if (locked) {
    lockOpenedAt = Date.now();
    tickLock();
    lockClock = setInterval(tickLock, 1000);
    lockEl.focus({ preventScroll: true });
    window.addEventListener("click", onLockInput, true);
    window.addEventListener("keydown", onLockInput, true);
  } else {
    window.removeEventListener("click", onLockInput, true);
    window.removeEventListener("keydown", onLockInput, true);
    trigger.focus({ preventScroll: true });
  }
});

// ---- reset (klik dua kali untuk konfirmasi) ----
function disarm() {
  clearTimeout(armTimer);
  resetBtn.classList.remove("armed");
}

export function reset() {
  if (!resetBtn.classList.contains("armed")) {
    resetBtn.classList.add("armed");
    emit("toast", { title: "Reset", message: "Click again within 10 seconds to restore defaults", type: "warn", duration: 8000 });
    armTimer = setTimeout(disarm, 10000);
    return;
  }
  resetAll();
}

// ---- tombol di menu ----
const ACTIONS = { off: powerOff, lock: lockOpen, reset };
menu.addEventListener("click", e => {
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (act && Object.hasOwn(ACTIONS, act)) ACTIONS[act]();
});