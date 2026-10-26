import { LOCALE, state, on, setState } from "../core/state.js";
import { holidaysOn } from "../calendar/holidays.js";
import { todayParts, eventsOn, zonedEpoch } from "../core/events.js";

// penanda kartu Dashboard untuk layout HP (css/phone.css)
const tag = (el, name) => (el?.closest(".card") ?? el)?.setAttribute("data-dash", name);
tag(document.getElementById("pf-avatar"), "profile");
tag(document.getElementById("weather-icon"), "weather");
tag(document.getElementById("cal-grid"), "cal");
tag(document.querySelector(".mini"), "mini");

// Kartu "Berikutnya" di Dashboard: acara terdekat dan libur nasional berikutnya.
// Disisipkan di bawah kartu tanggal; kelasnya disalin dari kartu itu supaya tampilannya sama.
const anchor = document.getElementById("clock-date");
const host = anchor?.parentElement;
const fallback = document.querySelector('.view[data-view="dashboard"]');
if (!host && !fallback) throw new Error("upnext: card insertion point not found");

const card = document.createElement("div");
card.className = (host ? host.className + " " : "") + "nx";
card.title = "Open calendar";
if (host) host.after(card);
else fallback.append(card);

const dayFmt = new Intl.DateTimeFormat(LOCALE, {
  weekday: "short", day: "numeric", month: "short", timeZone: "UTC",
});

const dayAt = (t, n) => {
  const date = new Date(Date.UTC(t.y, t.m, t.d + n));
  return { y: date.getUTCFullYear(), m: date.getUTCMonth(), d: date.getUTCDate(), date };
};
const when = (n, date) => (n === 0 ? "Today" : n === 1 ? "Tomorrow" : dayFmt.format(date));

// acara yang belum lewat, sampai `limit` buah, dalam 60 hari ke depan
function upcomingEvents(t, limit) {
  const out = [];
  const now = Date.now();
  for (let n = 0; n <= 60 && out.length < limit; n++) {
    const x = dayAt(t, n);
    for (const ev of eventsOn(x.y, x.m, x.d)) {
      if (n === 0 && ev.time) {   // acara berjam yang sudah lewat hari ini dilewati
        const [hh, mm] = ev.time.split(":").map(Number);
        if (zonedEpoch(x.y, x.m, x.d, hh, mm) < now) continue;
      }
      out.push({ ev, n, date: x.date });
      if (out.length >= limit) break;
    }
  }
  return out;
}

// libur nasional (bukan cuti bersama) berikutnya, termasuk hari ini
function nextHoliday(t) {
  for (let n = 0; n <= 400; n++) {
    const x = dayAt(t, n);
    const h = holidaysOn(x.y, x.m, x.d).find((i) => i.type === "L");
    if (h) return { name: h.name, n, date: x.date };
  }
  return null;
}

function row(label, title, cls = "") {
  const r = document.createElement("div");
  r.className = "nx-row " + cls;
  const a = document.createElement("span");
  a.className = "nx-when";
  a.textContent = label;
  const b = document.createElement("span");
  b.className = "nx-t";
  b.textContent = title;
  r.append(a, b);
  return r;
}

function render() {
  if (state.off) return;
  const t = todayParts();
  const head = document.createElement("div");
  head.className = "nx-h";
  head.textContent = "Coming up";
  const rows = [head];

  const evs = upcomingEvents(t, 2);
  if (evs.length) {
    for (const { ev, n, date } of evs) {
      rows.push(row(`${when(n, date)}${ev.time ? " · " + ev.time : ""}`, ev.title));
    }
  } else {
    rows.push(row("", "No events in the next 2 months", "nx-empty"));
  }

  const h = nextHoliday(t);
  if (h) {
    const left = h.n === 0 ? "today" : h.n === 1 ? "tomorrow" : `in ${h.n} days`;
    rows.push(row("Holiday", `${h.name} · ${left}`, "nx-hol"));
  }
  card.replaceChildren(...rows);
    queueFit();
}

// ---- kartu tanggal disembunyikan; dasar kartu ini disejajarkan dengan kartu musik ----
host?.classList.add("nx-gone");
const mini = document.querySelector(".mini");

function fit() {
  card.style.minHeight = "";
  if (mini) mini.style.minHeight = "";
  if (!mini) return;
  const a = card.getBoundingClientRect(), b = mini.getBoundingClientRect();
  if (!a.height || !b.height) return;   // tab Dashboard sedang tidak tampil
  if (a.right > b.left + 1) return;     // satu kolom (HP): tidak ada yang perlu disejajarkan
  const diff = b.bottom - a.bottom;
  if (diff > 1) card.style.minHeight = a.height + diff + "px";           // kiri lebih pendek: kartu ini memanjang
  else if (diff < -1) mini.style.minHeight = b.height - diff + "px";     // kanan lebih pendek: kartu musik memanjang
}

let fitRaf = 0;
const queueFit = () => {
  cancelAnimationFrame(fitRaf);
  fitRaf = requestAnimationFrame(fit);
};

// ukuran kartu lain berubah (kalender 5 atau 6 baris, teks lagu membungkus, dst.)
const ro = new ResizeObserver(queueFit);
for (const col of new Set([card.parentElement, mini?.parentElement])) {
  for (const el of col?.children ?? []) if (el !== card && el !== mini) ro.observe(el);
}
addEventListener("resize", queueFit);
on("state:activeTab", queueFit);
on("state:panelOpen", queueFit);
on("audio:track", queueFit);

card.addEventListener("click", () => setState("activeTab", "calendar"));

on("state:events", render);
on("state:panelOpen", (open) => open && render());
on("power:on", render);
setInterval(render, 60_000);   // ganti hari dan acara berjam yang lewat
render();