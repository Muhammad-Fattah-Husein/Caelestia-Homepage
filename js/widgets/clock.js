import { zone, LOCALE, state, on } from "../core/state.js";

const hhEl = document.getElementById("clock-hh");
const mmEl = document.getElementById("clock-mm");
const dateEl = document.getElementById("clock-date"); // dipakai nanti di tab Dashboard
const zoneEl = document.getElementById("clock-zone");
const timeFmt = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: zone,
});
const dateFmt = new Intl.DateTimeFormat(LOCALE, {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: zone,
});
const abbrFmt = new Intl.DateTimeFormat(LOCALE, {
  timeZoneName: "short",
  timeZone: zone,
});
const CITY_LABEL = "Jakarta"; // null = tebak dari zona perangkat
const ID_ABBR = { "GMT+7": "WIB", "GMT+8": "WITA", "GMT+9": "WIT" };

function zoneLabel(now) {
  const abbr = abbrFmt
    .formatToParts(now)
    .find((p) => p.type === "timeZoneName")?.value;
  const city = zone.split("/").pop().replaceAll("_", " ");
  return `${CITY_LABEL ?? city} · ${ID_ABBR[abbr] ?? abbr}`;
}

let timer;
function tick() {
  clearTimeout(timer);          // cegah dua putaran saat mati lalu nyala dengan cepat
  if (state.off) return;
  const now = new Date();
  const parts = timeFmt.formatToParts(now);
  hhEl.textContent = parts.find(p => p.type === "hour").value;
  mmEl.textContent = parts.find(p => p.type === "minute").value;
  if (dateEl) dateEl.textContent = dateFmt.format(now);
  if (zoneEl) zoneEl.textContent = zoneLabel(now);

  timer = setTimeout(tick, 1000 - now.getMilliseconds());
}
on("power:on", tick);
tick();