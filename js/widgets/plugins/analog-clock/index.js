import { state, zone } from "../../../core/state.js";

const timeFmt = new Intl.DateTimeFormat("en-GB", {
  hour: "numeric", minute: "numeric", second: "numeric",
  hourCycle: "h23", timeZone: zone,
});

function mountClock(body) {
  const ticks = Array.from({ length: 12 }, (_, i) =>
    `<line class="an-tick" x1="50" y1="8" x2="50" y2="${i % 3 ? 12 : 15}" transform="rotate(${i * 30} 50 50)"/>`,
  ).join("");
  body.innerHTML = `<svg class="an-clock" viewBox="0 0 100 100" aria-hidden="true">
    <circle class="an-face" cx="50" cy="50" r="46"/>${ticks}
    <line class="an-h" x1="50" y1="50" x2="50" y2="28"/>
    <line class="an-m" x1="50" y1="50" x2="50" y2="18"/>
    <line class="an-s" x1="50" y1="56" x2="50" y2="12"/>
  </svg>`;
  const [h, m, s] = [".an-h", ".an-m", ".an-s"].map((c) => body.querySelector(c));

  function tick() {
    if (state.off) return;
    const p = Object.fromEntries(
      timeFmt.formatToParts(new Date()).map((x) => [x.type, Number(x.value)]),
    );
    h.setAttribute("transform", `rotate(${(p.hour % 12) * 30 + p.minute * 0.5} 50 50)`);
    m.setAttribute("transform", `rotate(${p.minute * 6 + p.second * 0.1} 50 50)`);
    s.setAttribute("transform", `rotate(${p.second * 6} 50 50)`);
  }
  tick();
  const id = setInterval(tick, 1000);
  return () => clearInterval(id);   // dipanggil saat widget dihapus
}

export { mountClock as default };
