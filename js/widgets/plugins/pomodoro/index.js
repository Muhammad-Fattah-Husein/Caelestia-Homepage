import { state, on, off, emit } from "../../../core/state.js";

const FOCUS = 25 * 60, BREAK = 5 * 60, CIRC = 2 * Math.PI * 42;

function mountPomodoro(body, ctx) {
  body.innerHTML = `<div class="pomo" title="Click to start or pause">
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <circle class="pomo-track" cx="50" cy="50" r="42"/>
      <circle class="pomo-bar" cx="50" cy="50" r="42" stroke-dasharray="${CIRC}" stroke-dashoffset="${CIRC}"/>
    </svg>
    <div class="pomo-center"><div class="pomo-time">25:00</div><div class="pomo-mode">Focus</div></div>
    <button class="pomo-reset" type="button" aria-label="Reset" title="Reset">↺</button>
  </div>`;
  const bar = body.querySelector(".pomo-bar");
  const timeEl = body.querySelector(".pomo-time");
  const modeEl = body.querySelector(".pomo-mode");

  const d = ctx.data ?? {};
  let mode = d.mode === "break" ? "break" : "focus";
  const total = () => (mode === "break" ? BREAK : FOCUS);
  let remaining = Number.isFinite(d.remaining) ? Math.min(total(), Math.max(0, d.remaining)) : total();
  let endAt = Number.isFinite(d.endAt) ? d.endAt : null;
  let timer = 0;

  const left = () => (endAt ? Math.max(0, Math.ceil((endAt - Date.now()) / 1000)) : remaining);
  const persist = () => ctx.save({ mode, remaining, endAt });

  function paint() {
    const s = left();
    timeEl.textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
    modeEl.textContent = mode === "focus" ? "Focus" : "Break";
    bar.style.strokeDashoffset = CIRC * (s / total());
    document.documentElement.classList.toggle("focusing", Boolean(endAt && mode === "focus"));   // efek: wallpaper meredup
  }

  function complete() {
    const wasFocus = mode === "focus";
    mode = wasFocus ? "break" : "focus";
    remaining = total();
    endAt = null;
    stop();
    persist();
    paint();
    emit("toast", {
      title: wasFocus ? "Focus session complete" : "Break complete",
      message: wasFocus ? "Time for a 5-minute break" : "Ready to focus again?",
      duration: 6000,
    });
  }

  function tick() {
    if (state.off) return;
    if (endAt && left() <= 0) complete();
    else paint();
  }
  const start = () => { if (!timer) timer = setInterval(tick, 1000); };
  const stop = () => { clearInterval(timer); timer = 0; };

  function toggle() {
    if (endAt) { remaining = left(); endAt = null; stop(); }
    else { endAt = Date.now() + remaining * 1000; start(); }
    persist();
    paint();
  }
  function reset() {
    mode = "focus"; remaining = FOCUS; endAt = null;
    stop(); persist(); paint();
  }

  body.querySelector(".pomo-reset").addEventListener("click", reset);
  on("power:on", tick);
  document.addEventListener("visibilitychange", tick);
  if (endAt) start();
  tick();

  return {
    onTap: toggle,
    cleanup() {
      stop();
      off("power:on", tick);
      document.removeEventListener("visibilitychange", tick);
      document.documentElement.classList.remove("focusing");
    },
  };
}

export { mountPomodoro as default };
