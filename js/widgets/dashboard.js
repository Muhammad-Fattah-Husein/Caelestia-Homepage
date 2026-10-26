import { state, setState, on, zone, LOCALE } from "../core/state.js";
import { createIcon } from "../core/icons.js";
import { describe, lastWeather } from "./weather.js";
import { todayParts, eventsOn } from "../core/events.js";

const $ = (id) => document.getElementById(id);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
const onDashboard = () => state.panelOpen && state.activeTab === "dashboard" && !state.off;

// =====================================================================
// Jam besar (kalender kecil dan tanggal ditangani calendar.js dan clock.js)
// =====================================================================
const hmEl = $("dash-hm"), sEl = $("dash-s");
const clockFmt = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone: zone,
});
function tickClock() {
  if (!hmEl || !onDashboard()) return;
  const p = Object.fromEntries(clockFmt.formatToParts(new Date()).map((x) => [x.type, x.value]));
  hmEl.textContent = `${p.hour}:${p.minute}`;
  sEl.textContent = `:${p.second}`;
}
setInterval(tickClock, 1000);
["state:panelOpen", "state:activeTab", "power:on"].forEach((ev) => on(ev, tickClock));

// =====================================================================
// Cuaca: cincin per jam, suhu besar, empat cincin kecil, navigasi hari
// =====================================================================
const MS_H = 3600_000;
const RING_C = 2 * Math.PI * 42;
const ANGLES = Array.from({ length: 8 }, (_, k) => -25 + k * 45);   // derajat dari titik terbawah, searah jarum jam
const TILT = -10;   // kemiringan elips (derajat, negatif = sisi atas condong ke kiri seperti referensi); 0 = datar
const RINGS = [
  { key: "wind",  label: "Wind",  min: 0,   max: 15,  fmt: (v) => `${Math.round(v)}m/s` },
  { key: "humid", label: "Humid", min: 0,   max: 100, fmt: (v) => `${Math.round(v)}%` },
  { key: "rain",  label: "Rain",  min: 0,   max: 100, fmt: (v) => `${Math.round(v)}%` },
  { key: "feels", label: "Feels", min: -10, max: 40,  fmt: (v) => `${v.toFixed(1)}°` },
];

const orbitEl = $("wx-points"), dayEl = $("wx-dayname"), tempEl = $("wx-temp"), descEl = $("wx-desc");
const prevBtn = $("wx-prev"), nextBtn = $("wx-next"), ringsEl = $("wx-rings");
const dayFmt = new Intl.DateTimeFormat(LOCALE, { weekday: "long", timeZone: "UTC" });

const W = { data: null, day: 0, nowIdx: -1 };

function prepare(d) {   // t0 = epoch jam pertama di data per jam
  const off = (d.utc_offset_seconds ?? 0) * 1000;
  return { ...d, t0: Date.parse(d.hourly.time[0] + "Z") - off };
}
const nowIndex = (d) => clamp(Math.round((Date.now() - d.t0) / MS_H), 0, d.hourly.time.length - 1);
function hourIndex(d, day, hour) {   // indeks jam `hour` pada hari ke-`day`
  const i = d.hourly.time.indexOf(`${d.daily.time[day]}T${String(hour).padStart(2, "0")}:00`);
  return i >= 0 ? i : clamp(day * 24 + hour, 0, d.hourly.time.length - 1);
}

// ---- empat cincin ----
const rings = RINGS.map((r) => {
  const box = el("div", "wx-ring");
  box.innerHTML = `<div class="r"><svg viewBox="0 0 100 100" aria-hidden="true">
      <circle class="track" cx="50" cy="50" r="42"/>
      <circle class="bar" cx="50" cy="50" r="42" stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C}"/>
    </svg><span class="v">--</span></div><div class="l">${r.label}</div>`;
  ringsEl?.append(box);
  const bar = box.querySelector(".bar"), val = box.querySelector(".v");
  return {
    set(v) {
      const ok = Number.isFinite(v);
      const pct = ok ? clamp((v - r.min) / (r.max - r.min), 0, 1) : 0;
      bar.style.strokeDashoffset = RING_C * (1 - pct);
      val.textContent = ok ? r.fmt(v) : "–";
    },
  };
});

function readings(d, day) {
  const h = d.hourly;
  if (day === 0) {
    const c = d.current;
    return {
      temp: c.temperature_2m, text: describe(c.weather_code, c.is_day)[1],
      wind: c.wind_speed_10m, humid: c.relative_humidity_2m,
      rain: h.precipitation_probability[nowIndex(d)], feels: c.apparent_temperature,
    };
  }
  const i = hourIndex(d, day, 12);   // hari lain: nilai jam 12 siang
  const lo = d.daily.temperature_2m_min[day];
  return {
    temp: d.daily.temperature_2m_max[day],
    text: describe(d.daily.weather_code[day], 1)[1] + (Number.isFinite(lo) ? ` · low ${lo.toFixed(0)}°` : ""),
    wind: h.wind_speed_10m[i], humid: h.relative_humidity_2m[i],
    rain: d.daily.precipitation_probability_max[day], feels: h.apparent_temperature[i],
  };
}

