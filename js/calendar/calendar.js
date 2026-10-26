import { LOCALE, state, setState, on, emit } from "../core/state.js";
import { openDialog } from "../core/dialog.js";
import { holidaysOn, holidayYearKnown } from "./holidays.js";
import { createIcon } from "../core/icons.js";
import {
  todayParts, ymd, isDate, daysInMonth, eventsOn, addEvent, updateEvent, removeEvent,
  REPEAT_OPTS, REMIND_OPTS, notifyStatus, enableSystemNotifications,
} from "../core/events.js";

const $ = (id) => document.getElementById(id);
const HEAD = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MIN_Y = 2000, MAX_Y = 2100;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// kalender kecil di Dashboard
const miniTitle = $("cal-title"), miniGrid = $("cal-grid");
const miniPrev = $("cal-mprev"), miniNext = $("cal-mnext"), miniAdd = $("cal-madd");
// kalender besar dan agenda di tab Kalender
const bigGrid = $("cal-big"), monthBtn = $("cal-month"), prevBtn = $("cal-prev"), nextBtn = $("cal-next");
const agDate = $("ag-date"), agSub = $("ag-sub"), agList = $("ag-list"), agAdd = $("ag-add"), agBell = $("ag-bell");

const monthFmt = new Intl.DateTimeFormat(LOCALE, { month: "long", year: "numeric", timeZone: "UTC" });
const longFmt = new Intl.DateTimeFormat(LOCALE, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const monthLabel = (y, m) => monthFmt.format(new Date(Date.UTC(y, m, 1)));
const firstOffset = (y, m) => (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7;   // Senin = 0
const dayKey = (t) => `${t.y}-${t.m}-${t.d}`;

function head() {
  return HEAD.map((h) => {
    const e = document.createElement("div");
    e.className = "cal-head";
    e.textContent = h;
    return e;
  });
}

let today = todayParts();
let view = { y: today.y, m: today.m };   // bulan yang tampil di kalender besar
let sel = { ...today };                  // tanggal yang dipilih
let miniView = { y: today.y, m: today.m };   // bulan yang tampil di kalender kecil (Dashboard)

// satu sel tanggal: kelas untuk hari ini, Minggu, libur, dan acara
function makeDay(tag, y, m, n, cls, first) {
  const el = document.createElement(tag);
  const hol = holidaysOn(y, m, n);
  const evs = eventsOn(y, m, n);
  el.className = cls;
  if (y === today.y && m === today.m && n === today.d) el.classList.add("today");
  if ((first + n - 1) % 7 === 6) el.classList.add("sun");
  if (hol.some((h) => h.type === "L")) el.classList.add("hol");
  else if (hol.length) el.classList.add("cuti");
  if (evs.length) el.classList.add("has");
  el.dataset.y = String(y);
  el.dataset.m = String(m);
  el.dataset.d = String(n);
  const tip = [...hol.map((h) => h.name), ...(evs.length ? [`${evs.length} events`] : [])].join(" · ");
  if (tip) el.title = tip;
  return { el, hol, evs };
}

// ---------- kalender kecil (Dashboard) ----------
function renderMini() {
  if (state.off || !miniGrid) return;
  today = todayParts();
  const { y, m } = miniView;
  const first = firstOffset(y, m);
  miniTitle.textContent = monthLabel(y, m);
  if (miniPrev) miniPrev.disabled = y === MIN_Y && m === 0;
  if (miniNext) miniNext.disabled = y === MAX_Y && m === 11;
  const cells = head();
  for (let i = 0; i < first; i++) cells.push(document.createElement("div"));
  for (let n = 1; n <= daysInMonth(y, m); n++) {
    const { el } = makeDay("div", y, m, n, "cal-day", first);
    el.textContent = String(n);   // makeDay tidak mengisi angka; kalender besar menambahkannya sendiri lewat <span>
    cells.push(el);
  }
  miniGrid.replaceChildren(...cells);
}

function setMiniView(y, m) {
  const t = new Date(Date.UTC(y, m, 1));   // bulan di luar 0-11 dinormalkan ke tahun berikutnya atau sebelumnya
  const ny = t.getUTCFullYear(), nm = t.getUTCMonth();
  if (ny < MIN_Y || ny > MAX_Y) return;
  miniView = { y: ny, m: nm };
  renderMini();
}

// ---------- kalender besar ----------
function renderBig() {
  if (!bigGrid) return;
  const { y, m } = view;
  const first = firstOffset(y, m);
  monthBtn.textContent = monthLabel(y, m);
  prevBtn.disabled = y === MIN_Y && m === 0;
  nextBtn.disabled = y === MAX_Y && m === 11;

  const cells = head();
  for (let i = 0; i < first; i++) cells.push(document.createElement("div"));
  for (let n = 1; n <= daysInMonth(y, m); n++) {
    const { el, hol, evs } = makeDay("button", y, m, n, "cb-day", first);
    el.type = "button";
    const num = document.createElement("span");
    num.className = "cb-num";
    num.textContent = String(n);
    el.append(num);
    if (evs.length) {
      const dots = document.createElement("span");
      dots.className = "cb-dots";
      for (let i = 0; i < Math.min(3, evs.length); i++) dots.append(document.createElement("i"));
      el.append(dots);
    }
    const isSel = sel.y === y && sel.m === m && sel.d === n;
    el.classList.toggle("sel", isSel);
    el.setAttribute("aria-pressed", String(isSel));
    el.setAttribute(
      "aria-label",
      [`${n} ${monthLabel(y, m)}`, ...hol.map((h) => h.name), ...(evs.length ? [`${evs.length} events`] : [])].join(", "),
    );
    cells.push(el);
  }
  bigGrid.replaceChildren(...cells);
}

function setView(y, m) {
  const t = new Date(Date.UTC(y, m, 1));   // bulan di luar 0-11 dinormalkan ke tahun berikutnya atau sebelumnya
  const ny = t.getUTCFullYear(), nm = t.getUTCMonth();
  if (ny < MIN_Y || ny > MAX_Y) return;
  view = { y: ny, m: nm };
  renderBig();
}

// ---------- agenda hari yang dipilih ----------
function textSpan(cls, text) {
  const s = document.createElement("span");
  s.className = cls;
  s.textContent = text;
  return s;
}
function iconButton(cls, label, text) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.setAttribute("aria-label", label);
  b.textContent = text;
  return b;
}

function renderAgenda() {
  if (!agList) return;
  const { y, m, d } = sel;
  const hol = holidaysOn(y, m, d);
  const evs = eventsOn(y, m, d);
  agDate.textContent = longFmt.format(new Date(Date.UTC(y, m, d)));
  agSub.textContent =
    (evs.length ? `${evs.length} events` : "No events") +
    (holidayYearKnown(y) ? "" : ` · religious holidays for ${y} are not available`);

  const rows = [];
  for (const h of hol) {
    const li = document.createElement("li");
    li.className = "ag-item " + (h.type === "L" ? "hol" : "cuti");
    li.append(textSpan("ag-time", h.type === "L" ? "Holiday" : "Collective leave"), textSpan("ag-title", h.name));
    rows.push(li);
  }
  for (const ev of evs) {
    const li = document.createElement("li");
    li.className = "ag-item";
    li.dataset.id = ev.id;
    li.append(textSpan("ag-time", ev.time || "All day"), textSpan("ag-title", ev.title));
    if (ev.repeat !== "none" || ev.remind >= 0) {
      const mt = textSpan("ag-meta", ev.repeat !== "none" ? "↻ " : "");
      if (ev.remind >= 0) mt.append(createIcon("40_bell.png"));
      mt.title = [
        ev.repeat !== "none" ? REPEAT_OPTS.find(([v]) => v === ev.repeat)?.[1] : "",
        ev.remind >= 0 ? "Reminder: " + REMIND_OPTS.find(([v]) => v === ev.remind)?.[1] : "",
      ].filter(Boolean).join(" · ");
      li.append(mt);
    }
    li.append(iconButton("ag-edit", `Edit ${ev.title}`, "✎"), iconButton("ag-del", `Delete ${ev.title}`, "✕"));
    rows.push(li);
  }
  if (!rows.length) {
    const li = document.createElement("li");
    li.className = "ag-empty";
    li.textContent = "No events yet. Press ＋ to add one.";
    rows.push(li);
  }
  agList.replaceChildren(...rows);
}

// ---------- tambah dan ubah acara ----------
async function editEvent(id = null, dateStr = ymd(sel.y, sel.m, sel.d)) {
  const cur = id ? state.events.find((e) => e.id === id) : null;
  const v = await openDialog({
    title: cur ? "Edit event" : "New event or reminder",
    fields: [
      { name: "title", label: "Name", value: cur?.title ?? "", maxlength: 60, placeholder: "Meeting, pay electricity bill…" },
      { name: "date", label: "Date", type: "date", value: cur?.date ?? dateStr },
      { name: "time", label: "Time (leave blank for all day)", type: "time", value: cur?.time ?? "" },
      { name: "repeat", label: "Repeat", type: "select", options: REPEAT_OPTS, value: cur?.repeat ?? "none" },
      { name: "remind", label: "Reminder", type: "select", options: REMIND_OPTS.map(([val, text]) => [String(val), text]), value: String(cur?.remind ?? 0) },
    ],
    validate: (x) =>
      !x.title ? "Name is required"
      : !isDate(x.date) ? "Choose a valid date"
      : x.time && !TIME_RE.test(x.time) ? "Invalid time"
      : null,
  });
  if (!v) return;
  const data = { title: v.title.slice(0, 60), date: v.date, time: v.time || "", repeat: v.repeat, remind: Number(v.remind) };
  if (cur) updateEvent(cur.id, data);
  else if (!addEvent(data)) return;
  const [y, mo, d] = v.date.split("-").map(Number);
  sel = { y, m: mo - 1, d };
  view = { y, m: mo - 1 };
  miniView = { y, m: mo - 1 };   // kalender kecil ikut ke bulan acara supaya titiknya terlihat
  refreshAll();
}
export const newEvent = (dateStr) => editEvent(null, dateStr);

// ---------- notifikasi sistem ----------
function renderBell() {
  if (!agBell) return;
  const s = notifyStatus();
  agBell.hidden = s === "unsupported";
  agBell.classList.toggle("on", s === "granted");
  agBell.title =
    s === "granted" ? "System notifications are enabled"
    : s === "denied" ? "Notifications are blocked in browser settings"
    : "Enable system notifications to receive reminders when this tab is closed";
}

// ---------- gabungan ----------
function refreshAll() {
  const t = todayParts();
  if (dayKey(t) !== dayKey(today)) {   // ganti hari: yang tadinya menunjuk hari ini ikut pindah
    const selWasToday = dayKey(sel) === dayKey(today);
    const viewWasToday = view.y === today.y && view.m === today.m;
    const miniWasToday = miniView.y === today.y && miniView.m === today.m;
    if (selWasToday) sel = { ...t };
    if (viewWasToday) view = { y: t.y, m: t.m };
    if (miniWasToday) miniView = { y: t.y, m: t.m };
  }
  renderMini();
  renderBig();
  renderAgenda();
}

if (bigGrid && agList) {
  prevBtn.addEventListener("click", () => setView(view.y, view.m - 1));
  nextBtn.addEventListener("click", () => setView(view.y, view.m + 1));
  monthBtn.addEventListener("click", () => {   // klik nama bulan: kembali ke hari ini
    today = todayParts();
    sel = { ...today };
    view = { y: today.y, m: today.m };
    renderBig();
    renderAgenda();
  });
  bigGrid.addEventListener("click", (e) => {
    const b = e.target.closest(".cb-day");
    if (!b) return;
    sel = { y: Number(b.dataset.y), m: Number(b.dataset.m), d: Number(b.dataset.d) };
    renderBig();
    renderAgenda();
  });
  agAdd.addEventListener("click", () => editEvent(null));
  agList.addEventListener("click", (e) => {
    const li = e.target.closest(".ag-item[data-id]");
    if (!li) return;
    const id = li.dataset.id;
    if (e.target.closest(".ag-edit")) return editEvent(id);
    const del = e.target.closest(".ag-del");
    if (!del) return;
    if (del.classList.contains("armed")) {   // klik dua kali untuk menghapus
      removeEvent(id);
      emit("toast", { title: "Calendar", message: "Event deleted", duration: 2000 });
    } else {
      del.classList.add("armed");
      del.textContent = "Delete?";
      setTimeout(() => {
        if (!del.isConnected) return;
        del.classList.remove("armed");
        del.textContent = "✕";
      }, 3000);
    }
  });
  agBell?.addEventListener("click", async () => {
    if (notifyStatus() === "default") await enableSystemNotifications();
    renderBell();
  });
  on("notify:changed", renderBell);
}

// kalender kecil: klik tanggal membuka tab Kalender di tanggal itu
miniGrid?.addEventListener("click", (e) => {
  const c = e.target.closest(".cal-day");
  if (!c) return;
  sel = { y: Number(c.dataset.y), m: Number(c.dataset.m), d: Number(c.dataset.d) };
  view = { y: sel.y, m: sel.m };
  renderBig();
  renderAgenda();
  setState("activeTab", "calendar");
  setState("panelOpen", true);
});

// kalender kecil: panah bulan, klik judul kembali ke bulan ini, dan tombol tambah acara
miniPrev?.addEventListener("click", () => setMiniView(miniView.y, miniView.m - 1));
miniNext?.addEventListener("click", () => setMiniView(miniView.y, miniView.m + 1));
miniTitle?.addEventListener("click", () => {
  today = todayParts();
  miniView = { y: today.y, m: today.m };
  renderMini();
});
miniAdd?.addEventListener("click", () => editEvent(null));

on("state:events", refreshAll);
on("power:on", refreshAll);
setInterval(() => { if (dayKey(todayParts()) !== dayKey(today)) refreshAll(); }, 60_000);   // ganti hari otomatis
renderBell();
refreshAll();