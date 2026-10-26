import { state, on } from "./state.js";
import "./prefs.js";   // memastikan state.prefs sudah terisi

const avatarEl = document.getElementById("pf-avatar");
const nameEl = document.getElementById("pf-name");
const lineEl = document.getElementById("pf-line");
const upEl = document.getElementById("pf-up");
const envEl = document.getElementById("pf-env");

const platform = navigator.userAgentData?.platform || navigator.platform || "";
const brand = navigator.userAgentData?.brands
  ?.map((b) => b.brand)
  .find((b) => !/not.?a.?brand|chromium/i.test(b));
envEl.textContent = [brand, platform].filter(Boolean).join(" · ") || "browser";

let token = 0;
function renderProfile() {
  const { name, tagline, avatar } = state.prefs;
  nameEl.textContent = name;
  lineEl.textContent = tagline;
  avatarEl.textContent = Array.from(name)[0]?.toUpperCase() ?? "?";   // huruf pertama sebagai cadangan
  const mine = ++token;
  if (!avatar) return;
  const img = new Image();
  img.alt = "";
  img.onload = () => {
    if (mine !== token) return;   // sudah ada perubahan yang lebih baru
    avatarEl.textContent = "";
    avatarEl.append(img);
  };
  img.src = avatar;
}
on("state:prefs", renderProfile);
renderProfile();

let startedAt = Date.now();

function formatUp(ms) {
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just started";
  if (mins < 60) return `up for ${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h < 24) return `up for ${h} hr${m ? ` ${m} min` : ""}`;
  return `up for ${Math.floor(h / 24)} days ${h % 24} hr`;
}

function refresh() {
  upEl.textContent = formatUp(Date.now() - startedAt);
}

const visible = () => state.panelOpen && state.activeTab === "dashboard" && !state.off;

setInterval(() => visible() && refresh(), 30_000);
on("state:panelOpen", () => visible() && refresh());
on("state:activeTab", () => visible() && refresh());
on("power:on", () => { startedAt = Date.now(); refresh(); });   // dinyalakan ulang: hitung dari nol

refresh();