// ---- putaran: titik-titik berjalan searah jarum jam di sepanjang elips ----
const orbitBox = $("wx-orbit");
const SPEED = 3;   // derajat per detik (satu putaran sekitar 2 menit)
const orbit = { phase: 0, pts: [], raf: 0, last: 0, hold: false, drag: false };
const reduced = () => document.documentElement.classList.contains("no-motion");

// ukuran elips dihitung dari ukuran kotak dan ukuran pil, jadi pil tidak pernah keluar dari kotak
const geo = { W: 0, H: 0, cx: 0, cy: 0, rx: 0, ry: 0 };
const pathSvg = document.querySelector(".wx-path");
const pathEl = pathSvg?.querySelector("ellipse");

function measureOrbit() {
  if (!orbitBox) return;
  const W = orbitBox.clientWidth, H = orbitBox.clientHeight;
  if (!W || !H) return;
  let pw = 56, ph = 84;   // pil terbesar (yang "sekarang"); diukur dari elemen kalau sudah ada
  for (const { el: pt } of orbit.pts) { pw = Math.max(pw, pt.offsetWidth); ph = Math.max(ph, pt.offsetHeight); }
  const th = (TILT * Math.PI) / 180, s2 = Math.sin(th) ** 2, c2 = Math.cos(th) ** 2;
  const maxW = Math.max(60, W / 2 - pw / 2 - 6), maxH = Math.max(50, H / 2 - ph / 2 - 6);
  // elips yang dimiringkan: separuh lebar = √(rx²cos²+ry²sin²), separuh tinggi = √(rx²sin²+ry²cos²)
  let rx = maxW, ry = maxH;
  for (let i = 0; i < 3; i++) {
    ry = Math.sqrt(Math.max(0, (maxH * maxH - rx * rx * s2) / c2));
    rx = Math.sqrt(Math.max(0, (maxW * maxW - ry * ry * s2) / c2));
  }
  Object.assign(geo, { W, H, cx: W / 2, cy: H / 2, rx: Math.max(60, rx), ry: Math.max(50, ry) });
  if (pathEl) {
    pathSvg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    pathEl.setAttribute("cx", geo.cx);
    pathEl.setAttribute("cy", geo.cy);
    pathEl.setAttribute("rx", geo.rx.toFixed(1));
    pathEl.setAttribute("ry", geo.ry.toFixed(1));
    pathEl.setAttribute("transform", `rotate(${TILT} ${geo.cx} ${geo.cy})`);
  }
  placePts();
}

function placePts() {
  if (!geo.W) return;
  const th = (TILT * Math.PI) / 180, ct = Math.cos(th), st = Math.sin(th);
  for (const { el: pt, k } of orbit.pts) {
    const a = ((ANGLES[k] + orbit.phase) * Math.PI) / 180;
    const ex = -geo.rx * Math.sin(a), ey = geo.ry * Math.cos(a);   // titik di elips yang belum dimiringkan
    pt.style.left = (geo.cx + ex * ct - ey * st).toFixed(1) + "px";
    pt.style.top = (geo.cy + ex * st + ey * ct).toFixed(1) + "px";
  }
}
if (orbitBox && typeof ResizeObserver !== "undefined") new ResizeObserver(measureOrbit).observe(orbitBox);
function orbitFrame(now) {
  orbit.raf = 0;
  const dt = Math.min(0.05, orbit.last ? (now - orbit.last) / 1000 : 0.016);
  orbit.last = now;
  orbit.phase = (orbit.phase + SPEED * dt) % 360;
  placePts();
  kickOrbit();
}
function kickOrbit() {   // berjalan hanya saat terlihat, tidak ditahan, dan efek gerak tidak dimatikan
  const go = onDashboard() && orbit.pts.length && !orbit.hold && !orbit.drag && !reduced();
  if (go && !orbit.raf) { orbit.last = 0; orbit.raf = requestAnimationFrame(orbitFrame); }
}
["state:panelOpen", "state:activeTab", "state:off", "power:on", "motion:changed"].forEach((ev) => on(ev, kickOrbit));

orbitBox?.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") orbit.hold = true; });   // kursor di atasnya: berhenti supaya terbaca
orbitBox?.addEventListener("pointerleave", () => { orbit.hold = false; kickOrbit(); });
orbitBox?.addEventListener("pointerdown", (e) => {   // geser ke samping untuk memutar sendiri
  if (e.button !== 0) return;
  let lastX = e.clientX;
  orbit.drag = true;
  setState("drag", true);   // panel tidak menutup sendiri selama diseret
  orbitBox.setPointerCapture(e.pointerId);
  const move = (ev) => {
    orbit.phase = (orbit.phase + (ev.clientX - lastX) * 0.5 + 360) % 360;
    lastX = ev.clientX;
    placePts();
  };
  const up = () => {
    orbitBox.removeEventListener("pointermove", move);
    orbitBox.removeEventListener("pointerup", up);
    orbitBox.removeEventListener("pointercancel", up);
    orbit.drag = false;
    setState("drag", false);
    kickOrbit();
  };
  orbitBox.addEventListener("pointermove", move);
  orbitBox.addEventListener("pointerup", up);
  orbitBox.addEventListener("pointercancel", up);
});

