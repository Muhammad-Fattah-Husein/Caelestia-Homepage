import { state, on } from "../core/state.js";

const R = 42;
const C = 2 * Math.PI * R;   // keliling lingkaran
const root = document.getElementById("gauges");

function createGauge(label) {
  const el = document.createElement("div");
  el.className = "gauge";
  el.innerHTML = `
    <div class="ring">
      <svg viewBox="0 0 100 100">
        <circle class="track" cx="50" cy="50" r="${R}"/>
        <circle class="bar" cx="50" cy="50" r="${R}"
                stroke-dasharray="${C}" stroke-dashoffset="${C}"/>
      </svg>
      <div class="val">--</div>
    </div>
    <div class="label">${label}</div>`;
  const bar = el.querySelector(".bar");
  const val = el.querySelector(".val");

  return {
    el,
    set(pct, text) {
      const p = Math.max(0, Math.min(100, pct ?? 0));
      bar.style.strokeDashoffset = C * (1 - p / 100);
      val.textContent = pct == null ? "N/A" : text;
    },
  };
}

const gauges = {
  battery: createGauge("Battery"),
  memory:  createGauge("JS memory"),
  storage: createGauge("Storage"),
};
Object.values(gauges).forEach(g => root.append(g.el));

function formatSize(bytes) {
  return bytes > 1048576
    ? Math.round(bytes / 1048576) + " MB"
    : Math.round(bytes / 1024) + " KB";
}

let battery = null;
navigator.getBattery?.().then(b => { battery = b; refresh(); }) .catch(() => {});

async function refresh() {
  if (battery) {
    const pct = Math.round(battery.level * 100);
    gauges.battery.set(pct, pct + "%");
  } else gauges.battery.set(null);

  const m = performance.memory;   // hanya Chromium
  if (m) gauges.memory.set(m.usedJSHeapSize / m.jsHeapSizeLimit * 100, formatSize(m.usedJSHeapSize));
  else gauges.memory.set(null);

  if (navigator.storage?.estimate) {
    const { usage, quota } = await navigator.storage.estimate();
    gauges.storage.set(usage / quota * 100, formatSize(usage));
  } else gauges.storage.set(null);
}

const visible = () => state.panelOpen && state.activeTab === "performance";

setInterval(() => visible() && refresh(), 2000);
on("state:activeTab", () => visible() && refresh());
on("state:panelOpen", () => visible() && refresh());

refresh();