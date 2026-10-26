import { on, off } from "../../../core/state.js";
import { motionReduced } from "../../../core/prefs.js";

const PATTERNS = [
  { name: "4-7-8", steps: [["Breathe in", 4, "in"], ["Hold", 7, "hold"], ["Breathe out", 8, "out"]] },
  { name: "Box", steps: [["Breathe in", 4, "in"], ["Hold", 4, "hold"], ["Breathe out", 4, "out"], ["Hold", 4, "hold"]] },
  { name: "Calm", steps: [["Breathe in", 4, "in"], ["Breathe out", 6, "out"]] },
];

function mountBreath(body, ctx) {
  let p = Number.isInteger(ctx.data?.p) && ctx.data.p >= 0 && ctx.data.p < PATTERNS.length ? ctx.data.p : 0;

  const card = document.createElement("div");
  card.className = "br";
  card.title = "Click to start or stop";
  card.innerHTML = `<div class="br-orb"></div>
    <div class="br-label">Click to start</div>
    <div class="br-count"></div>
    <button type="button" class="br-pat" aria-label="Change breathing pattern"></button>`;
  body.append(card);
  const orb = card.querySelector(".br-orb");
  const labelEl = card.querySelector(".br-label");
  const countEl = card.querySelector(".br-count");
  const patBtn = card.querySelector(".br-pat");

  let running = false, i = 0, secs = 0, t0 = 0, to = 0, iv = 0;
  const idle = () => {
    orb.style.transition = "transform .6s ease";
    orb.style.transform = "scale(.7)";
  };

  function count() {
    countEl.textContent = String(Math.max(0, Math.ceil(secs - (Date.now() - t0) / 1000)));
  }
  function step() {
    const [label, s, kind] = PATTERNS[p].steps[i];
    secs = s;
    t0 = Date.now();
    labelEl.textContent = label;
    if (kind === "hold" || motionReduced()) orb.style.transition = "none";
    else orb.style.transition = `transform ${s}s ease-in-out`;
    if (kind === "in") orb.style.transform = "scale(1)";
    else if (kind === "out") orb.style.transform = "scale(.55)";
    count();
    to = setTimeout(() => { i = (i + 1) % PATTERNS[p].steps.length; step(); }, s * 1000);
  }
  function start() {
    running = true;
    i = 0;
    card.classList.add("on");
    iv = setInterval(count, 250);
    step();
  }
  function stop() {
    running = false;
    clearTimeout(to);
    clearInterval(iv);
    card.classList.remove("on");
    idle();
    labelEl.textContent = "Click to start";
    countEl.textContent = "";
  }
  const toggle = () => (running ? stop() : start());

  patBtn.textContent = PATTERNS[p].name;
  patBtn.addEventListener("click", () => {
    p = (p + 1) % PATTERNS.length;
    patBtn.textContent = PATTERNS[p].name;
    ctx.save({ p });
    if (running) { stop(); start(); }
  });

  const onOff = (isOff) => { if (isOff && running) stop(); };
  on("state:off", onOff);
  idle();

  return {
    onTap: toggle,
    cleanup() {
      clearTimeout(to);
      clearInterval(iv);
      off("state:off", onOff);
    },
  };
}

export { mountBreath as default };
