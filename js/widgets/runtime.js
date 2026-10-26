import { state, on, off, zone } from "../core/state.js";
import { createIcon } from "../core/icons.js";

export function every(ms, fn) {
  const run = () => { if (!state.off) fn(); };
  const id = setInterval(run, ms);
  on("power:on", run);
  return () => { clearInterval(id); off("power:on", run); };
}

export const ymd = (tz) => new Intl.DateTimeFormat("en-CA", {
  timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
});
export const todayStr = () => ymd(zone).format(new Date());
export const isDate = (s) =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
export const dayNum = (s) => Date.parse(s + "T00:00:00Z") / 86400000;
export const isHttp = (u, max = 2000) => {
  if (typeof u !== "string" || u.length > max) return false;
  try { return /^https?:$/.test(new URL(u).protocol); } catch { return false; }
};

export function mountChip(body, icon, label) {
  const chip = document.createElement("div");
  chip.className = "wd-chip";
  const iconWrap = document.createElement("span");
  iconWrap.append(createIcon(icon));
  const text = document.createElement("b");
  text.textContent = label;
  chip.append(iconWrap, text);
  body.replaceChildren(chip);
}