function renderOrbit(d, day) {
  const h = d.hourly;
  const start = day === 0 ? nowIndex(d) : hourIndex(d, day, 7);   // hari ini: jam terdekat; hari lain: mulai 07.00
  if (day === 0) W.nowIdx = start;
  const pts = [];
  for (let k = 0; k < 8; k++) {
    const i = start + k * 3;
    if (i >= h.time.length) break;
    const [icon, text] = describe(h.weather_code[i], h.is_day[i]);
    const pt = el("div", "wx-pt" + (k === 0 ? " now" : ""));
    pt.style.setProperty("--i", k);
    pt.title = text;
    const ic = el("span", "ic");
    ic.append(createIcon(icon));
    const t = h.temperature_2m[i];
    pt.append(el("span", "t", h.time[i].slice(11, 16)), ic, el("span", "v", Number.isFinite(t) ? `${t.toFixed(1)}°` : "–"));
    pts.push({ el: pt, k });
  }
  orbit.pts = pts;
  orbitEl.replaceChildren(...pts.map((p) => p.el));
  measureOrbit();   // ukuran pil bisa berbeda; hitung ulang elips lalu tempatkan titik
  kickOrbit();
}

function renderWeather() {
  const d = W.data;
  if (!d || !orbitEl) return;
  const day = W.day, n = d.daily.time.length;
  dayEl.textContent = dayFmt.format(Date.parse(d.daily.time[day] + "T00:00:00Z"));
  prevBtn.disabled = day === 0;
  nextBtn.disabled = day === n - 1;
  const r = readings(d, day);
  tempEl.textContent = Number.isFinite(r.temp) ? `${r.temp.toFixed(1)}°` : "--°";
  descEl.textContent = r.text;
  RINGS.forEach((spec, i) => rings[i].set(r[spec.key]));
  renderOrbit(d, day);
}

prevBtn?.addEventListener("click", () => { if (W.day > 0) { W.day--; renderWeather(); } });
nextBtn?.addEventListener("click", () => { if (W.data && W.day < W.data.daily.time.length - 1) { W.day++; renderWeather(); } });

on("weather:data", (d) => {
  W.data = prepare(d);
  W.day = Math.min(W.day, W.data.daily.time.length - 1);
  renderWeather();
});
on("weather:error", () => { if (!W.data && descEl) descEl.textContent = "Weather unavailable"; });
setInterval(() => {   // jam berganti: titik "sekarang" ikut bergeser
  if (W.data && W.day === 0 && nowIndex(W.data) !== W.nowIdx) renderWeather();
}, 60_000);
on("power:on", () => { if (W.data && W.day === 0) renderWeather(); });

const cached = lastWeather();
if (cached) W.data = prepare(cached);
renderWeather();

// =====================================================================
// Agenda: hari terdekat (mulai hari ini) yang punya acara
// =====================================================================
const agTitle = $("dag-title"), agList = $("dag-list"), agOpen = $("dag-open");
const agFmt = new Intl.DateTimeFormat(LOCALE, { weekday: "long", day: "2-digit", month: "short", timeZone: "UTC" });

function nextWithEvents() {
  const t = todayParts();
  for (let i = 0; i <= 90; i++) {
    const dt = new Date(Date.UTC(t.y, t.m, t.d + i));
    const evs = eventsOn(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
    if (evs.length) return { i, dt, evs };
  }
  return null;
}

function renderAgenda() {
  if (!agList) return;
  const next = nextWithEvents();
  if (!next) {
    agTitle.textContent = "No upcoming events";
    agList.replaceChildren(el("div", "dag-empty", "Nothing planned in the next 90 days."));
    return;
  }
  const tag = next.i === 0 ? "Today" : next.i === 1 ? "Tomorrow" : "Upcoming";
  const more = next.evs.length > 3 ? ` · +${next.evs.length - 3} more` : "";
  agTitle.textContent = `${agFmt.format(next.dt)} (${tag})${more}`;
  agList.replaceChildren(...next.evs.slice(0, 3).map((ev) => {
    const item = el("div", "dag-item");
    item.append(
      el("div", "dag-name", ev.title),
      el("div", "dag-time", (ev.time || "All day") + (ev.repeat !== "none" ? "  ↻" : "")),
    );
    return item;
  }));
}
agOpen?.addEventListener("click", () => setState("activeTab", "calendar"));
on("state:events", renderAgenda);
on("power:on", renderAgenda);
setInterval(renderAgenda, 60_000);   // ganti hari otomatis
renderAgenda();